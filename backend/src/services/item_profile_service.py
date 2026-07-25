"""Item search + the 360° product file — 027-item-360.

What the catalog screen could never answer before: how much of this item is where, who bought
it, who we bought it from, every movement it ever made, and when its price changed and by how
much. All derived — nothing new is stored except the price-change log.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.catalog import Item, ItemKind, ItemPrice, ItemPriceHistory
from src.models.purchasing import PurchaseInvoice, PurchaseInvoiceLine
from src.models.sales import SalesInvoice, SalesInvoiceLine
from src.models.stock import StockDirection, StockMovement


class ItemProfileError(Exception):
    """The item does not exist."""


ZERO_QTY = Decimal("0.000")


def _qty(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.001"))


# ------------------------------------------------------------------------ on-hand


def bulk_on_hand(db: Session, item_ids: list[int] | None = None) -> dict[int, Decimal]:
    """Total on-hand per item across every location — ONE grouped query for the whole page."""
    signed = case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    )
    stmt = (
        select(StockMovement.item_id, func.coalesce(func.sum(signed), 0))
        .group_by(StockMovement.item_id)
    )
    if item_ids is not None:
        if not item_ids:
            return {}
        stmt = stmt.where(StockMovement.item_id.in_(item_ids))
    return {iid: _qty(total) for iid, total in db.execute(stmt).all()}


# ------------------------------------------------------------------------- search


def apply_filters(
    stmt: Select,
    *,
    q: str | None = None,
    kind: str | None = None,
    category: str | None = None,
    active: bool | None = None,
    warehouse_id: int | None = None,
) -> Select:
    """`q` matches code, name or category (partial). `warehouse_id` = the item's default store."""
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Item.name.like(needle), Item.code.like(needle), Item.category.like(needle))
        )
    if kind:
        stmt = stmt.where(Item.kind == ItemKind(kind))
    if category:
        stmt = stmt.where(Item.category == category)
    if active is not None:
        stmt = stmt.where(Item.active.is_(active))
    if warehouse_id is not None:
        stmt = stmt.where(Item.default_warehouse_id == warehouse_id)
    return stmt


def filter_by_stock(
    rows: list[Item], on_hand: dict[int, Decimal], stock_filter: str | None
) -> list[Item]:
    """`in_stock` = has quantity, `out_of_stock` = zero, `negative` = below zero (data problem)."""
    if not stock_filter or stock_filter == "all":
        return rows
    def keep(i: Item) -> bool:
        q = on_hand.get(i.id, ZERO_QTY)
        if stock_filter == "in_stock":
            return q > 0
        if stock_filter == "out_of_stock":
            return q == 0
        if stock_filter == "negative":
            return q < 0
        return True
    return [i for i in rows if keep(i)]


# ------------------------------------------------------------------------ profile


@dataclass
class Profile:
    item_id: int
    on_hand: Decimal
    stock_by_location: list[dict] = field(default_factory=list)
    sold_quantity: Decimal = ZERO_QTY
    sold_value: Decimal = ZERO
    purchased_quantity: Decimal = ZERO_QTY
    purchased_value: Decimal = ZERO
    avg_sale_price: Decimal = ZERO
    avg_purchase_price: Decimal = ZERO
    sales: list[dict] = field(default_factory=list)
    purchases: list[dict] = field(default_factory=list)
    movements: list[dict] = field(default_factory=list)
    price_history: list[dict] = field(default_factory=list)
    tier_prices: list[dict] = field(default_factory=list)


def _as_date(value: date | datetime | None) -> str | None:
    if isinstance(value, datetime):
        return str(value.date())
    return str(value) if value else None


def _location_names(db: Session) -> dict[tuple[str, int], str]:
    """Human labels for (kind, id) so movements read «مخزن الخامات» not «warehouse #9»."""
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    out: dict[tuple[str, int], str] = {}
    for w in db.scalars(select(Warehouse)).all():
        out[("warehouse", w.id)] = w.name
    users = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    for c in db.scalars(select(Custody)).all():
        label = users.get(c.rep_id or 0, f"#{c.rep_id}")
        out[("custody", c.id)] = f"عهدة {label}"
    return out


def profile(db: Session, item_id: int, *, limit: int = 200) -> Profile:
    item = db.get(Item, item_id)
    if item is None:
        raise ItemProfileError("الصنف غير موجود.")

    names = _location_names(db)

    # --- stock, per location and in total ---
    signed = case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    )
    per_location = db.execute(
        select(StockMovement.location_kind, StockMovement.location_id,
               func.coalesce(func.sum(signed), 0))
        .where(StockMovement.item_id == item_id)
        .group_by(StockMovement.location_kind, StockMovement.location_id)
    ).all()
    stock_rows = []
    total = ZERO_QTY
    for kind, loc_id, qty in per_location:
        k = getattr(kind, "value", str(kind))
        q = _qty(qty)
        total += q
        stock_rows.append({
            "location_kind": k,
            "location_id": loc_id,
            "location": names.get((k, loc_id), f"{k} #{loc_id}"),
            "quantity": str(q),
        })
    stock_rows.sort(key=lambda r: Decimal(r["quantity"]), reverse=True)

    # --- sales of this item ---
    sale_rows = db.execute(
        select(SalesInvoiceLine, SalesInvoice)
        .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
        .where(SalesInvoiceLine.item_id == item_id)
        .order_by(SalesInvoice.id.desc()).limit(limit)
    ).all()
    customer_names = _customer_names(db, [inv.customer_id for _, inv in sale_rows])
    sales = [
        {
            "invoice_id": inv.id,
            "document_number": inv.document_number,
            "date": _as_date(inv.created_at),
            "party": customer_names.get(inv.customer_id, f"#{inv.customer_id}"),
            "quantity": str(ln.quantity),
            "unit": ln.unit,
            "unit_price": str(to_money(ln.unit_price)),
            "line_total": str(to_money(ln.line_total)),
            "tier": getattr(ln.price_tier, "value", ln.price_tier),
        }
        for ln, inv in sale_rows
    ]
    sold_qty, sold_value = db.execute(
        select(func.coalesce(func.sum(SalesInvoiceLine.quantity), 0),
               func.coalesce(func.sum(SalesInvoiceLine.line_total), 0))
        .where(SalesInvoiceLine.item_id == item_id)
    ).one()

    # --- purchases of this item ---
    purchase_rows = db.execute(
        select(PurchaseInvoiceLine, PurchaseInvoice)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id == item_id)
        .order_by(PurchaseInvoice.id.desc()).limit(limit)
    ).all()
    supplier_names = _supplier_names(db, [inv.supplier_id for _, inv in purchase_rows])
    purchases = [
        {
            "invoice_id": inv.id,
            "document_number": inv.document_number,
            "date": _as_date(inv.created_at),
            "party": supplier_names.get(inv.supplier_id, f"#{inv.supplier_id}"),
            "quantity": str(ln.quantity),
            "unit": ln.unit,
            "unit_price": str(to_money(ln.unit_price)),
            "line_total": str(to_money(ln.line_total)),
        }
        for ln, inv in purchase_rows
    ]
    bought_qty, bought_value = db.execute(
        select(func.coalesce(func.sum(PurchaseInvoiceLine.quantity), 0),
               func.coalesce(func.sum(PurchaseInvoiceLine.line_total), 0))
        .where(PurchaseInvoiceLine.item_id == item_id)
    ).one()

    # --- every stock movement, newest first ---
    movements = [
        {
            "id": m.id,
            "date": _as_date(m.created_at),
            "movement_type": m.movement_type,
            "direction": getattr(m.direction, "value", str(m.direction)),
            "quantity": str(_qty(m.quantity)),
            "location": names.get(
                (getattr(m.location_kind, "value", str(m.location_kind)), m.location_id),
                f"#{m.location_id}"),
            "source": f"{m.source_doc_type or ''} {m.source_doc_id or ''}".strip() or "-",
            "is_reversal": m.reverses_movement_id is not None,
        }
        for m in db.scalars(
            select(StockMovement).where(StockMovement.item_id == item_id)
            .order_by(StockMovement.id.desc()).limit(limit)
        ).all()
    ]

    # --- price history + the current tier prices ---
    history = [
        {
            "id": h.id,
            "field": h.field,
            "old_value": str(to_money(h.old_value)) if h.old_value is not None else None,
            "new_value": str(to_money(h.new_value)) if h.new_value is not None else None,
            "changed_at": _as_date(h.changed_at),
            "actor_user_id": h.actor_user_id,
        }
        for h in db.scalars(
            select(ItemPriceHistory).where(ItemPriceHistory.item_id == item_id)
            .order_by(ItemPriceHistory.id.desc()).limit(limit)
        ).all()
    ]
    tiers = [
        {"tier": getattr(p.tier, "value", str(p.tier)), "price": str(to_money(p.price))}
        for p in db.scalars(select(ItemPrice).where(ItemPrice.item_id == item_id)).all()
    ]

    sold_qty = _qty(sold_qty)
    bought_qty = _qty(bought_qty)
    return Profile(
        item_id=item_id,
        on_hand=total,
        stock_by_location=stock_rows,
        sold_quantity=sold_qty,
        sold_value=to_money(sold_value),
        purchased_quantity=bought_qty,
        purchased_value=to_money(bought_value),
        avg_sale_price=to_money(Decimal(str(sold_value)) / sold_qty) if sold_qty else ZERO,
        avg_purchase_price=(to_money(Decimal(str(bought_value)) / bought_qty)
                            if bought_qty else ZERO),
        sales=sales,
        purchases=purchases,
        movements=movements,
        price_history=history,
        tier_prices=tiers,
    )


def _customer_names(db: Session, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    from src.models.customer import Customer

    return {i: n for i, n in db.execute(
        select(Customer.id, Customer.name).where(Customer.id.in_(set(ids)))).all()}


def _supplier_names(db: Session, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    from src.models.supplier import Supplier

    return {i: n for i, n in db.execute(
        select(Supplier.id, Supplier.name).where(Supplier.id.in_(set(ids)))).all()}


# ------------------------------------------------------------------ price logging


def record_price_change(
    db: Session, *, item_id: int, field_name: str, old_value, new_value, actor_user_id: int | None,
) -> None:
    """Append one price-change row — no-ops when the value did not actually move."""
    old = Decimal(str(old_value)) if old_value is not None else None
    new = Decimal(str(new_value)) if new_value is not None else None
    if old == new:
        return
    db.add(ItemPriceHistory(item_id=item_id, field=field_name, old_value=old, new_value=new,
                            actor_user_id=actor_user_id))
    db.flush()
