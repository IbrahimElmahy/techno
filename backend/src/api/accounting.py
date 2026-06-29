"""General Ledger & Chart of Accounts router (005).

Chart tree CRUD, manual journal entries (+reverse), opening balances, and the derived trial
balance. All gated by the `accounting.*` capabilities (Accountant + System Admin). Journals are
branch-tagged; branch-scoped users post/read only their own branch.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import (
    CAP_ACCOUNTING_CHART_READ,
    CAP_ACCOUNTING_CHART_WRITE,
    CAP_ACCOUNTING_JOURNAL_POST,
    CAP_ACCOUNTING_JOURNAL_REVERSE,
    CAP_ACCOUNTING_TRIAL_BALANCE_READ,
)
from src.core.db import get_db
from src.models.ledger import Account, AccountNature, Direction, LedgerEntry, LedgerLine
from src.services import (
    chart_service,
    journal_service,
    opening_balance_service,
    trial_balance_service,
)
from src.services.chart_service import ChartError
from src.services.journal_service import JournalError, JournalLineInput
from src.services.opening_balance_service import OpeningLineInput

router = APIRouter(tags=["accounting"])


def _ensure_accounting_branch(current: CurrentUser, target_branch_id: int | None) -> None:
    """Accounting branch scope: System Admin and a company-wide accountant (no branch assigned)
    may act on any branch; a branch-scoped accountant only on their own (FR-016)."""
    if current.is_admin or current.branch_id is None:
        return
    if current.branch_id != target_branch_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden", "message": "Out-of-branch accounting access denied."},
        )


# --- Schemas ---------------------------------------------------------------------------------

class AccountOut(BaseModel):
    id: int
    code: str | None
    name: str | None
    parent_id: int | None
    nature: AccountNature | None
    normal_side: Direction
    is_postable: bool
    is_system: bool
    active: bool
    balance: Decimal
    children: list["AccountOut"] | None = None


class AccountCreate(BaseModel):
    code: str
    name: str
    parent_id: int | None = None
    nature: AccountNature
    is_postable: bool


class AccountUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None


class JournalLineIn(BaseModel):
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None
    cost_center_id: int | None = None


class JournalEntryCreate(BaseModel):
    date: date
    description: str = ""
    branch_id: int
    lines: list[JournalLineIn] = Field(min_length=2)


class JournalLineOut(BaseModel):
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None
    cost_center_id: int | None = None


class JournalEntryOut(BaseModel):
    id: int
    entry_type: str
    date: date | None
    description: str
    branch_id: int | None
    actor_user_id: int
    reverses_entry_id: int | None
    lines: list[JournalLineOut]
    total: Decimal


class OpeningLineIn(BaseModel):
    account_id: int
    amount: Decimal


class OpeningBalancesCreate(BaseModel):
    date: date
    branch_id: int | None = None
    lines: list[OpeningLineIn] = Field(min_length=1)


class TrialBalanceRowOut(BaseModel):
    account_id: int
    code: str | None
    name: str | None
    is_postable: bool
    opening: Decimal
    period_debit: Decimal
    period_credit: Decimal
    closing: Decimal


class TrialBalanceOut(BaseModel):
    from_: date = Field(alias="from")
    to: date
    branch_id: int | None
    rows: list[TrialBalanceRowOut]
    grand_total_debit: Decimal
    grand_total_credit: Decimal
    balanced: bool

    model_config = {"populate_by_name": True}


# --- Serialization helpers -------------------------------------------------------------------

def _account_out(db: Session, acc: Account, *, with_children: bool = False) -> AccountOut:
    children = None
    if with_children:
        kids = db.scalars(
            select(Account).where(Account.parent_id == acc.id).order_by(Account.code)
        ).all()
        children = [_account_out(db, k, with_children=True) for k in kids]
    return AccountOut(
        id=acc.id, code=acc.code, name=acc.name, parent_id=acc.parent_id, nature=acc.nature,
        normal_side=acc.normal_side, is_postable=acc.is_postable, is_system=acc.is_system,
        active=acc.active, balance=chart_service.account_balance(db, acc.id), children=children,
    )


def _entry_out(entry: LedgerEntry) -> JournalEntryOut:
    total = sum(
        (l.amount for l in entry.lines if l.direction == Direction.debit), Decimal("0.00")
    )
    return JournalEntryOut(
        id=entry.id, entry_type=entry.entry_type, date=entry.entry_date,
        description=entry.description, branch_id=entry.branch_id, actor_user_id=entry.actor_user_id,
        reverses_entry_id=entry.reverses_entry_id,
        lines=[
            JournalLineOut(account_id=l.account_id, direction=l.direction, amount=l.amount,
                           statement=l.statement, cost_center_id=l.cost_center_id)
            for l in entry.lines
        ],
        total=total,
    )


# --- Chart of accounts -----------------------------------------------------------------------

@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(
    tree: bool = False,
    postable_only: bool = False,
    active: bool | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[AccountOut]:
    stmt = select(Account)
    if tree:
        stmt = stmt.where(Account.parent_id.is_(None))
    if postable_only:
        stmt = stmt.where(Account.is_postable.is_(True))
    if active is not None:
        stmt = stmt.where(Account.active.is_(active))
    accounts = db.scalars(stmt.order_by(Account.code)).all()
    return [_account_out(db, a, with_children=tree) for a in accounts]


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    body: AccountCreate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> AccountOut:
    try:
        acc = chart_service.create_account(
            db, code=body.code, name=body.name, nature=body.nature,
            is_postable=body.is_postable, parent_id=body.parent_id,
        )
    except ChartError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "chart_conflict", "message": str(exc)})
    db.commit()
    return _account_out(db, acc)


@router.get("/accounts/{account_id}", response_model=AccountOut)
def get_account(
    account_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> AccountOut:
    acc = db.get(Account, account_id)
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": "Account not found"})
    return _account_out(db, acc)


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int,
    body: AccountUpdate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> AccountOut:
    try:
        acc = chart_service.update_account(
            db, account_id=account_id, name=body.name, active=body.active
        )
    except ChartError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "chart_conflict", "message": str(exc)})
    db.commit()
    return _account_out(db, acc)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_account(
    account_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        chart_service.deactivate_account(db, account_id=account_id)
    except ChartError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "chart_conflict", "message": str(exc)})
    db.commit()


# --- Journal entries -------------------------------------------------------------------------

@router.get("/journal-entries", response_model=list[JournalEntryOut])
def list_journal_entries(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    branch_id: int | None = None,
    cost_center_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[JournalEntryOut]:
    stmt = select(LedgerEntry).where(
        LedgerEntry.entry_type.in_(["journal", "opening_balance", "reversal"])
    )
    if branch_id is not None:
        stmt = stmt.where(LedgerEntry.branch_id == branch_id)
    if from_ is not None:
        stmt = stmt.where(LedgerEntry.entry_date >= from_)
    if to is not None:
        stmt = stmt.where(LedgerEntry.entry_date <= to)
    if cost_center_id is not None:  # entries that touch this cost center on any line (006)
        stmt = stmt.where(
            LedgerEntry.lines.any(LedgerLine.cost_center_id == cost_center_id)
        )
    return [_entry_out(e) for e in db.scalars(stmt.order_by(LedgerEntry.id)).all()]


@router.get("/journal-entries/{entry_id}", response_model=JournalEntryOut)
def get_journal_entry(
    entry_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": "Entry not found"})
    return _entry_out(entry)


@router.post("/journal-entries", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def post_journal_entry(
    body: JournalEntryCreate,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    _ensure_accounting_branch(current, body.branch_id)  # branch-scoped users post only their branch
    try:
        entry = journal_service.post_entry(
            db,
            entry_date=body.date,
            description=body.description,
            branch_id=body.branch_id,
            lines=[
                JournalLineInput(l.account_id, l.direction, l.amount, l.statement, l.cost_center_id)
                for l in body.lines
            ],
            actor_user_id=current.id,
        )
    except JournalError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "journal_invalid", "message": str(exc)})
    db.commit()
    return _entry_out(entry)


@router.post("/journal-entries/{entry_id}/reverse", response_model=JournalEntryOut,
             status_code=status.HTTP_201_CREATED)
def reverse_journal_entry(
    entry_id: int,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_REVERSE)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    original = db.get(LedgerEntry, entry_id)
    if original is not None:
        _ensure_accounting_branch(current, original.branch_id)
    try:
        reversal = journal_service.reverse_entry(db, entry_id=entry_id, actor_user_id=current.id)
    except JournalError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "journal_conflict", "message": str(exc)})
    db.commit()
    return _entry_out(reversal)


# --- Opening balances ------------------------------------------------------------------------

@router.post("/opening-balances", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def post_opening_balances(
    body: OpeningBalancesCreate,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    if body.branch_id is not None:
        _ensure_accounting_branch(current, body.branch_id)
    try:
        entry = opening_balance_service.post_opening_balances(
            db,
            entry_date=body.date,
            branch_id=body.branch_id,
            lines=[OpeningLineInput(l.account_id, l.amount) for l in body.lines],
            actor_user_id=current.id,
        )
    except JournalError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "opening_invalid", "message": str(exc)})
    db.commit()
    return _entry_out(entry)


# --- Trial balance ---------------------------------------------------------------------------

@router.get("/trial-balance", response_model=TrialBalanceOut)
def get_trial_balance(
    from_: date = Query(alias="from"),
    to: date = Query(...),
    branch_id: int | None = None,
    include_groups: bool = True,
    cost_center_id: int | None = None,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_TRIAL_BALANCE_READ)),
    db: Session = Depends(get_db),
) -> TrialBalanceOut:
    # A branch-scoped accountant sees only their own branch; System Admin and a company-wide
    # accountant (no branch assigned) may pass any branch_id or omit it for all branches.
    if not current.is_admin and current.branch_id is not None:
        branch_id = current.branch_id
    result = trial_balance_service.trial_balance(
        db, from_date=from_, to_date=to, branch_id=branch_id, include_groups=include_groups,
        cost_center_id=cost_center_id,
    )
    return TrialBalanceOut(
        from_=result.from_date,
        to=result.to_date,
        branch_id=result.branch_id,
        rows=[
            TrialBalanceRowOut(
                account_id=r.account_id, code=r.code, name=r.name, is_postable=r.is_postable,
                opening=r.opening, period_debit=r.period_debit, period_credit=r.period_credit,
                closing=r.closing,
            )
            for r in result.rows
        ],
        grand_total_debit=result.grand_total_debit,
        grand_total_credit=result.grand_total_credit,
        balanced=result.balanced,
    )
