from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, func, or_, select
from sqlalchemy.orm import Session

from src.lib import stock_docs
from src.models.catalog import Item, StockBatchMovement
from src.models.customer import Customer
from src.models.purchasing import PurchaseInvoice, PurchaseInvoiceLine
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn
from src.models.stock import LocationKind, StockDirection, StockDoc, StockMovement
from src.models.supplier import Supplier

ZERO_QTY = Decimal("0.000")
ZERO_MONEY = Decimal("0.00")


class ItemCardError(Exception):
    pass


ZERO_D = Decimal("0")


def _share(total: Decimal, part: Decimal, whole: Decimal) -> Decimal:
    if not whole:
        return ZERO_D
    return (total * part / whole).quantize(Decimal("0.01"))


def _qty(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.001"))


def _day(value: datetime | date | None) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    return value


def _parse_day(value: str | date | None) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return date.fromisoformat(str(value)[:10])


def card(
    db: Session,
    *,
    item_id: int,
    location_kind: str | None = None,
    location_id: int | None = None,
    date_from: str | date | None = None,
    date_to: str | date | None = None,
    movement_type: str | None = None,
    direction: str | None = None,
    branch_id: int | None = None,
) -> dict:
    item = db.get(Item, item_id)
    if item is None:
        raise ItemCardError("الصنف غير موجود.")

    kind: LocationKind | None = None
    if location_kind:
        try:
            kind = LocationKind(location_kind)
        except ValueError as exc:
            raise ItemCardError("نوع الموقع غير صحيح.") from exc
        if location_id is None:
            raise ItemCardError("حدّد الموقع ونوعه.")

    day_from = _parse_day(date_from)
    day_to = _parse_day(date_to)

    stmt = select(StockMovement).where(StockMovement.item_id == item_id)
    if branch_id is not None:
        stmt = stmt.where(or_(StockMovement.branch_id == branch_id,
                              StockMovement.branch_id.is_(None)))
    if kind is not None:
        stmt = stmt.where(
            StockMovement.location_kind == kind,
            StockMovement.location_id == location_id,
        )
    movements = db.scalars(stmt.order_by(
        func.coalesce(StockMovement.movement_date,
                      func.cast(StockMovement.created_at, Date)),
        StockMovement.id,
    )).all()

    names = _location_names(db)

    opening = ZERO_QTY
    rows: list[dict] = []
    balance = ZERO_QTY
    total_in = total_out = ZERO_QTY

    for mv in movements:
        signed = _qty(mv.quantity) if mv.direction == StockDirection.in_ else -_qty(mv.quantity)
        before = balance
        balance = _qty(balance + signed)

        when = mv.movement_date or _day(mv.created_at)
        if day_from is not None and when is not None and when < day_from:
            opening = balance
            continue
        if day_to is not None and when is not None and when > day_to:
            continue
        if movement_type and (stock_docs.canonical(mv.movement_type, kind="movement")
                              != stock_docs.canonical(movement_type, kind="movement")):
            continue
        if direction and mv.direction.value != direction:
            continue

        quantity = _qty(mv.quantity)
        is_in = mv.direction == StockDirection.in_
        total_in = _qty(total_in + quantity) if is_in else total_in
        total_out = total_out if is_in else _qty(total_out + quantity)

        loc_kind = (mv.location_kind if isinstance(mv.location_kind, str)
                    else mv.location_kind.value)
        rows.append({
            "movement_id": mv.id,
            "date": str(when) if when else None,
            "movement_type": stock_docs.canonical(mv.movement_type, kind="movement")
                             or mv.movement_type,
            "movement_label": stock_docs.movement_label(mv.movement_type, mv.source_doc_type),
            "direction": mv.direction.value,
            "quantity_in": str(quantity if is_in else ZERO_QTY),
            "quantity_out": str(ZERO_QTY if is_in else quantity),
            "balance_before": str(before),
            "balance_after": str(balance),
            "location_kind": loc_kind,
            "location_id": mv.location_id,
            "location": names.get((loc_kind, mv.location_id), f"#{mv.location_id}"),
            "source_doc_type": mv.source_doc_type,
            "source_doc_id": mv.source_doc_id,
            "is_reversal": mv.reverses_movement_id is not None,
        })

    _document_detail(db, item_id, rows, names)
    rows.reverse()

    return {
        "item_id": item_id,
        "item_name": item.name,
        "item_code": item.code,
        "unit_of_measure": item.unit_of_measure,
        "location_kind": kind.value if kind else None,
        "location_id": location_id if kind else None,
        "location": (names.get((kind.value, location_id), f"#{location_id}") if kind
                     else "كل المواقع"),
        "opening_balance": str(opening),
        "closing_balance": str(balance),
        "total_in": str(total_in),
        "total_out": str(total_out),
        "rows": rows,
    }


def _document_detail(db: Session, item_id: int, rows: list[dict],
                     names: dict[tuple[str, int], str]) -> None:
    by_type: dict[str, set[int]] = {}
    for r in rows:
        kind = stock_docs.canonical(r["source_doc_type"])
        r["_kind"] = kind
        if kind and r["source_doc_id"]:
            by_type.setdefault(kind, set()).add(r["source_doc_id"])
    if not by_type:
        for r in rows:
            r.pop("_kind", None)
        return

    customers = {c.id: c.name for c in db.scalars(select(Customer)).all()}
    suppliers = {s.id: s.name for s in db.scalars(select(Supplier)).all()}

    detail: dict[tuple[str, int], dict] = {}

    sale_ids = by_type.get(StockDoc.SALE, set())
    if sale_ids:
        invoices = {i.id: i for i in db.scalars(
            select(SalesInvoice).where(SalesInvoice.id.in_(sale_ids))).all()}
        lines = db.scalars(select(SalesInvoiceLine).where(
            SalesInvoiceLine.item_id == item_id,
            SalesInvoiceLine.invoice_id.in_(sale_ids))).all()
        line_of = {ln.invoice_id: ln for ln in lines}
        for doc_id, inv in invoices.items():
            ln = line_of.get(doc_id)
            gross = Decimal(str(inv.gross or 0))
            doc_tax = Decimal(str(getattr(inv, "tax_amount", 0) or 0))
            line_total = Decimal(str(ln.line_total)) if ln else ZERO_D
            detail[(StockDoc.SALE, doc_id)] = {
                "party": customers.get(inv.customer_id),
                "document_number": inv.document_number,
                "unit_price": str(ln.unit_price) if ln else None,
                "line_total": str(ln.line_total) if ln else None,
                "unit": ln.unit if ln else None,
                "unit_factor": str(ln.unit_factor) if ln else None,
                "discount_pct": str(ln.discount_pct) if ln else None,
                "tax_amount": str(_share(doc_tax, line_total, gross)) if ln else None,
            }

    ret_ids = by_type.get(StockDoc.SALE_RETURN, set())
    if ret_ids:
        from src.models.sales import SalesReturnLine

        ret_lines = db.scalars(select(SalesReturnLine).where(
            SalesReturnLine.item_id == item_id,
            SalesReturnLine.return_id.in_(ret_ids))).all()
        line_of = {ln.return_id: ln for ln in ret_lines}
        for ret in db.scalars(select(SalesReturn).where(SalesReturn.id.in_(ret_ids))).all():
            ln = line_of.get(ret.id)
            customer_id = ret.customer_id
            if customer_id is None and ret.sales_invoice_id:
                inv = db.get(SalesInvoice, ret.sales_invoice_id)
                customer_id = inv.customer_id if inv else None
            gross = Decimal(str(ret.gross or 0))
            doc_tax = Decimal(str(ret.tax_amount or 0))
            line_total = Decimal(str(ln.line_total or 0)) if ln else ZERO_D
            detail[(StockDoc.SALE_RETURN, ret.id)] = {
                "party": customers.get(customer_id),
                "document_number": ret.document_number,
                "unit_price": str(ln.unit_price) if ln and ln.unit_price is not None else None,
                "line_total": (str(ln.line_total) if ln and ln.line_total is not None
                               else str(ret.value)),
                "unit": ln.unit if ln else None,
                "unit_factor": str(ln.unit_factor) if ln else None,
                "discount_pct": str(ln.discount_pct) if ln else None,
                "tax_amount": str(_share(doc_tax, line_total, gross)) if ln else None,
            }

    buy_ids = by_type.get(StockDoc.PURCHASE, set())
    if buy_ids:
        purchases = {p.id: p for p in db.scalars(
            select(PurchaseInvoice).where(PurchaseInvoice.id.in_(buy_ids))).all()}
        lines = db.scalars(select(PurchaseInvoiceLine).where(
            PurchaseInvoiceLine.item_id == item_id,
            PurchaseInvoiceLine.invoice_id.in_(buy_ids))).all()
        line_of = {ln.invoice_id: ln for ln in lines}
        for doc_id, p in purchases.items():
            ln = line_of.get(doc_id)
            detail[(StockDoc.PURCHASE, doc_id)] = {
                "party": suppliers.get(p.supplier_id),
                "document_number": p.document_number,
                "unit_price": str(ln.unit_price) if ln else None,
                "line_total": str(ln.line_total) if ln else None,
                "unit": ln.unit if ln else None,
                "unit_factor": str(ln.unit_factor) if ln else None,
                "discount_pct": None, "tax_amount": None,
            }

    buy_ret_ids = by_type.get(StockDoc.PURCHASE_RETURN, set())
    if buy_ret_ids:
        from src.models.purchasing import PurchaseReturn, PurchaseReturnLine

        lines = db.scalars(select(PurchaseReturnLine).where(
            PurchaseReturnLine.item_id == item_id,
            PurchaseReturnLine.return_id.in_(buy_ret_ids))).all()
        line_of = {ln.return_id: ln for ln in lines}
        for ret in db.scalars(select(PurchaseReturn).where(
                PurchaseReturn.id.in_(buy_ret_ids))).all():
            ln = line_of.get(ret.id)
            detail[(StockDoc.PURCHASE_RETURN, ret.id)] = {
                "party": suppliers.get(ret.supplier_id),
                "document_number": ret.document_number,
                "unit_price": str(ln.unit_price) if ln else None,
                "line_total": str(ln.line_total) if ln else None,
                "unit": ln.unit if ln else None,
                "unit_factor": str(ln.unit_factor) if ln else None,
                "discount_pct": (str(ln.discount_pct) if ln and ln.discount_pct is not None
                                 else None),
                "tax_amount": None,
            }

    trf_ids = by_type.get(StockDoc.TRANSFER, set())
    if trf_ids:
        from src.models.transfer import StockTransfer

        for t in db.scalars(select(StockTransfer).where(StockTransfer.id.in_(trf_ids))).all():
            src_kind = (t.source_location_kind if isinstance(t.source_location_kind, str)
                        else t.source_location_kind.value)
            dst_kind = (t.dest_location_kind if isinstance(t.dest_location_kind, str)
                        else t.dest_location_kind.value)
            src = names.get((src_kind, t.source_location_id), f"#{t.source_location_id}")
            dst = names.get((dst_kind, t.dest_location_id), f"#{t.dest_location_id}")
            detail[(StockDoc.TRANSFER, t.id)] = {
                "document_number": t.document_number,
                "party_in": f"من {src}", "party_out": f"إلى {dst}",
            }

    permit_ids = by_type.get(StockDoc.PERMIT, set())
    if permit_ids:
        from src.models.stock_permit import StockPermit, StockPermitLine

        lines = db.scalars(select(StockPermitLine).where(
            StockPermitLine.item_id == item_id,
            StockPermitLine.permit_id.in_(permit_ids))).all()
        line_of = {ln.permit_id: ln for ln in lines}
        for pm in db.scalars(select(StockPermit).where(StockPermit.id.in_(permit_ids))).all():
            ln = line_of.get(pm.id)
            entry = {
                "party": pm.reason or None,
                "document_number": pm.document_number,
                "unit_price": str(ln.unit_cost) if ln else None,
                "line_total": str(ln.line_cost) if ln else None,
                "unit": None, "unit_factor": None,
                "discount_pct": None, "tax_amount": None,
            }
            detail[(StockDoc.PERMIT, pm.id)] = entry

    expiry_of: dict[tuple[str, int], str] = {}
    for m in db.scalars(select(StockBatchMovement).where(
            StockBatchMovement.item_id == item_id)).all():
        if m.document_type and m.document_id:
            key = (stock_docs.canonical(m.document_type), m.document_id)
            prev = expiry_of.get(key)
            if prev is None or str(m.expiry_date) < prev:
                expiry_of[key] = str(m.expiry_date)

    for r in rows:
        key = (r.pop("_kind", None), r["source_doc_id"])
        d = detail.get(key, {})
        if "party_in" in d:
            r["party"] = d["party_in"] if r["direction"] == "in" else d["party_out"]
        else:
            r["party"] = d.get("party")
        r["document_number"] = d.get("document_number")
        r["unit_price"] = d.get("unit_price")
        r["line_total"] = d.get("line_total")
        r["expiry_date"] = expiry_of.get(key)
        r["discount_pct"] = d.get("discount_pct")
        r["tax_amount"] = d.get("tax_amount")
        r["unit"] = d.get("unit")
        factor = d.get("unit_factor")
        r["quantity_in_unit"] = None
        if factor:
            f = Decimal(str(factor))
            if f and f != Decimal("1"):
                moved = _qty(r["quantity_in"]) + _qty(r["quantity_out"])
                r["quantity_in_unit"] = str(moved / f)


def _location_names(db: Session) -> dict[tuple[str, int], str]:
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    out: dict[tuple[str, int], str] = {}
    for w in db.scalars(select(Warehouse)).all():
        out[("warehouse", w.id)] = w.name
    users = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    for c in db.scalars(select(Custody)).all():
        out[("custody", c.id)] = f"عهدة {users.get(c.rep_id or 0, f'#{c.rep_id}')}"
    return out
