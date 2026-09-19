"""كارت الصنف — one item's movement history with a running balance (B3).

A movement list says what happened; a stock card says what you had. The difference is the pair of
figures on every row: the balance before the movement and the balance after it. That is what lets
a storekeeper put a finger on any line and read the quantity as it stood that day, and what lets a
disputed count be traced back to the movement that caused it.

Two rules keep the card honest, and both are tested:

* A balance is only meaningful somewhere. Ask for a location and you get that location's card;
  ask for none and you get the item's whole position across every warehouse and custody.
* Filters hide rows, they never rewrite balances. Showing only sales must not pretend the
  purchases never happened — so the running balance is computed over ALL movements first, and
  the filter is applied afterwards, carrying each surviving row's true before/after with it.
"""
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
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.supplier import Supplier

ZERO_QTY = Decimal("0.000")
ZERO_MONEY = Decimal("0.00")


class ItemCardError(Exception):
    """The item does not exist, or the location asked for is not a real kind."""


ZERO_D = Decimal("0")


def _share(total: Decimal, part: Decimal, whole: Decimal) -> Decimal:
    """`total` split in the proportion `part` bears to `whole`, rounded to money.

    Guarded rather than trusted: a document whose gross is zero (fully discounted, or a
    correction) would divide by nothing, and a report is not the place to raise.
    """
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
            raise ItemCardError("لازم تحدّد الموقع مع نوعه.")

    day_from = _parse_day(date_from)
    day_to = _parse_day(date_to)

    stmt = select(StockMovement).where(StockMovement.item_id == item_id)
    # **عزل الفروع — الكارت بيقول حركة فرع اللي بيقراه.**
    #
    # الكتالوج مشترك بين الفرعين (`Item` مالوش `branch_id`)، فمستخدم العلياء كان بيفتح
    # كارت صنف ويلاقي قدامه «مخزن اكتوبر» و«مخزن الفيوم» بأرصدتهم. الحركة هي اللي
    # بتحمل الفرع (`StockMovement.branch_id` بيتاخد من مكانها)، فالفلترة عليها.
    #
    # و`NULL` داخل مع الفرع — نفس قاعدة `branch_scope.scope` بالحرف: الحركة المكتوبة
    # قبل العزل مالهاش فرع، وإخفاؤها بيفضّي الكارت بدل ما يعزله.
    if branch_id is not None:
        stmt = stmt.where(or_(StockMovement.branch_id == branch_id,
                              StockMovement.branch_id.is_(None)))
    if kind is not None:
        stmt = stmt.where(
            StockMovement.location_kind == kind,
            StockMovement.location_id == location_id,
        )
    # Oldest first: a card is read downwards, and the running balance only makes sense that way.
    # **الترتيب بتاريخ الورقة، والرقم بيفصل التعادل.**
    #
    # كان بالرقم وحده — وهو ترتيب الكتابة عندنا. بعد ما بقى لكل حركة تاريخ ورقتها،
    # الرقم وحده بيدّي رصيد جاري بيمشي عكس التواريخ: سطر يناير بيطلع برصيد اتحسب بعد
    # سطر سبتمبر. والتعادل بيتفصل بالرقم عشان حركات اليوم الواحد تفضل بترتيب كتابتها.
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

        # تاريخ الورقة أولاً، و`created_at` بديل للقديم اللي لسه ما اتعبّاش.
        when = mv.movement_date or _day(mv.created_at)
        # Everything before the window is carried in rather than shown — the balance the period
        # opens with. It is the same number the previous period closed on.
        if day_from is not None and when is not None and when < day_from:
            opening = balance
            continue
        if day_to is not None and when is not None and when > day_to:
            continue
        if movement_type and mv.movement_type != movement_type:
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
            "movement_type": mv.movement_type,
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

    return {
        "item_id": item_id,
        "item_name": item.name,
        "item_code": item.code,
        "unit_of_measure": item.unit_of_measure,
        "location_kind": kind.value if kind else None,
        "location_id": location_id if kind else None,
        "location": (names.get((kind.value, location_id), f"#{location_id}") if kind
                     else "كل المواقع"),
        # The closing balance is the item's real position, whatever the filters hid.
        "opening_balance": str(opening),
        "closing_balance": str(balance),
        "total_in": str(total_in),
        "total_out": str(total_out),
        "rows": rows,
    }


def _document_detail(db: Session, item_id: int, rows: list[dict],
                     names: dict[tuple[str, int], str]) -> None:
    """Fill each row with the party, the document number and the money off its source document.

    Their كارت الصنف carries twenty-six columns; ours carried eight. The missing ones were never
    missing DATA — a sale line has always known its price, its customer and its invoice number.
    They were one join away and the card did not make it, so a storekeeper reading «منصرف ٥» had to
    open the sales screen to find out who took them and for how much.

    Done in bulk per document type: a card can run to hundreds of rows and a query per row turns a
    report into a wait.

    **والنوع بيتسوّى قبل ما يتدوّر عليه.** الحركة المكتوبة من الخدمة الحيّة بتقول `sale`، واللي
    اتنقلت من a5 بتقول `sales_invoice` — نفس الجدول ونفس الـid، اسمين. الكود ده كان بيدوّر على
    الاسم الأول وحده، فالكارت المنقول كله — البيع والشراء والمردود — كان بيطلع بأعمدة فاضية:
    ٦٤٦ سطر في كارت «كوع ٢ باب» مافيهاش ولا اسم عميل ولا سعر واحد. و`stock_docs.names` هو
    المكان الوحيد اللي بيعرف الاسمين، فالتسوية بتنده عليه بدل ما تكتب القايمة تاني هنا.

    Four more of theirs, added after a second reading:

    **الوحده / القطعه.** The card counts in base units — pieces — because that is what stock is
    kept in. The line was SOLD in whatever unit the customer buys by, and «منصرف ٤٨» against a
    document that says «٤ كراتين» is the same fact told two ways with nothing on screen to connect
    them. Both are shown, with the unit named.

    **خصم.** The line discount, which the line has always carried.

    **ض.م.** The document's VAT is charged on the net, and the net moves with the gross, so a
    line's share of the tax is its share of the gross. That is not an estimate — it is the same
    proportional rule `create_return` already uses to decide how much tax to refund, which is a
    money decision the system has been making for some time.

    **والتحويل والإذن ليهم جهة كمان.** التحويل مالوش عميل، بس ليه طرف تاني: السطر الوارد جاي
    **من** مخزن، والمنصرف رايح **إلى** مخزن — والاتنين على نفس الورقة، فالجهة بتتحدد من اتجاه
    الحركة نفسها مش من الورقة. والإذن جهته سببه، وسعره التكلفة المكتوبة على سطره.
    """
    by_type: dict[str, set[int]] = {}
    for r in rows:
        # `sale` و`sales_invoice` نفس المستند — التسوية قبل التجميع عشان الاتنين يتقروا مرة.
        kind = stock_docs.names(r["source_doc_type"])[0] if r["source_doc_type"] else None
        r["_kind"] = kind
        if kind and r["source_doc_id"]:
            by_type.setdefault(kind, set()).add(r["source_doc_id"])
    if not by_type:
        for r in rows:
            r.pop("_kind", None)
        return

    customers = {c.id: c.name for c in db.scalars(select(Customer)).all()}
    suppliers = {s.id: s.name for s in db.scalars(select(Supplier)).all()}

    # (doc_kind, doc_id) -> {party, document_number, unit_price, line_total}
    detail: dict[tuple[str, int], dict] = {}

    sale_ids = by_type.get("sale", set())
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
            detail[("sale", doc_id)] = {
                "party": customers.get(inv.customer_id),
                "document_number": inv.document_number,
                "unit_price": str(ln.unit_price) if ln else None,
                "line_total": str(ln.line_total) if ln else None,
                "unit": ln.unit if ln else None,
                "unit_factor": str(ln.unit_factor) if ln else None,
                "discount_pct": str(ln.discount_pct) if ln else None,
                # The line's share of the gross is its share of the tax, because the net the tax
                # is charged on moves with the gross. A document with no VAT gives every line zero.
                "tax_amount": str(_share(doc_tax, line_total, gross)) if ln else None,
            }

    # A return carries its own customer; the invoice it came off is the fallback for the rows
    # written before that column existed.
    ret_ids = by_type.get("sale_return", set())
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
            detail[("sale_return", ret.id)] = {
                "party": customers.get(customer_id),
                "document_number": ret.document_number,
                "unit_price": str(ln.unit_price) if ln and ln.unit_price is not None else None,
                # A return with no line for this item still has a value — the document's own.
                "line_total": (str(ln.line_total) if ln and ln.line_total is not None
                               else str(ret.value)),
                "unit": ln.unit if ln else None,
                "unit_factor": str(ln.unit_factor) if ln else None,
                "discount_pct": str(ln.discount_pct) if ln else None,
                "tax_amount": str(_share(doc_tax, line_total, gross)) if ln else None,
            }

    buy_ids = by_type.get("purchase", set())
    if buy_ids:
        purchases = {p.id: p for p in db.scalars(
            select(PurchaseInvoice).where(PurchaseInvoice.id.in_(buy_ids))).all()}
        lines = db.scalars(select(PurchaseInvoiceLine).where(
            PurchaseInvoiceLine.item_id == item_id,
            PurchaseInvoiceLine.invoice_id.in_(buy_ids))).all()
        line_of = {ln.invoice_id: ln for ln in lines}
        for doc_id, p in purchases.items():
            ln = line_of.get(doc_id)
            detail[("purchase", doc_id)] = {
                "party": suppliers.get(p.supplier_id),
                "document_number": p.document_number,
                "unit_price": str(ln.unit_price) if ln else None,
                "line_total": str(ln.line_total) if ln else None,
                "unit": ln.unit if ln else None,
                "unit_factor": str(ln.unit_factor) if ln else None,
                # A purchase line carries neither a discount nor its own tax. Empty says so;
                # zero would claim a discount of nothing was agreed.
                "discount_pct": None, "tax_amount": None,
            }

    buy_ret_ids = by_type.get("purchase_return", set())
    if buy_ret_ids:
        from src.models.purchasing import PurchaseReturn, PurchaseReturnLine

        lines = db.scalars(select(PurchaseReturnLine).where(
            PurchaseReturnLine.item_id == item_id,
            PurchaseReturnLine.return_id.in_(buy_ret_ids))).all()
        line_of = {ln.return_id: ln for ln in lines}
        for ret in db.scalars(select(PurchaseReturn).where(
                PurchaseReturn.id.in_(buy_ret_ids))).all():
            ln = line_of.get(ret.id)
            detail[("purchase_return", ret.id)] = {
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

    # **التحويل: الطرف التاني بيتقرا من اتجاه السطر.** الورقة الواحدة بتكتب حركتين — واحدة
    # منصرفة من المصدر وواحدة واردة للوجهة — فمافيش جهة واحدة تنفع للورقة كلها.
    trf_ids = by_type.get("transfer", set())
    if trf_ids:
        from src.models.transfer import StockTransfer

        for t in db.scalars(select(StockTransfer).where(StockTransfer.id.in_(trf_ids))).all():
            src_kind = (t.source_location_kind if isinstance(t.source_location_kind, str)
                        else t.source_location_kind.value)
            dst_kind = (t.dest_location_kind if isinstance(t.dest_location_kind, str)
                        else t.dest_location_kind.value)
            src = names.get((src_kind, t.source_location_id), f"#{t.source_location_id}")
            dst = names.get((dst_kind, t.dest_location_id), f"#{t.dest_location_id}")
            detail[("transfer", t.id)] = {
                "document_number": t.document_number,
                "party_in": f"من {src}", "party_out": f"إلى {dst}",
            }

    permit_ids = by_type.get("stock_permit", set()) | by_type.get("permit", set())
    if permit_ids:
        from src.models.stock_permit import StockPermit, StockPermitLine

        lines = db.scalars(select(StockPermitLine).where(
            StockPermitLine.item_id == item_id,
            StockPermitLine.permit_id.in_(permit_ids))).all()
        line_of = {ln.permit_id: ln for ln in lines}
        for pm in db.scalars(select(StockPermit).where(StockPermit.id.in_(permit_ids))).all():
            ln = line_of.get(pm.id)
            entry = {
                # الإذن مالوش طرف تجاري — سببه هو اللي بيفسّره، وده اللي بيتعرض مكانه.
                "party": pm.reason or None,
                "document_number": pm.document_number,
                "unit_price": str(ln.unit_cost) if ln else None,
                "line_total": str(ln.line_cost) if ln else None,
                "unit": None, "unit_factor": None,
                "discount_pct": None, "tax_amount": None,
            }
            detail[("stock_permit", pm.id)] = entry
            detail[("permit", pm.id)] = entry

    # Expiry: the lot a sale drew from is on the batch trail, keyed by the document that moved it.
    expiry_of: dict[tuple[str, int], str] = {}
    for m in db.scalars(select(StockBatchMovement).where(
            StockBatchMovement.item_id == item_id)).all():
        if m.document_type and m.document_id:
            key = (stock_docs.names(m.document_type)[0], m.document_id)
            # Several lots on one document: the soonest is the one worth showing.
            prev = expiry_of.get(key)
            if prev is None or str(m.expiry_date) < prev:
                expiry_of[key] = str(m.expiry_date)

    for r in rows:
        key = (r.pop("_kind", None), r["source_doc_id"])
        d = detail.get(key, {})
        # التحويل بيدّي جهتين، والسطر بياخد اللي على ناحيته.
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
        # The quantity in the unit it was traded in, beside the pieces the card counts in. Only
        # when the two differ — repeating «٥ قطعة / ٥» on every loose-sold line is noise.
        r["unit"] = d.get("unit")
        factor = d.get("unit_factor")
        r["quantity_in_unit"] = None
        if factor:
            f = Decimal(str(factor))
            if f and f != Decimal("1"):
                # The row's own movement, whichever side it is on. There is no `quantity` key —
                # a card row is `quantity_in` OR `quantity_out`, and reading a key that does not
                # exist would have raised on the first line ever sold by the carton.
                moved = _qty(r["quantity_in"]) + _qty(r["quantity_out"])
                r["quantity_in_unit"] = str(moved / f)


def _location_names(db: Session) -> dict[tuple[str, int], str]:
    """Human labels for (kind, id) so a row reads «مخزن الخامات» not «warehouse #9»."""
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    out: dict[tuple[str, int], str] = {}
    for w in db.scalars(select(Warehouse)).all():
        out[("warehouse", w.id)] = w.name
    users = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    for c in db.scalars(select(Custody)).all():
        out[("custody", c.id)] = f"عهدة {users.get(c.rep_id or 0, f'#{c.rep_id}')}"
    return out
