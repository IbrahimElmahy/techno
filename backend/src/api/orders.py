"""طلبات البيع والشراء router (B9).

An order is pre-trade paperwork: it moves no stock, owes no money and reserves nothing. It exists
so a quotation or a supply request can be written, found again and turned into the invoice it was
always meant to become — exactly once.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SALES_READ
from src.core.db import get_db
from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.trade_order import OrderKind, OrderStatus, TradeOrder, TradeOrderLine

# Guarded by the read capability on purpose: an order posts nothing — no stock, no ledger, no
# debt — so it carries none of the risk the write capabilities exist to gate. The real gate is on
# the invoice it becomes, which goes through the normal sales/purchase endpoint and their checks.
# It also means a purchasing manager can raise a purchase order without being granted sale.write.
router = APIRouter(tags=["orders"], prefix="/orders")

_PREFIX = {OrderKind.sale: "SO", OrderKind.purchase: "PO"}


class OrderLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal = Decimal("0")
    notes: str | None = None


class OrderIn(BaseModel):
    kind: str  # sale | purchase
    customer_id: int | None = None
    supplier_id: int | None = None
    order_date: date | None = None
    due_date: date | None = None
    warehouse_id: int | None = None
    branch_id: int | None = None
    notes: str | None = None
    lines: list[OrderLineIn]


class OrderLineOut(BaseModel):
    id: int
    item_id: int
    item_name: str | None = None
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal
    notes: str | None = None


class OrderOut(BaseModel):
    id: int
    document_number: str
    kind: str
    status: str
    customer_id: int | None
    supplier_id: int | None
    order_date: date | None
    due_date: date | None
    warehouse_id: int | None
    total: Decimal
    notes: str | None
    converted_invoice_id: int | None
    converted_at: datetime | None
    created_at: datetime | None
    lines: list[OrderLineOut] = []


class ConvertIn(BaseModel):
    invoice_id: int


def _out(db: Session, o: TradeOrder) -> OrderOut:
    names = {
        i.id: i.name for i in db.scalars(
            select(Item).where(Item.id.in_([ln.item_id for ln in o.lines] or [0]))).all()
    }
    return OrderOut(
        id=o.id, document_number=o.document_number, kind=o.kind.value, status=o.status.value,
        customer_id=o.customer_id, supplier_id=o.supplier_id, order_date=o.order_date,
        due_date=o.due_date, warehouse_id=o.warehouse_id, total=o.total, notes=o.notes,
        converted_invoice_id=o.converted_invoice_id, converted_at=o.converted_at,
        created_at=o.created_at,
        lines=[OrderLineOut(
            id=ln.id, item_id=ln.item_id, item_name=names.get(ln.item_id),
            quantity=ln.quantity, unit_price=ln.unit_price, line_total=ln.line_total,
            notes=ln.notes) for ln in o.lines],
    )


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderIn,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> OrderOut:
    """طلب بيع أو طلب شراء — no stock moves and nothing is reserved; this is paperwork."""
    try:
        kind = OrderKind(body.kind)
    except ValueError as exc:
        raise HTTPException(422, {"code": "validation",
                                  "message": "نوع الطلب غير صحيح."}) from exc
    if not body.lines:
        raise HTTPException(422, {"code": "validation", "message": "لازم سطر واحد على الأقل."})
    if kind == OrderKind.sale and not body.customer_id:
        raise HTTPException(422, {"code": "validation", "message": "اختر العميل."})
    if kind == OrderKind.purchase and not body.supplier_id:
        raise HTTPException(422, {"code": "validation", "message": "اختر المورد."})

    n = db.scalar(select(func.count()).select_from(TradeOrder).where(
        TradeOrder.kind == kind)) or 0
    order = TradeOrder(
        document_number=f"{_PREFIX[kind]}-{n + 1:06d}", kind=kind,
        customer_id=body.customer_id, supplier_id=body.supplier_id,
        order_date=body.order_date, due_date=body.due_date, warehouse_id=body.warehouse_id,
        branch_id=body.branch_id, notes=body.notes, total=ZERO, actor_user_id=current.id,
    )
    db.add(order)
    db.flush()

    total = ZERO
    for raw in body.lines:
        if db.get(Item, raw.item_id) is None:
            raise HTTPException(422, {"code": "validation", "message": "صنف غير موجود."})
        quantity = to_qty(raw.quantity)
        if quantity <= to_qty(0):
            raise HTTPException(422, {"code": "validation",
                                      "message": "الكمية لازم تكون أكبر من صفر."})
        line_total = to_money(quantity * to_money(raw.unit_price))
        total = to_money(total + line_total)
        db.add(TradeOrderLine(
            order_id=order.id, item_id=raw.item_id, quantity=quantity,
            unit_price=to_money(raw.unit_price), line_total=line_total, notes=raw.notes))
    order.total = total
    db.flush()
    out = _out(db, order)
    db.commit()
    return out


@router.get("", response_model=list[OrderOut])
def list_orders(
    kind: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    customer_id: int | None = Query(None),
    supplier_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> list[OrderOut]:
    stmt = select(TradeOrder).options(selectinload(TradeOrder.lines))
    try:
        if kind:
            stmt = stmt.where(TradeOrder.kind == OrderKind(kind))
        if status_filter:
            stmt = stmt.where(TradeOrder.status == OrderStatus(status_filter))
    except ValueError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    if customer_id:
        stmt = stmt.where(TradeOrder.customer_id == customer_id)
    if supplier_id:
        stmt = stmt.where(TradeOrder.supplier_id == supplier_id)
    rows = db.scalars(stmt.order_by(TradeOrder.id.desc())).all()
    return [_out(db, o) for o in rows]


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> OrderOut:
    order = db.scalar(select(TradeOrder).options(selectinload(TradeOrder.lines))
                      .where(TradeOrder.id == order_id))
    if order is None:
        raise HTTPException(404, {"code": "not_found", "message": "الطلب غير موجود."})
    return _out(db, order)


@router.post("/{order_id}/convert", response_model=OrderOut)
def mark_converted(
    order_id: int,
    body: ConvertIn,
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> OrderOut:
    """Record which invoice this order became — a one-way door.

    The invoice itself is created through the normal sales/purchase endpoint, so it goes through
    every check a real invoice goes through (availability, costing, the ledger). This only stamps
    the link, and refuses to stamp it twice: an order that could be converted again would quietly
    double the sale.
    """
    order = db.scalar(select(TradeOrder).options(selectinload(TradeOrder.lines))
                      .where(TradeOrder.id == order_id))
    if order is None:
        raise HTTPException(404, {"code": "not_found", "message": "الطلب غير موجود."})
    if order.status == OrderStatus.converted:
        raise HTTPException(409, {"code": "already_converted",
                                  "message": "الطلب اتحوّل لفاتورة قبل كده."})
    if order.status == OrderStatus.cancelled:
        raise HTTPException(409, {"code": "cancelled", "message": "الطلب ملغي."})
    order.converted_invoice_id = body.invoice_id
    order.converted_at = datetime.now()
    order.status = OrderStatus.converted
    db.flush()
    out = _out(db, order)
    db.commit()
    return out


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(
    order_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> OrderOut:
    """An order that was never invoiced can simply be cancelled — nothing was posted."""
    order = db.scalar(select(TradeOrder).options(selectinload(TradeOrder.lines))
                      .where(TradeOrder.id == order_id))
    if order is None:
        raise HTTPException(404, {"code": "not_found", "message": "الطلب غير موجود."})
    if order.status == OrderStatus.converted:
        raise HTTPException(409, {"code": "already_converted",
                                  "message": "الطلب اتحوّل لفاتورة — ما ينفعش يتلغي."})
    order.status = OrderStatus.cancelled
    db.flush()
    out = _out(db, order)
    db.commit()
    return out
