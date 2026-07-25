"""Customer search + the 360° customer file — 025-customer-360.

Two jobs, both pure functions over a session so the API layer stays thin:

* `bulk_balances` derives every customer's receivable balance in ONE grouped query instead
  of the per-row round-trip the customers grid used to make (N+1 over hundreds of rows).
* `profile` collects everything the company knows about one customer — his account
  statement totals, invoices, returns, receipts, cheques and loyalty points — so the UI can
  open a single «ملف العميل» instead of hunting across five screens. Inspections are NOT
  here on purpose: they belong to the end owner of the product, not to a trading partner.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, LedgerLine
from src.models.sales import SalesInvoice, SalesReturn
from src.models.voucher import Voucher, VoucherKind


class CustomerProfileError(Exception):
    """The customer (or his ledger account) does not exist."""


# --------------------------------------------------------------------------- balances


def bulk_balances(db: Session, customer_ids: list[int] | None = None) -> dict[int, Decimal]:
    """Receivable balance per customer, signed by the account's normal side (debit = owes us).

    One grouped query for the whole page — the grid used to fire a request per row.
    """
    signed = case(
        (LedgerLine.direction == Account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    stmt = (
        select(CustomerAccount.customer_id, func.coalesce(func.sum(signed), 0))
        .join(Account, Account.id == CustomerAccount.account_id)
        .join(LedgerLine, LedgerLine.account_id == Account.id, isouter=True)
        .group_by(CustomerAccount.customer_id)
    )
    if customer_ids is not None:
        if not customer_ids:
            return {}
        stmt = stmt.where(CustomerAccount.customer_id.in_(customer_ids))
    return {cid: to_money(total or 0) for cid, total in db.execute(stmt).all()}


# ----------------------------------------------------------------------------- search


def apply_filters(
    stmt: Select,
    *,
    q: str | None = None,
    customer_type: str | None = None,
    rep_id: int | None = None,
    territory_id: int | None = None,
    governorate_id: int | None = None,
    active: bool | None = None,
) -> Select:
    """Narrow a customer SELECT. `q` matches code, name, phone or address (partial, any part)."""
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Customer.name.like(needle),
                Customer.code.like(needle),
                Customer.phone.like(needle),
                Customer.markaz.like(needle),
                Customer.address.like(needle),
            )
        )
    if customer_type:
        stmt = stmt.where(Customer.customer_type == customer_type)
    if rep_id is not None:
        stmt = stmt.where(Customer.rep_id == rep_id)
    if territory_id is not None:
        stmt = stmt.where(Customer.territory_id == territory_id)
    if governorate_id is not None:
        stmt = stmt.where(Customer.governorate_id == governorate_id)
    if active is not None:
        stmt = stmt.where(Customer.active.is_(active))
    return stmt


def filter_by_balance(
    rows: list[Customer], balances: dict[int, Decimal], balance_filter: str | None
) -> list[Customer]:
    """`debtors` = owes us, `settled` = exactly zero, `credit` = we owe him (negative)."""
    if not balance_filter or balance_filter == "all":
        return rows
    def keep(c: Customer) -> bool:
        bal = balances.get(c.id, ZERO)
        if balance_filter == "debtors":
            return bal > 0
        if balance_filter == "settled":
            return bal == 0
        if balance_filter == "credit":
            return bal < 0
        return True
    return [c for c in rows if keep(c)]


# ---------------------------------------------------------------------------- profile


@dataclass(frozen=True)
class DocRow:
    id: int
    document_number: str
    doc_date: date | None
    amount: Decimal
    detail: str = ""


@dataclass
class Profile:
    customer_id: int
    account_id: int | None
    balance: Decimal
    points_balance: Decimal
    total_sales: Decimal
    total_returns: Decimal
    total_receipts: Decimal
    invoice_count: int
    last_invoice_date: date | None
    invoices: list[DocRow] = field(default_factory=list)
    returns: list[DocRow] = field(default_factory=list)
    receipts: list[DocRow] = field(default_factory=list)
    cheques: list[dict] = field(default_factory=list)
    coupons: list[dict] = field(default_factory=list)
    # NOTE: inspections are deliberately NOT part of this file. A «عميل» here is a trading
    # partner we buy from / sell to; an inspection belongs to the END OWNER who bought the
    # product and gets a technical-support visit. Two different populations.


def _as_date(value: date | datetime | None) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    return value


def profile(db: Session, customer_id: int, *, limit: int = 200) -> Profile:
    """Everything the system knows about one customer, ready for «ملف العميل»."""
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise CustomerProfileError("العميل غير موجود.")

    link = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer_id))
    account_id = link.account_id if link is not None else None
    balance = bulk_balances(db, [customer_id]).get(customer_id, ZERO)

    invoices = db.scalars(
        select(SalesInvoice)
        .where(SalesInvoice.customer_id == customer_id)
        .order_by(SalesInvoice.id.desc())
        .limit(limit)
    ).all()
    invoice_rows = [
        DocRow(
            id=i.id,
            document_number=i.document_number,
            doc_date=_as_date(i.created_at),
            amount=to_money(i.net) + to_money(i.tax_amount or 0),
            detail=f"نقدي {to_money(i.cash_amount)} / آجل {to_money(i.credit_amount)}",
        )
        for i in invoices
    ]
    # Totals cover the whole history, not just the page of rows above.
    total_sales = to_money(
        db.scalar(
            select(func.coalesce(func.sum(SalesInvoice.net + SalesInvoice.tax_amount), 0))
            .where(SalesInvoice.customer_id == customer_id)
        )
        or 0
    )
    invoice_count = db.scalar(
        select(func.count()).select_from(SalesInvoice)
        .where(SalesInvoice.customer_id == customer_id)
    ) or 0
    last_invoice_date = invoice_rows[0].doc_date if invoice_rows else None

    customer_invoice_ids = select(SalesInvoice.id).where(SalesInvoice.customer_id == customer_id)
    returns = db.scalars(
        select(SalesReturn)
        .where(SalesReturn.sales_invoice_id.in_(customer_invoice_ids))
        .order_by(SalesReturn.id.desc())
        .limit(limit)
    ).all()
    return_rows = [
        DocRow(id=r.id, document_number=r.document_number, doc_date=_as_date(r.created_at),
               amount=to_money(r.value),
               detail=f"نقدي {to_money(r.cash_refund)} / خصم آجل {to_money(r.credit_reduction)}")
        for r in returns
    ]
    total_returns = to_money(
        db.scalar(
            select(func.coalesce(func.sum(SalesReturn.value), 0))
            .where(SalesReturn.sales_invoice_id.in_(customer_invoice_ids))
        )
        or 0
    )

    receipts = db.scalars(
        select(Voucher)
        .where(Voucher.customer_id == customer_id, Voucher.kind == VoucherKind.receipt)
        .order_by(Voucher.id.desc())
        .limit(limit)
    ).all()
    receipt_rows = [
        DocRow(id=v.id, document_number=v.document_number, doc_date=v.voucher_date,
               amount=to_money(v.amount),
               detail=v.description or v.reference or "")
        for v in receipts
    ]
    total_receipts = to_money(
        db.scalar(
            select(func.coalesce(func.sum(Voucher.amount), 0)).where(
                Voucher.customer_id == customer_id,
                Voucher.kind == VoucherKind.receipt,
                Voucher.reverses_id.is_(None),
            )
        )
        or 0
    )

    return Profile(
        customer_id=customer_id,
        account_id=account_id,
        balance=balance,
        points_balance=_points_balance(db, customer_id),
        total_sales=total_sales,
        total_returns=total_returns,
        total_receipts=total_receipts,
        invoice_count=invoice_count,
        last_invoice_date=last_invoice_date,
        invoices=invoice_rows,
        returns=return_rows,
        receipts=receipt_rows,
        cheques=_cheques(db, customer_id, limit),
        coupons=_coupons(db, customer_id, limit),
    )


# ---------------------------------------------------------------------- record detail


def _money(v) -> str:
    return f"{to_money(v or 0):,.2f}"


def record_detail(db: Session, customer_id: int, kind: str, record_id: int) -> dict:
    """Full detail of one record from the customer's file, in a uniform render-ready shape.

    One endpoint for every kind (invoice / return / receipt / cheque / inspection / coupon /
    ledger entry) keeps the UI generic, and every lookup is re-checked against THIS customer
    so a record id from another customer can never be opened through his file.
    """
    handler = {
        "invoice": _invoice_detail,
        "return": _return_detail,
        "receipt": _voucher_detail,
        "cheque": _cheque_detail,
        "coupon": _coupon_detail,
        "entry": _entry_detail,
    }.get(kind)
    if handler is None:
        raise CustomerProfileError(f"نوع مستند غير معروف: {kind}")
    return handler(db, customer_id, record_id)


def _item_names(db: Session, item_ids: list[int]) -> dict[int, str]:
    if not item_ids:
        return {}
    from src.models.catalog import Item

    rows = db.execute(select(Item.id, Item.name).where(Item.id.in_(item_ids))).all()
    return {i: n for i, n in rows}


def _invoice_detail(db: Session, customer_id: int, record_id: int) -> dict:
    inv = db.get(SalesInvoice, record_id)
    if inv is None or inv.customer_id != customer_id:
        raise CustomerProfileError("الفاتورة غير موجودة.")
    names = _item_names(db, [ln.item_id for ln in inv.lines])
    customer = db.get(Customer, customer_id)
    return {
        "kind": "invoice",
        "title": f"فاتورة بيع {inv.document_number}",
        # Structured payload so the UI can render the real branded invoice sheet (with the
        # logo and totals block) instead of a generic label/value grid.
        "doc": {
            "kind": "sale",
            "document_number": inv.document_number,
            "date": str(_as_date(inv.created_at) or ""),
            "partyLabel": "العميل",
            "partyName": customer.name if customer else f"#{customer_id}",
            "partyPhone": customer.phone if customer else None,
            "partyAddress": (customer.address if customer else None),
            "gross": str(to_money(inv.gross)),
            "discountPct": str(inv.combined_pct),
            "net": str(to_money(inv.net)),
            "tax": str(to_money(inv.tax_amount or 0)),
            "cash": str(to_money(inv.cash_amount)),
            "credit": str(to_money(inv.credit_amount)),
            "entryId": inv.ledger_entry_id,
            "lines": [
                {
                    "name": names.get(ln.item_id, f"#{ln.item_id}"),
                    "quantity": str(ln.quantity),
                    "unit": ln.unit,
                    "unit_price": str(to_money(ln.unit_price)),
                    "discount_pct": str(getattr(ln, "discount_pct", 0) or 0),
                    "line_total": str(to_money(ln.line_total)),
                }
                for ln in inv.lines
            ],
        },
        "fields": [
            {"label": "رقم الفاتورة", "value": inv.document_number},
            {"label": "التاريخ", "value": str(_as_date(inv.created_at) or "")},
            {"label": "الإجمالي قبل الخصم", "value": _money(inv.gross)},
            {"label": "نسبة الخصم", "value": f"{inv.combined_pct}%"},
            {"label": "الصافي", "value": _money(inv.net)},
            {"label": "الضريبة", "value": _money(inv.tax_amount)},
            {"label": "المدفوع نقداً", "value": _money(inv.cash_amount)},
            {"label": "آجل", "value": _money(inv.credit_amount)},
            {"label": "رقم القيد", "value": str(inv.ledger_entry_id or "-")},
        ],
        "line_columns": ["الصنف", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي", "الفئة"],
        "lines": [
            [names.get(ln.item_id, f"#{ln.item_id}"), str(ln.quantity), ln.unit or "-",
             _money(ln.unit_price), _money(ln.line_total),
             getattr(ln.price_tier, "value", ln.price_tier) or "-"]
            for ln in inv.lines
        ],
    }


def _return_detail(db: Session, customer_id: int, record_id: int) -> dict:
    ret = db.get(SalesReturn, record_id)
    inv = db.get(SalesInvoice, ret.sales_invoice_id) if ret is not None else None
    if ret is None or inv is None or inv.customer_id != customer_id:
        raise CustomerProfileError("المرتجع غير موجود.")
    names = _item_names(db, [ln.item_id for ln in ret.lines])
    return {
        "kind": "return",
        "title": f"مرتجع مبيعات {ret.document_number}",
        "fields": [
            {"label": "رقم المرتجع", "value": ret.document_number},
            {"label": "الفاتورة الأصلية", "value": inv.document_number},
            {"label": "التاريخ", "value": str(_as_date(ret.created_at) or "")},
            {"label": "قيمة المرتجع", "value": _money(ret.value)},
            {"label": "المرتد نقداً", "value": _money(ret.cash_refund)},
            {"label": "خصم من الآجل", "value": _money(ret.credit_reduction)},
            {"label": "رقم القيد", "value": str(ret.ledger_entry_id or "-")},
        ],
        "line_columns": ["الصنف", "الكمية المرتجعة"],
        "lines": [[names.get(ln.item_id, f"#{ln.item_id}"), str(ln.quantity)] for ln in ret.lines],
    }


def _voucher_detail(db: Session, customer_id: int, record_id: int) -> dict:
    v = db.get(Voucher, record_id)
    if v is None or v.customer_id != customer_id:
        raise CustomerProfileError("السند غير موجود.")
    treasury_name = "-"
    if v.treasury_id:
        from src.models.treasury import Treasury

        t = db.get(Treasury, v.treasury_id)
        treasury_name = t.name if t is not None else f"#{v.treasury_id}"
    customer = db.get(Customer, customer_id)
    return {
        "kind": "receipt",
        "title": f"سند قبض {v.document_number}",
        # Structured payload so the UI renders the real branded voucher sheet.
        "voucher": {
            "kind": getattr(v.kind, "value", str(v.kind)),
            "document_number": v.document_number,
            "date": str(v.voucher_date),
            "amount": str(to_money(v.amount)),
            "partyLabel": "العميل",
            "partyName": customer.name if customer else f"#{customer_id}",
            "treasury": treasury_name if v.treasury_id else None,
            "paymentMethod": v.payment_method,
            "reference": v.reference,
            "description": v.description,
            "entryId": v.ledger_entry_id,
            "isReversal": v.reverses_id is not None,
        },
        "fields": [
            {"label": "رقم السند", "value": v.document_number},
            {"label": "التاريخ", "value": str(v.voucher_date)},
            {"label": "المبلغ", "value": _money(v.amount)},
            {"label": "طريقة الدفع", "value": v.payment_method or "-"},
            {"label": "الخزينة", "value": treasury_name},
            {"label": "المرجع", "value": v.reference or "-"},
            {"label": "البيان", "value": v.description or "-"},
            {"label": "قيد عكسي", "value": "نعم" if v.reverses_id else "لا"},
            {"label": "رقم القيد", "value": str(v.ledger_entry_id or "-")},
        ],
        "line_columns": [],
        "lines": [],
    }


def _cheque_detail(db: Session, customer_id: int, record_id: int) -> dict:
    from src.models.cheque import Cheque

    c = db.get(Cheque, record_id)
    if c is None or c.customer_id != customer_id:
        raise CustomerProfileError("الشيك غير موجود.")
    return {
        "kind": "cheque",
        "title": f"شيك {c.cheque_number}",
        "fields": [
            {"label": "رقم المستند", "value": c.document_number},
            {"label": "رقم الشيك", "value": c.cheque_number},
            {"label": "البنك", "value": c.bank_name or "-"},
            {"label": "القيمة", "value": _money(c.amount)},
            {"label": "تاريخ التحرير", "value": str(c.issue_date)},
            {"label": "تاريخ الاستحقاق", "value": str(c.due_date)},
            {"label": "الحالة", "value": getattr(c.status, "value", str(c.status))},
            {"label": "الاتجاه", "value": getattr(c.direction, "value", str(c.direction))},
            {"label": "تاريخ التحصيل", "value": str(c.settled_on) if c.settled_on else "-"},
            {"label": "البيان", "value": c.description or "-"},
        ],
        "line_columns": [],
        "lines": [],
    }


def _coupon_detail(db: Session, customer_id: int, record_id: int) -> dict:
    from src.models.loyalty import Coupon

    c = db.get(Coupon, record_id)
    if c is None or c.customer_id != customer_id:
        raise CustomerProfileError("الكوبون غير موجود.")
    return {
        "kind": "coupon",
        "title": f"كوبون {c.serial}",
        "fields": [
            {"label": "السريال", "value": c.serial},
            {"label": "النوع", "value": getattr(c.kind, "value", str(c.kind))},
            {"label": "القيمة", "value": _money(c.value)},
            {"label": "النقاط المستهلكة", "value": str(c.points_consumed)},
            {"label": "الحالة", "value": getattr(c.status, "value", str(c.status))},
            {"label": "التاريخ", "value": str(_as_date(c.created_at) or "")},
        ],
        "line_columns": [],
        "lines": [],
    }


def _entry_detail(db: Session, customer_id: int, record_id: int) -> dict:
    """A ledger entry opened from the statement — shown with both legs and their accounts."""
    from src.models.ledger import LedgerEntry

    entry = db.get(LedgerEntry, record_id)
    if entry is None:
        raise CustomerProfileError("القيد غير موجود.")
    link = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer_id))
    if link is None or not any(ln.account_id == link.account_id for ln in entry.lines):
        raise CustomerProfileError("القيد لا يخص هذا العميل.")
    accounts = {a.id: a for a in db.scalars(
        select(Account).where(Account.id.in_([ln.account_id for ln in entry.lines]))).all()}

    # System accounts carry no user-facing name, so fall back to an Arabic label per type.
    type_labels = {
        "treasury": "الخزينة", "custody": "عهدة المندوب",
        "customer_receivable": "ذمم العملاء", "supplier_payable": "ذمم الموردين",
        "sales_revenue": "إيرادات المبيعات", "purchases_expense": "المشتريات",
        "loyalty_expense": "مصروف الولاء", "opening_balance_equity": "أرصدة افتتاحية",
    }

    def acc_label(aid: int) -> str:
        a = accounts.get(aid)
        if a is None:
            return f"#{aid}"
        atype = getattr(a.account_type, "value", str(a.account_type))
        return a.name or type_labels.get(atype) or a.code or atype

    return {
        "kind": "entry",
        "title": f"قيد يومية #{entry.id}",
        "fields": [
            {"label": "رقم القيد", "value": str(entry.id)},
            {"label": "النوع", "value": entry.entry_type},
            {"label": "التاريخ", "value": str(entry.entry_date or _as_date(entry.created_at) or "")},
            {"label": "البيان", "value": entry.description or "-"},
            {"label": "قيد عكسي لـ", "value": str(entry.reverses_entry_id or "-")},
        ],
        "line_columns": ["الحساب", "مدين", "دائن", "البيان"],
        "lines": [
            [acc_label(ln.account_id),
             _money(ln.amount) if ln.direction.value == "debit" else "0.00",
             _money(ln.amount) if ln.direction.value == "credit" else "0.00",
             ln.statement or "-"]
            for ln in entry.lines
        ],
    }


def _points_balance(db: Session, customer_id: int) -> Decimal:
    from src.services import point_service

    try:
        return Decimal(str(point_service.balance(db, customer_id)))
    except Exception:  # loyalty is optional per install — never break the file over it
        return ZERO


def _cheques(db: Session, customer_id: int, limit: int) -> list[dict]:
    from src.models.cheque import Cheque

    rows = db.scalars(
        select(Cheque).where(Cheque.customer_id == customer_id)
        .order_by(Cheque.id.desc()).limit(limit)
    ).all()
    return [
        {
            "id": c.id, "cheque_number": c.cheque_number, "bank_name": c.bank_name,
            "amount": str(to_money(c.amount)), "due_date": str(c.due_date) if c.due_date else None,
            "status": c.status.value if hasattr(c.status, "value") else str(c.status),
            "direction": c.direction.value if hasattr(c.direction, "value") else str(c.direction),
        }
        for c in rows
    ]


def _coupons(db: Session, customer_id: int, limit: int) -> list[dict]:
    from src.models.loyalty import Coupon

    rows = db.scalars(
        select(Coupon).where(Coupon.customer_id == customer_id)
        .order_by(Coupon.id.desc()).limit(limit)
    ).all()
    return [
        {
            "id": c.id, "serial": c.serial, "value": str(c.value),
            "points_consumed": c.points_consumed,
            "status": getattr(c.status, "value", str(c.status)),
        }
        for c in rows
    ]
