"""One engine behind the sales and purchase reports — B4.

The system we are replacing ships roughly sixteen of these: sales by invoice, sales by invoice
grouped, sales by item, sales by item grouped, the same four for purchases, both sets of returns,
plus invoice profit, item profit, and margin by warehouse and by customer. They are not sixteen
reports — they are two levels of detail crossed with a handful of groupings, over four document
kinds. Writing them as one parameterised engine keeps a single definition of "revenue" and "cost";
sixteen hand-written queries would drift apart the first time a discount rule changed.

Profit only appears on sales, and only because the cost of goods was frozen onto the line at the
moment it sold (030). Deriving cost at report time would let next month's purchase price quietly
rewrite last month's margin.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.customer import Customer
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.models.supplier import Supplier
from src.models.warehouse import Warehouse

ZERO_QTY = Decimal("0.000")

DOC_TYPES = ("sale", "sale_return", "purchase", "purchase_return")
LEVELS = ("document", "line")
GROUPS = ("none", "party", "item", "warehouse")

# Profit is only meaningful where we sold something and captured what it cost us.
_PROFIT_DOCS = ("sale", "sale_return")


class TradeReportError(Exception):
    pass


def _as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)).date()


def _in_range(when, date_from: date | None, date_to: date | None) -> bool:
    d = _as_date(when)
    if d is None:
        return False
    if date_from and d < date_from:
        return False
    if date_to and d > date_to:
        return False
    return True


def _names(db: Session) -> tuple[dict, dict, dict, dict]:
    items = {i.id: (i.code, i.name, i.unit_of_measure) for i in db.scalars(select(Item)).all()}
    customers = {c.id: c.name for c in db.scalars(select(Customer)).all()}
    suppliers = {s.id: s.name for s in db.scalars(select(Supplier)).all()}
    warehouses = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}
    return items, customers, suppliers, warehouses


def _collect(db: Session, doc_type: str, date_from, date_to, party_id, item_id, warehouse_id):
    """Flatten one document kind into a common row shape the rest of the engine works on.

    Every document kind ends up as: (document, party_id, line-ish facts). Doing the flattening
    once here is what lets the grouping and totalling code below be written a single time.

    The row's `date` is the document's own date — `invoice_date` / `purchase_date` /
    `return_date` — and never `created_at`, which only records when the row was written here.
    The two are far apart for everything migrated from a5: 8,014 invoices spanning January to
    August all carry a `created_at` of the two days the migration ran, so reading `created_at`
    put every one of them outside every real reporting period. `created_at` stays as the
    fallback for a document saved without a date of its own.
    """
    rows: list[dict] = []

    if doc_type == "sale":
        pairs = db.execute(
            select(SalesInvoiceLine, SalesInvoice)
            .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
            .order_by(SalesInvoice.id)
        ).all()
        for ln, doc in pairs:
            rows.append({
                "doc_id": doc.id, "document_number": doc.document_number,
                "date": _as_date(doc.invoice_date or doc.created_at),
                "party_id": doc.customer_id,
                "item_id": ln.item_id, "warehouse_id": ln.location_id or doc.origin_location_id,
                "quantity": to_qty(ln.quantity),
                "amount": to_money(ln.line_total),
                # Frozen at sale time; NULL on invoices written before 030.
                "cost": (to_money(Decimal(str(ln.unit_cost)) * Decimal(str(ln.quantity)))
                         if ln.unit_cost is not None else None),
                "doc_net": to_money(doc.net),
            })

    elif doc_type == "sale_return":
        pairs = db.execute(
            select(SalesReturnLine, SalesReturn)
            .join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id)
            .order_by(SalesReturn.id)
        ).all()
        for ln, doc in pairs:
            # An invoice-bound return carries no price of its own — its value came from the
            # original invoice — so fall back to the document's value share.
            amount = to_money(ln.line_total) if ln.line_total is not None else ZERO
            rows.append({
                "doc_id": doc.id, "document_number": doc.document_number,
                "date": _as_date(doc.return_date or doc.created_at),
                "party_id": doc.customer_id,
                "item_id": ln.item_id,
                "warehouse_id": ln.location_id or doc.origin_location_id,
                "quantity": to_qty(ln.quantity),
                "amount": amount,
                "cost": (to_money(Decimal(str(ln.unit_cost)) * Decimal(str(ln.quantity)))
                         if ln.unit_cost is not None else None),
                "doc_net": to_money(doc.value),
            })

    elif doc_type == "purchase":
        pairs = db.execute(
            select(PurchaseInvoiceLine, PurchaseInvoice)
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
            .order_by(PurchaseInvoice.id)
        ).all()
        for ln, doc in pairs:
            rows.append({
                "doc_id": doc.id, "document_number": doc.document_number,
                "date": _as_date(doc.purchase_date or doc.created_at),
                "party_id": doc.supplier_id,
                "item_id": ln.item_id,
                "warehouse_id": ln.line_location_id or doc.location_id,
                "quantity": to_qty(ln.quantity), "amount": to_money(ln.line_total),
                "cost": None, "doc_net": to_money(doc.total),
            })

    elif doc_type == "purchase_return":
        pairs = db.execute(
            select(PurchaseReturnLine, PurchaseReturn, PurchaseInvoice)
            .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseReturn.purchase_invoice_id)
            .order_by(PurchaseReturn.id)
        ).all()
        for ln, doc, inv in pairs:
            unit = db.scalar(
                select(PurchaseInvoiceLine.unit_price).where(
                    PurchaseInvoiceLine.invoice_id == inv.id,
                    PurchaseInvoiceLine.item_id == ln.item_id,
                )
            )
            rows.append({
                "doc_id": doc.id, "document_number": doc.document_number,
                "date": _as_date(doc.return_date or doc.created_at),
                "party_id": inv.supplier_id,
                "item_id": ln.item_id, "warehouse_id": inv.location_id,
                "quantity": to_qty(ln.quantity),
                "amount": to_money(Decimal(str(unit or 0)) * Decimal(str(ln.quantity))),
                "cost": None, "doc_net": to_money(doc.value),
            })
    else:
        raise TradeReportError(f"Unknown document type '{doc_type}'.")

    return [
        r for r in rows
        if _in_range(r["date"], date_from, date_to)
        and (party_id is None or r["party_id"] == party_id)
        and (item_id is None or r["item_id"] == item_id)
        and (warehouse_id is None or r["warehouse_id"] == warehouse_id)
    ]


def trade(
    db: Session,
    *,
    doc_type: str = "sale",
    level: str = "document",
    group_by: str = "none",
    date_from=None,
    date_to=None,
    party_id: int | None = None,
    item_id: int | None = None,
    warehouse_id: int | None = None,
) -> dict:
    """Sales/purchase figures at the requested level and grouping, with totals.

    `level` picks the grain: one row per document, or one per line. `group_by` then merges those
    rows by party, item or warehouse — which is how the same engine answers "sales by customer"
    and "margin by warehouse" without a second query being written.
    """
    if doc_type not in DOC_TYPES:
        raise TradeReportError(f"doc_type must be one of {DOC_TYPES}.")
    if level not in LEVELS:
        raise TradeReportError(f"level must be one of {LEVELS}.")
    if group_by not in GROUPS:
        raise TradeReportError(f"group_by must be one of {GROUPS}.")

    date_from, date_to = _as_date(date_from), _as_date(date_to)
    items, customers, suppliers, warehouses = _names(db)
    party_names = customers if doc_type.startswith("sale") else suppliers
    wants_profit = doc_type in _PROFIT_DOCS

    flat = _collect(db, doc_type, date_from, date_to, party_id, item_id, warehouse_id)

    def party_label(pid):
        return party_names.get(pid, f"#{pid}")

    def item_label(iid):
        return items.get(iid, (None, f"#{iid}", None))[1]

    # --- totals are summed from the flat lines, so every shape agrees with every other ---
    total_amount = to_money(sum((r["amount"] for r in flat), ZERO))
    total_qty = to_qty(sum((r["quantity"] for r in flat), ZERO_QTY))
    total_cost = to_money(sum((r["cost"] for r in flat if r["cost"] is not None), ZERO))
    # A line with no captured cost cannot contribute a margin; counting it as zero cost would
    # overstate profit, so it is reported separately instead of silently folded in.
    without_cost = sum(1 for r in flat if wants_profit and r["cost"] is None)

    rows: list[dict] = []

    if group_by == "none" and level == "document":
        seen: dict[int, dict] = {}
        for r in flat:
            d = seen.setdefault(r["doc_id"], {
                # Carried through so a report row can lead back to the document behind it.
                "doc_id": r["doc_id"],
                "document_number": r["document_number"], "date": str(r["date"]),
                "party": party_label(r["party_id"]), "party_id": r["party_id"],
                "quantity": ZERO_QTY, "amount": ZERO, "cost": ZERO, "has_cost": True,
            })
            d["quantity"] = to_qty(d["quantity"] + r["quantity"])
            d["amount"] = to_money(d["amount"] + r["amount"])
            if r["cost"] is None:
                d["has_cost"] = False
            else:
                d["cost"] = to_money(d["cost"] + r["cost"])
        for d in seen.values():
            rows.append(_finish(d, wants_profit))

    elif group_by == "none" and level == "line":
        for r in flat:
            rows.append(_finish({
                "doc_id": r["doc_id"],
                "document_number": r["document_number"], "date": str(r["date"]),
                "party": party_label(r["party_id"]), "party_id": r["party_id"],
                "item": item_label(r["item_id"]), "item_id": r["item_id"],
                "warehouse": warehouses.get(r["warehouse_id"], f"#{r['warehouse_id']}"),
                "quantity": r["quantity"], "amount": r["amount"],
                "cost": r["cost"] if r["cost"] is not None else ZERO,
                "has_cost": r["cost"] is not None,
            }, wants_profit))

    else:
        key_of = {
            "party": lambda r: (r["party_id"], party_label(r["party_id"])),
            "item": lambda r: (r["item_id"], item_label(r["item_id"])),
            "warehouse": lambda r: (r["warehouse_id"],
                                    warehouses.get(r["warehouse_id"], f"#{r['warehouse_id']}")),
        }[group_by]
        buckets: dict = {}
        for r in flat:
            key, label = key_of(r)
            b = buckets.setdefault(key, {
                "key": key, "label": label, "quantity": ZERO_QTY, "amount": ZERO,
                "cost": ZERO, "has_cost": True, "docs": set(),
            })
            b["quantity"] = to_qty(b["quantity"] + r["quantity"])
            b["amount"] = to_money(b["amount"] + r["amount"])
            if r["cost"] is None:
                b["has_cost"] = False
            else:
                b["cost"] = to_money(b["cost"] + r["cost"])
            b["docs"].add(r["doc_id"])
        for b in buckets.values():
            b["document_count"] = len(b.pop("docs"))
            rows.append(_finish(b, wants_profit))
        rows.sort(key=lambda x: Decimal(x["amount"]), reverse=True)

    totals = {
        "quantity": str(total_qty),
        "net": str(total_amount),
        "revenue": str(total_amount),
        "cost": str(total_cost) if wants_profit else None,
        "profit": str(to_money(total_amount - total_cost)) if wants_profit else None,
        "margin_pct": (str(to_money((total_amount - total_cost) / total_amount * 100))
                       if wants_profit and total_amount else None),
        "lines_without_cost": without_cost if wants_profit else None,
        "document_count": len({r["doc_id"] for r in flat}),
    }
    return {"doc_type": doc_type, "level": level, "group_by": group_by,
            "rows": rows, "totals": totals}


def _finish(row: dict, wants_profit: bool) -> dict:
    """Turn the accumulated Decimals into strings and add the profit columns where they apply."""
    amount = to_money(row.get("amount", ZERO))
    cost = to_money(row.get("cost", ZERO))
    has_cost = row.pop("has_cost", False)
    out = {k: (str(v) if isinstance(v, Decimal) else v) for k, v in row.items()}
    out["amount"] = str(amount)
    # The same figure under the three names the reader may look for: `amount` on a line,
    # `net` on a document, `revenue` on a sale. Keeping all three means rows and totals
    # can be read with one set of column keys whatever shape was asked for.
    out["net"] = str(amount)
    out["revenue"] = str(amount)
    if wants_profit:
        out["cost"] = str(cost)
        out["profit"] = str(to_money(amount - cost))
        out["margin_pct"] = str(to_money((amount - cost) / amount * 100)) if amount else "0.00"
        # Flagged so the reader knows a margin is based on partially-captured cost.
        out["cost_complete"] = has_cost
    else:
        out["cost"] = None
        out["profit"] = None
        out["margin_pct"] = None
    return out
