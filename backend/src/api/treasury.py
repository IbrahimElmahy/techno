"""Treasury & ledger router (Phase 3/6 endpoints). FR-024, FR-026, FR-027.

Singleton consolidated treasury account; balanced ledger posting; mirror reversal.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LEDGER_POST, CAP_LEDGER_READ, CAP_LEDGER_REVERSE, CAP_TREASURY_READ
from src.core.db import get_db
from src.models.ledger import Account, AccountType, Direction, LedgerEntry
from src.services import audit_service, ledger_service
from src.services.ledger_service import LedgerError, LineInput

router = APIRouter(tags=["treasury"])


def get_or_create_treasury_account(db: Session) -> Account:
    acc = db.scalar(select(Account).where(Account.account_type == AccountType.treasury))
    if acc is None:
        acc = Account(account_type=AccountType.treasury, owner_ref=None, normal_side=Direction.debit)
        db.add(acc)
        db.flush()
    return acc


class BalanceOut(BaseModel):
    account_id: int
    balance: Decimal


class AccountOut(BaseModel):
    id: int
    account_type: AccountType
    owner_ref: int | None
    normal_side: Direction
    active: bool


class LineIn(BaseModel):
    account_id: int
    direction: Direction
    amount: Decimal


class LedgerEntryCreate(BaseModel):
    entry_type: str
    description: str = ""
    branch_id: int | None = None
    rep_id: int | None = None
    lines: list[LineIn]


class LineOut(BaseModel):
    id: int
    account_id: int
    direction: Direction
    amount: Decimal


class LedgerEntryOut(BaseModel):
    id: int
    entry_type: str
    description: str
    actor_user_id: int
    rep_id: int | None
    branch_id: int | None
    reverses_entry_id: int | None
    lines: list[LineOut]


def _entry_out(entry: LedgerEntry) -> LedgerEntryOut:
    return LedgerEntryOut(
        id=entry.id,
        entry_type=entry.entry_type,
        description=entry.description,
        actor_user_id=entry.actor_user_id,
        rep_id=entry.rep_id,
        branch_id=entry.branch_id,
        reverses_entry_id=entry.reverses_entry_id,
        lines=[
            LineOut(id=l.id, account_id=l.account_id, direction=l.direction, amount=l.amount)
            for l in entry.lines
        ],
    )


@router.get("/treasury/balance", response_model=BalanceOut)
def treasury_balance(
    _: CurrentUser = Depends(require_capability(CAP_TREASURY_READ)),
    db: Session = Depends(get_db),
) -> BalanceOut:
    acc = get_or_create_treasury_account(db)
    db.commit()
    return BalanceOut(account_id=acc.id, balance=ledger_service.balance_of(db, acc.id))


@router.post("/ledger/entries", response_model=LedgerEntryOut, status_code=status.HTTP_201_CREATED)
def post_ledger_entry(
    body: LedgerEntryCreate,
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
    db: Session = Depends(get_db),
) -> LedgerEntryOut:
    try:
        entry = ledger_service.post_entry(
            db,
            entry_type=body.entry_type,
            actor_user_id=current.id,
            lines=[LineInput(l.account_id, l.direction, l.amount) for l in body.lines],
            description=body.description,
            rep_id=body.rep_id,
            branch_id=body.branch_id,
        )
    except LedgerError as exc:
        raise HTTPException(422, {"code": "ledger_invalid", "message": str(exc)})
    audit_service.record(
        db, action="ledger.post", actor_user_id=current.id, entity_type="ledger_entry",
        entity_id=entry.id, after={"entry_type": entry.entry_type},
    )
    db.commit()
    return _entry_out(entry)


@router.get("/ledger/entries", response_model=list[LedgerEntryOut])
def list_ledger_entries(
    account_id: int | None = None,
    branch_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
    db: Session = Depends(get_db),
) -> list[LedgerEntryOut]:
    stmt = select(LedgerEntry)
    if branch_id is not None:
        stmt = stmt.where(LedgerEntry.branch_id == branch_id)
    entries = db.scalars(stmt).all()
    return [_entry_out(e) for e in entries]


@router.get("/ledger/accounts", response_model=list[AccountOut])
def list_accounts(
    _: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
    db: Session = Depends(get_db),
) -> list[AccountOut]:
    return [
        AccountOut(
            id=a.id,
            account_type=a.account_type,
            owner_ref=a.owner_ref,
            normal_side=a.normal_side,
            active=a.active,
        )
        for a in db.scalars(select(Account)).all()
    ]


@router.post(
    "/ledger/entries/{entry_id}/reverse",
    response_model=LedgerEntryOut,
    status_code=status.HTTP_201_CREATED,
)
def reverse_ledger_entry(
    entry_id: int,
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_REVERSE)),
    db: Session = Depends(get_db),
) -> LedgerEntryOut:
    try:
        reversal = ledger_service.reverse_entry(db, original_id=entry_id, actor_user_id=current.id)
    except LedgerError as exc:
        # Already-reversed / not re-reversible -> conflict.
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "ledger_conflict", "message": str(exc)})
    audit_service.record(
        db, action="ledger.reverse", actor_user_id=current.id, entity_type="ledger_entry",
        entity_id=reversal.id, after={"reverses_entry_id": entry_id},
    )
    db.commit()
    return _entry_out(reversal)
