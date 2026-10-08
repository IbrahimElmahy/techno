from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, String, and_, case, cast, func, literal, select, true
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.lookup import LookupOption
from src.models.org import Branch
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.user import User
from src.models.warehouse import Custody, Warehouse
from src.services import lookup_service

DIMENSIONS = ("item", "category", "main_category", "warehouse", "branch", "movement_type",
              "day", "month", "year")

TYPE_GROUPS = {
    "purchase": ("purchase",),
    "purchase_return": ("purchase_return",),
    "sale": ("sale",),
    "sales_return": ("sales_return",),
    "transfer_in": ("transfer_in",),
    "transfer_out": ("transfer_out",),
    "production_in": ("production_in",),
    "consumption_out": ("consumption_out",),
    "permit_in": ("permit_in", "permit:in_"),
    "permit_out": ("permit_out", "permit:out", "reverse_permit_in"),
    "opening": ("opening",),
}

TYPE_LABELS = {
    "purchase": "مشتريات", "purchase_return": "مردود مشتريات", "sale": "مبيعات",
    "sales_return": "مردود مبيعات", "transfer_in": "تحويل وارد", "transfer_out": "تحويل صادر",
    "production_in": "إنتاج", "consumption_out": "صرف خامات", "permit_in": "إذن إضافة",
    "permit_out": "إذن صرف", "opening": "رصيد أول المدة", "permit": "إذن",
    "reverse_permit_in": "إلغاء إذن إضافة", "wastage": "هالك",
}

MAX_ROWS = 20000


class StockAnalysisError(Exception):
    pass


def analyse(
    db: Session,
    *,
    dims: list[str] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    branch_id: int | None = None,
    warehouse_id: int | None = None,
    item_id: int | None = None,
    category: str | None = None,
    include_custody: bool = False,
    hide_zero: bool = True,
) -> dict:
    dims = [d for d in (dims or []) if d]
    bad = [d for d in dims if d not in DIMENSIONS]
    if bad:
        raise StockAnalysisError(f"بعد غير معروف: {', '.join(bad)}")

    m = StockMovement
    when = func.coalesce(m.movement_date, cast(m.created_at, Date))
    signed = case((m.direction == StockDirection.in_, m.quantity), else_=-m.quantity)
    before = (when < date_from) if date_from else None
    inside = []
    if date_from:
        inside.append(when >= date_from)
    if date_to:
        inside.append(when <= date_to)
    in_range = and_(*inside) if inside else true()
    upto = (when <= date_to) if date_to else true()
    has_period = any(d in ("day", "month", "year", "movement_type") for d in dims)

    def s(expr):
        return func.coalesce(func.sum(expr), 0)

    buy_net = (func.coalesce(Item.purchase_price, 0)
               * (100 - func.coalesce(Item.purchase_discount_pct, 0)) / 100)
    closing_cond = in_range if has_period else upto

    type_key = case(
        (and_(m.movement_type == "permit", m.direction == StockDirection.in_), "permit_in"),
        (m.movement_type == "permit", "permit_out"),
        (m.movement_type == "reverse_permit_in", "permit_out"),
        else_=m.movement_type)

    exprs = {
        "item": m.item_id, "category": Item.category, "main_category": Item.category,
        "warehouse": m.location_id, "branch": Warehouse.branch_id,
        "movement_type": type_key, "day": when,
        "month": func.date_trunc("month", when), "year": func.date_trunc("year", when),
    }
    cols, group = [], []
    for d in dims:
        cols.append(exprs[d].label(f"{d}__k"))
        group.append(exprs[d])
    if "warehouse" in dims:
        cols.append(func.max(cast(m.location_kind, String)).label("loc_kind"))

    measures = [
        s(case((before, signed), else_=0)).label("opening") if before is not None
        else literal(0).label("opening"),
        s(case((and_(in_range, m.direction == StockDirection.in_), m.quantity), else_=0)).label("in_qty"),
        s(case((and_(in_range, m.direction == StockDirection.out), m.quantity), else_=0)).label("out_qty"),
        s(case((upto, signed), else_=0)).label("closing"),
        func.count(case((in_range, m.id))).label("moves"),
        s(case((closing_cond, signed * buy_net), else_=0)).label("cost_value"),
        s(case((closing_cond, signed * func.coalesce(Item.sale_price, 0)), else_=0)).label("sale_value"),
    ]
    for key in TYPE_GROUPS:
        measures.append(s(case((and_(in_range, type_key == key), m.quantity), else_=0)).label(f"t_{key}"))

    stmt = (select(*cols, *measures).select_from(m)
            .outerjoin(Item, Item.id == m.item_id)
            .outerjoin(Warehouse, and_(m.location_kind == LocationKind.warehouse,
                                       Warehouse.id == m.location_id)))
    if not include_custody:
        stmt = stmt.where(m.location_kind == LocationKind.warehouse)
    if date_to:
        stmt = stmt.where(when <= date_to)
    if has_period and date_from:
        stmt = stmt.where(when >= date_from)
    if branch_id is not None:
        stmt = stmt.where(Warehouse.branch_id == branch_id)
    if warehouse_id is not None:
        stmt = stmt.where(m.location_kind == LocationKind.warehouse, m.location_id == warehouse_id)
    if item_id is not None:
        stmt = stmt.where(m.item_id == item_id)
    if category:
        stmt = stmt.where(Item.category.in_(
            lookup_service.with_children(db, lookup_service.ITEM_CATEGORY, category)))
    if group:
        stmt = stmt.group_by(*group)

    raw = db.execute(stmt.limit(MAX_ROWS * 3)).mappings().all()

    items = {i.id: i for i in db.scalars(select(Item)).all()}
    warehouses = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}
    custodies = {c.id: c for c in db.scalars(select(Custody)).all()}
    users = {u.id: u.full_name for u in db.scalars(select(User)).all()}
    branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}
    cat_labels = dict(db.execute(select(LookupOption.value, LookupOption.label)
                                 .where(LookupOption.category == lookup_service.ITEM_CATEGORY)).all())
    parents = lookup_service.parent_map(db, lookup_service.ITEM_CATEGORY)

    def label(d, k, r):
        if d == "item":
            it = items.get(k)
            return it.name if it else f"#{k}"
        if d in ("category", "main_category"):
            return cat_labels.get(k) or k or "بدون فئة"
        if d == "warehouse":
            if r.get("loc_kind") == LocationKind.warehouse.name or k in warehouses:
                return warehouses.get(k, f"#{k}")
            c = custodies.get(k)
            return f"عهدة {users.get(c.rep_id, '') or k}" if c else f"عهدة #{k}"
        if d == "branch":
            return branches.get(k, "بدون فرع")
        if d == "movement_type":
            return TYPE_LABELS.get(k, k)
        if d == "day":
            return str(k)[:10]
        if d == "month":
            return str(k)[:7]
        if d == "year":
            return str(k)[:4]
        return str(k)

    names = ["opening", "in_qty", "out_qty", "closing", "moves", "cost_value", "sale_value",
             *[f"t_{k}" for k in TYPE_GROUPS]]
    merged: dict[tuple, dict] = {}
    for r in raw:
        keys, out = [], {}
        for d in dims:
            k = r[f"{d}__k"]
            if d == "main_category":
                k = lookup_service.root_of(parents, k)
            if d in ("day", "month", "year") and k is not None:
                k = str(k)[:10]
            keys.append(k)
            out[d] = label(d, k, r)
            out[f"{d}_id"] = k
        tk = tuple(keys)
        cur = merged.get(tk)
        if cur is None:
            for n in names:
                out[n] = Decimal(str(r[n] or 0))
            merged[tk] = out
        else:
            for n in names:
                cur[n] += Decimal(str(r[n] or 0))

    hundred = Decimal(100)
    rows = []
    for v in merged.values():
        if has_period:
            v["opening"] = Decimal(0)
            v["closing"] = v["in_qty"] - v["out_qty"]
        if hide_zero and not any(v[n] for n in names if n != "moves"):
            continue
        it = items.get(v.get("item_id")) if "item" in dims else None
        out = {k: v[k] for k in v if k not in names}
        for n in names:
            out[n] = (int(v[n]) if n == "moves" else str(to_money(v[n]))
                      if n in ("cost_value", "sale_value") else str(to_qty(v[n])))
        out["closing_cost_value"] = out.pop("cost_value")
        out["closing_sale_value"] = out.pop("sale_value")
        if it is not None:
            out["code"] = it.code
            out["unit"] = it.unit_of_measure
            out["category_name"] = cat_labels.get(it.category) or it.category
            buy = Decimal(str(it.purchase_price or 0))
            disc = Decimal(str(it.purchase_discount_pct or 0))
            net_buy = buy * (hundred - disc) / hundred
            sell = Decimal(str(it.sale_price or 0))
            out["purchase_price"] = str(to_money(net_buy))
            out["sale_price"] = str(to_money(sell))
            out["min_stock"] = str(to_qty(it.min_stock)) if it.min_stock is not None else None
            out["max_stock"] = str(to_qty(it.max_stock)) if it.max_stock is not None else None
        rows.append(out)
        if len(rows) >= MAX_ROWS:
            break

    rows.sort(key=lambda x: tuple(str(x.get(d) or "") for d in dims))
    totals = {}
    for n in names:
        if n in ("cost_value", "sale_value"):
            continue
        tot = sum((Decimal(str(r.get(n) or 0)) for r in rows), Decimal(0))
        totals[n] = int(tot) if n == "moves" else str(to_qty(tot))
    for n in ("closing_cost_value", "closing_sale_value"):
        totals[n] = str(to_money(sum((Decimal(str(r.get(n) or 0)) for r in rows), Decimal(0))))
    return {"dims": dims, "rows": rows, "totals": totals, "truncated": len(rows) >= MAX_ROWS,
            "type_labels": {k: TYPE_LABELS[k] for k in TYPE_GROUPS}}

