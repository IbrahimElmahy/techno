from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LEDGER_READ
from src.core.db import get_db
from src.core.money import to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.models.org import Branch

router = APIRouter(tags=["partners-current"])

GROUP_PATTERNS = ("%جار%", "%رأس المال%", "%راس المال%", "%استثمار%")


class PartnerAccountOut(BaseModel):
    account_id: int
    code: str | None
    name: str
    group_id: int
    group_name: str
    branch_id: int | None
    branch_name: str | None
    debit: Decimal
    credit: Decimal
    balance: Decimal
    lines: int
    last_date: date | None


@router.get("/partners-current", response_model=list[PartnerAccountOut])
def partners_current(
    as_of: date | None = Query(None, description="الرصيد لحد التاريخ ده"),
    include_zero: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
    db: Session = Depends(get_db),
) -> list[PartnerAccountOut]:
    parent = aliased(Account)
    stmt = (
        select(Account, parent)
        .join(parent, parent.id == Account.parent_id)
        .where(or_(*[parent.name.like(p) for p in GROUP_PATTERNS]))
    )
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        stmt = stmt.where(Account.branch_id == bid)
    pairs = db.execute(stmt).all()
    if not pairs:
        return []
    ids = [a.id for a, _p in pairs]

    sums = (
        select(
            LedgerLine.account_id,
            func.coalesce(func.sum(LedgerLine.amount).filter(
                LedgerLine.direction == Direction.debit), 0),
            func.coalesce(func.sum(LedgerLine.amount).filter(
                LedgerLine.direction == Direction.credit), 0),
            func.count(LedgerLine.id),
            func.max(LedgerEntry.entry_date),
        )
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(ids),
               or_(LedgerEntry.state.is_(None), LedgerEntry.state == "posted"))
        .group_by(LedgerLine.account_id)
    )
    if as_of is not None:
        sums = sums.where(LedgerEntry.entry_date <= as_of)
    by_acc = {r[0]: r[1:] for r in db.execute(sums).all()}
    branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}

    out: list[PartnerAccountOut] = []
    for a, p in pairs:
        dr, cr, n, last = by_acc.get(a.id, (0, 0, 0, None))
        dr, cr = to_money(Decimal(str(dr))), to_money(Decimal(str(cr)))
        if not include_zero and n == 0:
            continue
        out.append(PartnerAccountOut(
            account_id=a.id, code=a.code, name=a.name or "", group_id=p.id,
            group_name=p.name or "", branch_id=a.branch_id,
            branch_name=branches.get(a.branch_id), debit=dr, credit=cr,
            balance=to_money(cr - dr), lines=int(n or 0), last_date=last,
        ))
    out.sort(key=lambda r: (r.branch_id or 0, r.group_name, r.name))
    return out


from pydantic import Field  # noqa: E402

from src.auth.rbac import CAP_VOUCHER_WRITE  # noqa: E402
from src.models.voucher import Voucher  # noqa: E402
from src.services import voucher_service  # noqa: E402
from src.services.ledger_service import LedgerError  # noqa: E402
from src.services.treasury_service import TreasuryError  # noqa: E402
from src.services.voucher_service import VoucherError  # noqa: E402


class MovementOut(BaseModel):
    entry_id: int
    entry_date: date | None
    document: str | None
    voucher_id: int | None
    kind: str | None
    description: str
    debit: Decimal
    credit: Decimal
    balance: Decimal


class MovementsOut(BaseModel):
    account_id: int
    name: str
    group_name: str
    branch_name: str | None
    opening: Decimal
    rows: list[MovementOut]
    total_debit: Decimal
    total_credit: Decimal
    closing: Decimal


def _partner_account(db: Session, account_id: int, current: CurrentUser) -> tuple[Account, Account]:
    from fastapi import HTTPException
    acc = db.get(Account, account_id)
    parent = db.get(Account, acc.parent_id) if acc is not None and acc.parent_id else None
    pname = (parent.name or "") if parent is not None else ""
    ok = acc is not None and any(w in pname for w in ("جار", "رأس المال", "راس المال", "استثمار"))
    bid = branch_scope.visible_branch_id(current)
    if not ok or (bid is not None and acc.branch_id != bid):
        raise HTTPException(404, {"code": "not_found", "message": "حساب الشريك مش موجود."})
    return acc, parent


@router.get("/partners-current/{account_id}/movements", response_model=MovementsOut)
def partner_movements(
    account_id: int,
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
    db: Session = Depends(get_db),
) -> MovementsOut:
    acc, parent = _partner_account(db, account_id, current)
    posted = or_(LedgerEntry.state.is_(None), LedgerEntry.state == "posted")
    opening = Decimal("0")
    if date_from is not None:
        for d, amt in db.execute(
                select(LedgerLine.direction, LedgerLine.amount)
                .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
                .where(LedgerLine.account_id == acc.id, posted,
                       LedgerEntry.entry_date < date_from)).all():
            opening += Decimal(str(amt)) if d == Direction.credit else -Decimal(str(amt))
    stmt = (
        select(LedgerLine, LedgerEntry)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id == acc.id, posted)
        .order_by(LedgerEntry.entry_date, LedgerEntry.id, LedgerLine.id)
    )
    if date_from is not None:
        stmt = stmt.where(LedgerEntry.entry_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(LedgerEntry.entry_date <= date_to)
    pairs = db.execute(stmt).all()
    vouchers = {v.ledger_entry_id: v for v in db.scalars(select(Voucher).where(
        Voucher.ledger_entry_id.in_([e.id for _l, e in pairs]))).all()} if pairs else {}
    run = opening
    rows: list[MovementOut] = []
    tdr = tcr = Decimal("0")
    for line, entry in pairs:
        amt = to_money(Decimal(str(line.amount)))
        dr = amt if line.direction == Direction.debit else Decimal("0")
        cr = amt if line.direction == Direction.credit else Decimal("0")
        run += cr - dr
        tdr += dr
        tcr += cr
        v = vouchers.get(entry.id)
        rows.append(MovementOut(
            entry_id=entry.id, entry_date=entry.entry_date,
            document=(v.document_number if v else entry.number), voucher_id=v.id if v else None,
            kind=(getattr(v.kind, "value", v.kind) if v else None),
            description=(v.description if v and v.description else None)
            or entry.description or line.statement or "",
            debit=dr, credit=cr, balance=to_money(run),
        ))
    branch = db.get(Branch, acc.branch_id) if acc.branch_id else None
    return MovementsOut(
        account_id=acc.id, name=acc.name or "", group_name=parent.name or "",
        branch_name=branch.name if branch else None, opening=to_money(opening), rows=rows,
        total_debit=to_money(tdr), total_credit=to_money(tcr), closing=to_money(run))


class MovementIn(BaseModel):
    kind: str = Field(pattern="^(withdraw|deposit)$")
    amount: Decimal
    treasury_id: int | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)


@router.post("/partners-current/{account_id}/movements", status_code=201)
def post_partner_movement(
    account_id: int,
    body: MovementIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    from fastapi import HTTPException
    acc, _p = _partner_account(db, account_id, current)
    try:
        v = voucher_service.create_partner_movement(
            db, account_id=acc.id, withdraw=body.kind == "withdraw", amount=body.amount,
            actor_user_id=current.id, actor_role=current.role, treasury_id=body.treasury_id,
            voucher_date=body.voucher_date, description=body.description,
            statement1=body.statement1, external_document_number=body.external_document_number)
    except (VoucherError, TreasuryError, LedgerError) as exc:
        raise HTTPException(409, {"code": "conflict", "message": str(exc)}) from exc
    db.commit()
    return {"id": v.id, "document_number": v.document_number, "amount": str(v.amount)}
