from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.catalog import Item, ItemKind, ItemPrice, ItemPriceHistory, PriceTier

FIELDS = {
    "purchase_price": "سعر الشراء",
    "sale_price": "سعر البيع",
    PriceTier.consumer.value: "المستهلك",
    PriceTier.commercial.value: "التجاري",
    PriceTier.semi_commercial.value: "نصف التجاري",
    PriceTier.wholesale.value: "الجملة",
    PriceTier.semi_wholesale.value: "نصف الجملة",
}


@dataclass
class Timeline:
    days: list[date] = field(default_factory=list)
    prices: list[Decimal | None] = field(default_factory=list)
    initial: Decimal | None = None

    def at(self, day: date) -> Decimal | None:
        k = bisect_right(self.days, day) - 1
        return self.prices[k] if k >= 0 else self.initial

    def average(self, start: date, end: date) -> Decimal | None:
        if end < start:
            return None
        total, weight = ZERO, 0
        cursor = start
        points = [d for d in self.days if start < d <= end]
        for d in points + [end + timedelta(days=1)]:
            span = (d - cursor).days
            p = self.at(cursor)
            if span > 0 and p is not None:
                total += p * span
                weight += span
            cursor = d
        return to_money(total / weight) if weight else None


def _current(db: Session, item_ids: set[int] | None) -> dict[tuple[int, str], Decimal | None]:
    out: dict[tuple[int, str], Decimal | None] = {}
    stmt = select(Item.id, Item.purchase_price, Item.sale_price).where(Item.kind == ItemKind.product)
    if item_ids is not None:
        stmt = stmt.where(Item.id.in_(item_ids or [-1]))
    for iid, pp, sp in db.execute(stmt).all():
        out[(iid, "purchase_price")] = Decimal(str(pp)) if pp is not None else None
        out[(iid, "sale_price")] = Decimal(str(sp)) if sp is not None else None
    stmt = select(ItemPrice.item_id, ItemPrice.tier, ItemPrice.price)
    if item_ids is not None:
        stmt = stmt.where(ItemPrice.item_id.in_(item_ids or [-1]))
    for iid, tier, price in db.execute(stmt).all():
        out[(iid, tier.value)] = Decimal(str(price)) if price is not None else None
    return out


def timelines(db: Session, *, fields: list[str], item_ids: set[int] | None = None,
              ) -> dict[tuple[int, str], Timeline]:
    current = _current(db, item_ids)
    stmt = (select(ItemPriceHistory.item_id, ItemPriceHistory.field, ItemPriceHistory.old_value,
                   ItemPriceHistory.new_value, ItemPriceHistory.changed_at)
            .where(ItemPriceHistory.field.in_(fields))
            .order_by(ItemPriceHistory.item_id, ItemPriceHistory.field,
                      ItemPriceHistory.changed_at, ItemPriceHistory.id))
    if item_ids is not None:
        stmt = stmt.where(ItemPriceHistory.item_id.in_(item_ids or [-1]))
    out: dict[tuple[int, str], Timeline] = {}
    for iid, fld, old, new, at in db.execute(stmt).all():
        tl = out.get((iid, fld))
        if tl is None:
            tl = out[(iid, fld)] = Timeline(
                initial=Decimal(str(old)) if old is not None else None)
        day = at.date()
        new = Decimal(str(new)) if new is not None else None
        if tl.days and tl.days[-1] == day:
            tl.prices[-1] = new
        else:
            tl.days.append(day)
            tl.prices.append(new)
    for (iid, fld), price in current.items():
        if fld not in fields:
            continue
        tl = out.get((iid, fld))
        if tl is None:
            out[(iid, fld)] = Timeline(initial=price)
        elif tl.prices and tl.prices[-1] != price:
            tl.days.append(date.max)
            tl.prices.append(price)
    return out


def price_list(db: Session, *, as_of: date, compare_to: date | None, fields: list[str],
               q: str | None = None, category: str | None = None, changed_only: bool = False,
               ) -> dict:
    fields = [f for f in fields if f in FIELDS] or ["purchase_price", "sale_price"]
    stmt = select(Item).where(Item.kind == ItemKind.product, Item.active.is_(True))
    if category:
        stmt = stmt.where(Item.category == category)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where((Item.name.ilike(like)) | (Item.code.ilike(like)))
    items = db.scalars(stmt.order_by(Item.category, Item.name)).all()
    ids = {i.id for i in items}
    tls = timelines(db, fields=fields, item_ids=ids)
    last_change = dict(db.execute(
        select(ItemPriceHistory.item_id, func.max(ItemPriceHistory.changed_at))
        .where(ItemPriceHistory.item_id.in_(ids or [-1]), ItemPriceHistory.field.in_(fields),
               ItemPriceHistory.changed_at < datetime.combine(as_of + timedelta(days=1), time.min))
        .group_by(ItemPriceHistory.item_id)).all())
    rows = []
    for it in items:
        prices, changed = {}, False
        for f in fields:
            tl = tls.get((it.id, f))
            now = tl.at(as_of) if tl else None
            before = tl.at(compare_to) if (tl and compare_to) else None
            pct = None
            if now is not None and before not in (None, ZERO) and now != before:
                pct = str(to_money((now - before) / before * 100))
                changed = True
            elif compare_to and now != before:
                changed = True
            prices[f] = {"price": str(now) if now is not None else None,
                         "before": str(before) if before is not None else None,
                         "change_pct": pct}
        if changed_only and not changed:
            continue
        lc = last_change.get(it.id)
        rows.append({"item_id": it.id, "code": it.code, "name": it.name,
                     "category": it.category, "prices": prices,
                     "last_change": lc.date().isoformat() if lc else None})
    return {"as_of": as_of.isoformat(),
            "compare_to": compare_to.isoformat() if compare_to else None,
            "fields": [{"key": f, "label": FIELDS[f]} for f in fields],
            "rows": rows}


def item_history(db: Session, item_id: int) -> dict:
    item = db.get(Item, item_id)
    if item is None:
        return {"item": None, "changes": [], "series": {}}
    from src.models.user import User

    changes = []
    for h, uname in db.execute(
            select(ItemPriceHistory, func.coalesce(User.full_name, User.username))
            .outerjoin(User, User.id == ItemPriceHistory.actor_user_id)
            .where(ItemPriceHistory.item_id == item_id, ItemPriceHistory.field.in_(list(FIELDS)))
            .order_by(ItemPriceHistory.changed_at.desc(), ItemPriceHistory.id.desc())).all():
        changes.append({"field": h.field, "label": FIELDS[h.field],
                        "old": str(h.old_value) if h.old_value is not None else None,
                        "new": str(h.new_value) if h.new_value is not None else None,
                        "at": h.changed_at.isoformat(timespec="minutes"), "by": uname})
    tls = timelines(db, fields=list(FIELDS), item_ids={item_id})
    series = {}
    for (_, f), tl in tls.items():
        pts = []
        if tl.initial is not None and tl.days and tl.days[0] != date.max:
            pts.append({"date": None, "price": str(tl.initial)})
        for d, p in zip(tl.days, tl.prices, strict=True):
            if d != date.max and p is not None:
                pts.append({"date": d.isoformat(), "price": str(p)})
        current = tl.at(date.max)
        if current is not None:
            pts.append({"date": "current", "price": str(current)})
        series[f] = {"label": FIELDS[f], "points": pts}
    purchases = purchase_prices(db, item_ids={item_id}, start=None, end=None, detail=True)
    return {"item": {"id": item.id, "code": item.code, "name": item.name,
                     "category": item.category},
            "changes": changes, "series": series, "purchases": purchases.get(item_id, [])}


def _purchase_unit_expr():
    from src.models.purchasing import PurchaseInvoice, PurchaseInvoiceLine

    base_qty = PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor
    ratio = case((PurchaseInvoice.gross > 0, PurchaseInvoice.net / PurchaseInvoice.gross), else_=1)
    return PurchaseInvoice, PurchaseInvoiceLine, base_qty, PurchaseInvoiceLine.line_total * ratio


def purchase_prices(db: Session, *, item_ids: set[int] | None, start: date | None,
                    end: date | None, detail: bool = False) -> dict:
    inv, line, base_qty, value = _purchase_unit_expr()
    day = func.coalesce(inv.purchase_date, cast(inv.created_at, Date))
    if detail:
        stmt = (select(line.item_id, day, inv.document_number, base_qty, value)
                .join(inv, inv.id == line.invoice_id)
                .where(base_qty > 0).order_by(day.desc(), inv.id.desc()).limit(60))
        if item_ids is not None:
            stmt = stmt.where(line.item_id.in_(item_ids or [-1]))
        out: dict[int, list] = {}
        for iid, d, doc, qty, val in db.execute(stmt).all():
            out.setdefault(iid, []).append({
                "date": d.isoformat() if d else None, "document": doc,
                "quantity": str(qty), "unit_price": str(to_money(Decimal(str(val)) / Decimal(str(qty))))})
        return out
    stmt = (select(line.item_id, func.sum(value), func.sum(base_qty))
            .join(inv, inv.id == line.invoice_id).where(base_qty > 0)
            .group_by(line.item_id))
    if item_ids is not None:
        stmt = stmt.where(line.item_id.in_(item_ids or [-1]))
    if start is not None:
        stmt = stmt.where(day >= start)
    if end is not None:
        stmt = stmt.where(day <= end)
    return {iid: to_money(Decimal(str(v)) / Decimal(str(q)))
            for iid, v, q in db.execute(stmt).all() if q}


def last_purchase_prices(db: Session, *, item_ids: set[int], end: date) -> dict[int, Decimal]:
    inv, line, base_qty, value = _purchase_unit_expr()
    day = func.coalesce(inv.purchase_date, cast(inv.created_at, Date))
    ranked = (select(line.item_id.label("iid"), (value / base_qty).label("unit"),
                     func.row_number().over(partition_by=line.item_id,
                                            order_by=(day.desc(), inv.id.desc(), line.id.desc()))
                     .label("rn"))
              .join(inv, inv.id == line.invoice_id)
              .where(base_qty > 0, day <= end, line.item_id.in_(item_ids or [-1]))).subquery()
    return {iid: to_money(Decimal(str(u))) for iid, u in
            db.execute(select(ranked.c.iid, ranked.c.unit).where(ranked.c.rn == 1)).all()}
