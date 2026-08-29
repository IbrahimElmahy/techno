"""تقارير مندوبين — three of their report screens — 031-a5-restructure.

Their menu lists four: تحصيلات المندوبين · تحصيلات المندوبين عملاء · مبيعات اصناف مندوبين ·
عمولة تحصيلات مندوبين. The fourth already existed (عمولات المناديب, on the finance screen). These
are the other three.

Nothing new is recorded to build them — a receipt voucher has always carried who took it and from
whom, and an invoice has always carried its rep. What was missing was reading it that way round.

**The rep on an invoice, not the user who typed it.** `rep_id` is the salesman the sale belongs to;
`actor_user_id` is whoever was at the keyboard. Commission has always been computed off the actor,
and for a rep entering their own sales those are the same person — but an office clerk entering a
rep's paperwork makes them different, and a sales report must follow the salesman. Where an invoice
carries no rep, its customer's rep answers for it, because that is who the account belongs to.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_VOUCHER_READ, RoleName
from src.core.db import get_db
from src.core.money import to_money
from src.models.catalog import Item
from src.models.customer import Customer
from src.models.sales import SalesInvoice
from src.models.user import Role, User
from src.models.voucher import Voucher, VoucherKind

router = APIRouter(tags=["rep-reports"], prefix="/rep-reports")

ZERO = Decimal("0.00")


class CollectionRow(BaseModel):
    rep_user_id: int
    rep_name: str
    receipts: int
    collected: Decimal


class CollectionByCustomerRow(BaseModel):
    rep_user_id: int
    rep_name: str
    customer_id: int | None
    customer_name: str | None
    receipts: int
    collected: Decimal


class RepItemRow(BaseModel):
    rep_user_id: int
    rep_name: str
    item_id: int
    item_name: str
    quantity: Decimal
    net: Decimal


def _reps(db: Session) -> dict[int, str]:
    rows = db.scalars(
        select(User).join(Role, User.role_id == Role.id).where(Role.name == RoleName.sales_rep)
    ).all()
    return {r.id: (r.full_name or r.username) for r in rows}


def _in_window(when: date | None, date_from: date | None, date_to: date | None) -> bool:
    if when is None:
        return False
    if date_from and when < date_from:
        return False
    if date_to and when > date_to:
        return False
    return True


def _scope(current: CurrentUser, rep_id: int | None) -> int | None:
    """A rep sees their own figures and nobody else's — the same rule the commission report uses."""
    return current.id if current.role == RoleName.sales_rep else rep_id


def _receipts(db: Session, date_from, date_to, rep_id: int | None) -> list[Voucher]:
    rows = db.scalars(select(Voucher).where(Voucher.kind == VoucherKind.receipt)).all()
    out = []
    for v in rows:
        if rep_id is not None and v.actor_user_id != rep_id:
            continue
        if not _in_window(v.voucher_date, date_from, date_to):
            continue
        out.append(v)
    return out


def _signed(v: Voucher) -> Decimal:
    """A reversal mirrors its original, so it subtracts rather than adding a second time."""
    amount = to_money(v.amount)
    return -amount if v.reverses_id is not None else amount


@router.get("/collections", response_model=list[CollectionRow])
def collections(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    rep_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[CollectionRow]:
    """تحصيلات المندوبين — what each rep brought in over a period, and how many receipts."""
    reps = _reps(db)
    scope = _scope(current, rep_id)

    totals: dict[int, tuple[int, Decimal]] = {}
    for v in _receipts(db, date_from, date_to, scope):
        if v.actor_user_id not in reps:
            continue
        count, amount = totals.get(v.actor_user_id, (0, ZERO))
        totals[v.actor_user_id] = (count + 1, amount + _signed(v))

    rows = [
        CollectionRow(rep_user_id=rid, rep_name=reps[rid], receipts=c, collected=to_money(a))
        for rid, (c, a) in totals.items()
    ]
    rows.sort(key=lambda r: r.collected, reverse=True)
    return rows


@router.get("/collections-by-customer", response_model=list[CollectionByCustomerRow])
def collections_by_customer(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    rep_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[CollectionByCustomerRow]:
    """تحصيلات المندوبين عملاء — the same money, broken down by who it came from.

    A receipt with no customer keeps its row rather than being dropped: it is money the rep really
    collected, and a total that quietly disagrees with تحصيلات المندوبين is worse than a row
    labelled «بدون عميل».
    """
    reps = _reps(db)
    scope = _scope(current, rep_id)
    names = {c.id: c.name for c in db.scalars(select(Customer)).all()}

    totals: dict[tuple[int, int | None], tuple[int, Decimal]] = {}
    for v in _receipts(db, date_from, date_to, scope):
        if v.actor_user_id not in reps:
            continue
        key = (v.actor_user_id, v.customer_id)
        count, amount = totals.get(key, (0, ZERO))
        totals[key] = (count + 1, amount + _signed(v))

    rows = [
        CollectionByCustomerRow(
            rep_user_id=rid, rep_name=reps[rid], customer_id=cid,
            customer_name=names.get(cid) if cid else None,
            receipts=c, collected=to_money(a),
        )
        for (rid, cid), (c, a) in totals.items()
    ]
    rows.sort(key=lambda r: (r.rep_name, -r.collected))
    return rows


@router.get("/items", response_model=list[RepItemRow])
def rep_items(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    rep_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[RepItemRow]:
    """مبيعات اصناف مندوبين — what each rep sold, item by item.

    Line value is taken net of the invoice's discount so the totals here can be compared with the
    invoice ones. Using the gross line would make a rep's «sales» exceed what the customer was
    actually billed.
    """
    reps = _reps(db)
    scope = _scope(current, rep_id)
    items = {i.id: i.name for i in db.scalars(select(Item)).all()}
    customer_rep = {c.id: c.rep_id for c in db.scalars(select(Customer)).all()}

    invoices = db.scalars(
        branch_scope.scope(select(SalesInvoice), SalesInvoice, current)
        .options(selectinload(SalesInvoice.lines))
    ).all()

    totals: dict[tuple[int, int], tuple[Decimal, Decimal]] = {}
    for inv in invoices:
        # The salesman the sale belongs to, falling back to whoever owns the account.
        rid = inv.rep_id or customer_rep.get(inv.customer_id)
        if rid is None or rid not in reps:
            continue
        if scope is not None and rid != scope:
            continue
        when = inv.created_at.date() if inv.created_at else None
        if not _in_window(when, date_from, date_to):
            continue

        gross = to_money(inv.gross or 0)
        net = to_money(inv.net or 0)
        # One ratio for the whole invoice: the discount is agreed on the document, not per line.
        ratio = (net / gross) if gross > ZERO else Decimal("1")

        for ln in inv.lines:
            key = (rid, ln.item_id)
            qty, value = totals.get(key, (Decimal("0.000"), ZERO))
            line_total = to_money(Decimal(str(ln.line_total or 0)) * ratio)
            totals[key] = (qty + Decimal(str(ln.quantity or 0)), value + line_total)

    rows = [
        RepItemRow(
            rep_user_id=rid, rep_name=reps[rid], item_id=iid,
            item_name=items.get(iid, f"#{iid}"), quantity=qty, net=to_money(value),
        )
        for (rid, iid), (qty, value) in totals.items()
    ]
    rows.sort(key=lambda r: (r.rep_name, -r.net))
    return rows
