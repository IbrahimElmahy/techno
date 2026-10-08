from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, Numeric, String, and_, case, cast, func, literal, or_, select, union_all
from sqlalchemy.orm import Session, aliased

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.customer import Customer
from src.models.lookup import LookupOption
from src.models.org import Branch, Governorate, Territory
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.models.supplier import Supplier
from src.models.user import User
from src.models.warehouse import Warehouse
from src.services import lookup_service

SIDES = ("sales", "purchases")

DIMENSIONS = {
    "sales": ("document", "day", "month", "year", "party", "party_type", "rep", "territory",
              "main_territory", "governorate", "markaz", "branch", "warehouse", "item",
              "category", "main_category", "price_tier", "kind"),
    "purchases": ("document", "day", "month", "year", "party", "party_type", "rep",
                  "governorate", "branch", "warehouse", "item", "category", "main_category",
                  "kind"),
}

TIER_LABELS = {
    "commercial": "تجاري", "semi_commercial": "نصف تجاري", "wholesale": "جملة",
    "semi_wholesale": "نصف جملة", "consumer": "مستهلك", "list_price": "سعر القائمة",
}
CUSTOMER_TYPES = {"trader": "تاجر / موزع", "plumber": "فني سباكة", "employee": "موظف",
                  "other": "آخر", "owner": "شريك"}
KIND_LABELS = {"sale": "بيع", "return": "مردود"}

MAX_ROWS = 20000


class TradeAnalysisError(Exception):
    pass


def _ratio(net, gross):
    return case((gross > 0, cast(net, Numeric(30, 10)) / gross), else_=literal(1))


def _sales_union(include_bonus: bool):
    si, sl = SalesInvoice, SalesInvoiceLine
    sr, rl = SalesReturn, SalesReturnLine
    one = literal(1)
    sale = (
        select(
            literal("sale").label("kind"),
            si.id.label("doc_id"), si.document_number.label("doc_no"),
            func.coalesce(si.invoice_date, cast(si.created_at, Date)).label("d"),
            si.branch_id.label("branch_id"),
            func.coalesce(sl.location_id, si.origin_location_id).label("loc_id"),
            si.customer_id.label("party_id"), si.rep_id.label("rep_id"),
            sl.item_id.label("item_id"), cast(sl.price_tier, String(24)).label("tier"),
            (sl.quantity * func.coalesce(sl.unit_factor, one)).label("qty"),
            (sl.quantity * sl.unit_price).label("gross"),
            (sl.line_total * _ratio(si.net, si.gross)).label("amount"),
            case((and_(sl.unit_price > 0, sl.unit_cost > sl.unit_price * 3), None),
                 else_=sl.unit_cost * sl.quantity).label("cost"),
            si.is_bonus.label("is_bonus"),
        )
        .join(si, si.id == sl.invoice_id)
    )
    if not include_bonus:
        sale = sale.where(or_(si.is_bonus.is_(None), si.is_bonus.is_(False)))
    ret_amount = func.coalesce(
        rl.line_total,
        rl.quantity * func.coalesce(rl.unit_price, 0)
        * (100 - func.coalesce(rl.discount_pct, 0)) / 100)
    ret = (
        select(
            literal("return").label("kind"),
            sr.id.label("doc_id"), sr.document_number.label("doc_no"),
            func.coalesce(sr.return_date, cast(sr.created_at, Date)).label("d"),
            sr.branch_id.label("branch_id"),
            func.coalesce(rl.location_id, sr.origin_location_id).label("loc_id"),
            sr.customer_id.label("party_id"), sr.rep_id.label("rep_id"),
            rl.item_id.label("item_id"), cast(literal(None), String(24)).label("tier"),
            (-rl.quantity * func.coalesce(rl.unit_factor, one)).label("qty"),
            (-rl.quantity * func.coalesce(rl.unit_price, 0)).label("gross"),
            (-ret_amount * _ratio(sr.value, sr.gross)).label("amount"),
            case((and_(func.coalesce(rl.unit_price, 0) > 0, rl.unit_cost > rl.unit_price * 3), None),
                 else_=-rl.unit_cost * rl.quantity).label("cost"),
            cast(literal(None), Boolean).label("is_bonus"),
        )
        .join(sr, sr.id == rl.return_id)
        .where(sr.reversed_at.is_(None))
    )
    return union_all(sale, ret).subquery("ln")


def _purchases_union():
    pi, pl = PurchaseInvoice, PurchaseInvoiceLine
    pr, rl = PurchaseReturn, PurchaseReturnLine
    one = literal(1)
    buy = (
        select(
            literal("sale").label("kind"),
            pi.id.label("doc_id"), pi.document_number.label("doc_no"),
            func.coalesce(pi.purchase_date, cast(pi.created_at, Date)).label("d"),
            pi.branch_id.label("branch_id"),
            func.coalesce(pl.line_location_id, pi.location_id).label("loc_id"),
            pi.supplier_id.label("party_id"), pi.rep_id.label("rep_id"),
            pl.item_id.label("item_id"), cast(literal(None), String(24)).label("tier"),
            (pl.quantity * func.coalesce(pl.unit_factor, one)).label("qty"),
            (pl.quantity * pl.unit_price).label("gross"),
            (pl.line_total * _ratio(pi.net, pi.gross)).label("amount"),
            cast(literal(None), Numeric(18, 2)).label("cost"),
            cast(literal(None), Boolean).label("is_bonus"),
        )
        .join(pi, pi.id == pl.invoice_id)
    )
    orig = aliased(PurchaseInvoice)
    ret = (
        select(
            literal("return").label("kind"),
            pr.id.label("doc_id"), pr.document_number.label("doc_no"),
            func.coalesce(pr.return_date, cast(pr.created_at, Date)).label("d"),
            pr.branch_id.label("branch_id"),
            func.coalesce(rl.line_location_id, pr.origin_location_id, orig.location_id).label("loc_id"),
            func.coalesce(pr.supplier_id, orig.supplier_id).label("party_id"),
            orig.rep_id.label("rep_id"),
            rl.item_id.label("item_id"), cast(literal(None), String(24)).label("tier"),
            (-rl.quantity * func.coalesce(rl.unit_factor, one)).label("qty"),
            (-rl.quantity * rl.unit_price).label("gross"),
            (-rl.line_total * _ratio(pr.value, pr.gross)).label("amount"),
            cast(literal(None), Numeric(18, 2)).label("cost"),
            cast(literal(None), Boolean).label("is_bonus"),
        )
        .join(pr, pr.id == rl.return_id)
        .outerjoin(orig, orig.id == pr.purchase_invoice_id)
        .where(pr.reversed_at.is_(None))
    )
    return union_all(buy, ret).subquery("ln")


def analyse(
    db: Session,
    *,
    side: str = "sales",
    dims: list[str] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    branch_id: int | None = None,
    warehouse_id: int | None = None,
    party_id: int | None = None,
    party_type: str | None = None,
    rep_id: int | None = None,
    territory_id: int | None = None,
    governorate_id: int | None = None,
    item_id: int | None = None,
    category: str | None = None,
    price_tier: str | None = None,
    kind: str | None = None,
    include_bonus: bool = True,
) -> dict:
    if side not in SIDES:
        raise TradeAnalysisError("side")
    dims = [d for d in (dims or []) if d]
    bad = [d for d in dims if d not in DIMENSIONS[side]]
    if bad:
        raise TradeAnalysisError(f"بعد غير معروف: {', '.join(bad)}")
    if len(dims) != len(set(dims)):
        raise TradeAnalysisError("لا يجوز تكرار نفس البعد")

    ln = _sales_union(include_bonus) if side == "sales" else _purchases_union()
    sales = side == "sales"
    Party = Customer if sales else Supplier
    party = aliased(Party)
    terr = aliased(Territory)
    main_terr = aliased(Territory)

    exprs: dict[str, tuple] = {}
    if "document" in dims:
        exprs["document"] = (ln.c.doc_id, ln.c.doc_no)
    exprs["day"] = (ln.c.d, None)
    exprs["month"] = (func.date_trunc("month", ln.c.d), None)
    exprs["year"] = (func.date_trunc("year", ln.c.d), None)
    exprs["party"] = (ln.c.party_id, party.name)
    exprs["party_type"] = ((party.customer_type if sales else party.supplier_type), None)
    exprs["rep"] = (ln.c.rep_id, User.full_name)
    exprs["governorate"] = (party.governorate_id, Governorate.name)
    exprs["markaz"] = (party.markaz, None)
    if sales:
        exprs["territory"] = (party.territory_id, terr.name)
        exprs["main_territory"] = (func.coalesce(terr.parent_id, terr.id), main_terr.name)
        exprs["price_tier"] = (ln.c.tier, None)
    exprs["branch"] = (ln.c.branch_id, Branch.name)
    exprs["warehouse"] = (ln.c.loc_id, None)
    exprs["item"] = (ln.c.item_id, Item.name)
    exprs["category"] = (Item.category, None)
    exprs["main_category"] = (Item.category, None)
    exprs["kind"] = (ln.c.kind, None)

    qty = func.sum(ln.c.qty)
    sold_qty = func.sum(case((ln.c.kind == "sale", ln.c.qty), else_=0))
    returned_qty = func.sum(case((ln.c.kind == "return", -ln.c.qty), else_=0))
    gross = func.sum(case((ln.c.kind == "sale", ln.c.gross), else_=0))
    sales_value = func.sum(case((ln.c.kind == "sale", ln.c.amount), else_=0))
    returns_value = func.sum(case((ln.c.kind == "return", -ln.c.amount), else_=0))
    net_value = func.sum(ln.c.amount)
    cost = func.sum(func.coalesce(ln.c.cost, 0))
    costed_value = func.sum(case((ln.c.cost.is_not(None), ln.c.amount), else_=0))
    missing_cost = func.sum(case((and_(ln.c.cost.is_(None), ln.c.qty != 0, ln.c.amount != 0), 1),
                                 else_=0))
    docs = func.count(func.distinct(case((ln.c.kind == "sale", ln.c.doc_id))))
    return_docs = func.count(func.distinct(case((ln.c.kind == "return", ln.c.doc_id))))
    parties = func.count(func.distinct(ln.c.party_id))
    items = func.count(func.distinct(ln.c.item_id))

    cols = []
    group = []
    for d in dims:
        key, label = exprs[d]
        cols.append(key.label(f"{d}__k"))
        group.append(key)
        if label is not None:
            cols.append(func.max(label).label(f"{d}__l"))
    if "document" in dims:
        cols.append(func.max(ln.c.d).label("document__date"))
        cols.append(func.max(ln.c.kind).label("document__kind"))
        cols.append(func.max(party.name).label("document__party"))
        cols.append(func.max(User.full_name).label("document__rep"))
    stmt = select(*cols, qty.label("qty"), sold_qty.label("sold_qty"),
                  returned_qty.label("returned_qty"), gross.label("gross"),
                  sales_value.label("sales_value"), returns_value.label("returns_value"),
                  net_value.label("net_value"), cost.label("cost"),
                  costed_value.label("costed_value"),
                  missing_cost.label("missing_cost"), docs.label("docs"),
                  return_docs.label("return_docs"), parties.label("parties"),
                  items.label("items")).select_from(ln)

    stmt = stmt.outerjoin(party, party.id == ln.c.party_id)
    stmt = stmt.outerjoin(User, User.id == ln.c.rep_id)
    stmt = stmt.outerjoin(Item, Item.id == ln.c.item_id)
    stmt = stmt.outerjoin(Branch, Branch.id == ln.c.branch_id)
    stmt = stmt.outerjoin(Governorate, Governorate.id == party.governorate_id)
    if sales:
        stmt = stmt.outerjoin(terr, terr.id == party.territory_id)
        stmt = stmt.outerjoin(main_terr, main_terr.id == func.coalesce(terr.parent_id, terr.id))

    if date_from:
        stmt = stmt.where(ln.c.d >= date_from)
    if date_to:
        stmt = stmt.where(ln.c.d <= date_to)
    if branch_id is not None:
        stmt = stmt.where(or_(ln.c.branch_id == branch_id, ln.c.branch_id.is_(None)))
    if warehouse_id is not None:
        stmt = stmt.where(ln.c.loc_id == warehouse_id)
    if party_id is not None:
        stmt = stmt.where(ln.c.party_id == party_id)
    if party_type:
        stmt = stmt.where((party.customer_type if sales else party.supplier_type) == party_type)
    if rep_id is not None:
        stmt = stmt.where(ln.c.rep_id == rep_id)
    if territory_id is not None and sales:
        stmt = stmt.where(or_(party.territory_id == territory_id, terr.parent_id == territory_id))
    if governorate_id is not None:
        stmt = stmt.where(party.governorate_id == governorate_id)
    if item_id is not None:
        stmt = stmt.where(ln.c.item_id == item_id)
    if category:
        stmt = stmt.where(Item.category.in_(
            lookup_service.with_children(db, lookup_service.ITEM_CATEGORY, category)))
    if price_tier and sales:
        stmt = stmt.where(ln.c.tier == price_tier)
    if kind in ("sale", "return"):
        stmt = stmt.where(ln.c.kind == kind)

    if group:
        stmt = stmt.group_by(*group)
    rows_raw = db.execute(stmt.limit(MAX_ROWS + 1)).mappings().all()
    truncated = len(rows_raw) > MAX_ROWS
    rows_raw = rows_raw[:MAX_ROWS]

    warehouses = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}
    cat_labels = dict(db.execute(
        select(LookupOption.value, LookupOption.label)
        .where(LookupOption.category == lookup_service.ITEM_CATEGORY)).all())
    parents = lookup_service.parent_map(db, lookup_service.ITEM_CATEGORY) \
        if "main_category" in dims else {}

    def label_of(d: str, key, row) -> str:
        if key is None:
            return {"party_type": "غير محدد", "category": "بدون فئة", "main_category": "بدون فئة",
                    "price_tier": "غير محدد", "rep": "بدون مندوب", "territory": "بدون منطقة",
                    "main_territory": "بدون منطقة", "governorate": "بدون محافظة",
                    "markaz": "بدون مدينة", "branch": "بدون فرع",
                    "warehouse": "غير محدد"}.get(d, "—")
        if d in ("day",):
            return str(key)[:10]
        if d == "month":
            return str(key)[:7]
        if d == "year":
            return str(key)[:4]
        if d == "party_type":
            return CUSTOMER_TYPES.get(str(key), str(key))
        if d == "price_tier":
            k = getattr(key, "value", key)
            return TIER_LABELS.get(str(k), str(k))
        if d in ("category", "main_category"):
            return cat_labels.get(key) or str(key)
        if d == "warehouse":
            return warehouses.get(key, f"عهدة #{key}")
        if d == "kind":
            return KIND_LABELS.get(key, key)
        if d == "markaz":
            return str(key)
        lab = row.get(f"{d}__l")
        return lab if lab else f"#{key}"

    measures = ("qty", "sold_qty", "returned_qty", "gross", "sales_value", "returns_value",
                "net_value", "cost", "costed_value", "missing_cost", "docs", "return_docs", "parties", "items")
    merged: dict[tuple, dict] = {}
    for r in rows_raw:
        keys = []
        out = {}
        for d in dims:
            k = r[f"{d}__k"]
            if d == "main_category":
                k = lookup_service.root_of(parents, k)
            if d == "price_tier":
                k = getattr(k, "value", k)
            if d in ("day", "month", "year") and k is not None:
                k = str(k)[:10]
            keys.append(k)
            out[f"{d}"] = label_of(d, k, r)
            out[f"{d}_id"] = k if not isinstance(k, (date,)) else str(k)
        if "document" in dims:
            out["document_date"] = str(r["document__date"]) if r["document__date"] else None
            out["document_kind"] = KIND_LABELS.get(r["document__kind"], r["document__kind"])
            out["document_party"] = r["document__party"]
            out["document_rep"] = r["document__rep"]
        tk = tuple(keys)
        cur = merged.get(tk)
        if cur is None:
            for m in measures:
                out[m] = r[m] or 0
            merged[tk] = out
        else:
            for m in measures:
                cur[m] = (cur[m] or 0) + (r[m] or 0)

    rows = [_finish(v, sales) for v in merged.values()]
    rows.sort(key=lambda x: tuple(
        (x.get(f"{d}_id") or "") if d in ("day", "month", "year") else "" for d in dims)
        + (-Decimal(x["net_value"]),))
    totals = _finish({m: sum((Decimal(str(v[m] or 0)) for v in merged.values()), Decimal(0))
                      for m in measures}, sales)
    return {"side": side, "dims": dims, "rows": rows, "totals": totals,
            "truncated": truncated}


def _finish(v: dict, sales: bool) -> dict:
    out = dict(v)
    for m in ("qty", "sold_qty", "returned_qty"):
        out[m] = str(to_qty(Decimal(str(v.get(m) or 0))))
    for m in ("gross", "sales_value", "returns_value", "net_value", "cost", "costed_value"):
        out[m] = str(to_money(Decimal(str(v.get(m) or 0))))
    for m in ("missing_cost", "docs", "return_docs", "parties", "items"):
        out[m] = int(v.get(m) or 0)
    gross = Decimal(out["gross"])
    sales_value = Decimal(out["sales_value"])
    net = Decimal(out["net_value"])
    out["discount"] = str(to_money(gross - sales_value))
    out["discount_pct"] = str(to_money((gross - sales_value) * 100 / gross)) if gross else "0.00"
    q = Decimal(out["qty"])
    out["avg_price"] = str(to_money(net / q)) if q else "0.00"
    out["returns_pct"] = (str(to_money(Decimal(out["returns_value"]) * 100 / sales_value))
                          if sales_value else "0.00")
    if sales:
        cost = Decimal(out["cost"])
        costed = Decimal(out["costed_value"])
        out["profit"] = str(to_money(costed - cost))
        out["margin_pct"] = str(to_money((costed - cost) * 100 / costed)) if costed else "0.00"
    else:
        out["profit"] = None
        out["margin_pct"] = None
    return out
