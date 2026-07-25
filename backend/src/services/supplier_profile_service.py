"""Supplier search + the 360° supplier file — 026-supplier-360.

The mirror image of `customer_profile_service`: one grouped query for every supplier's payable
balance, one call that gathers his whole file (purchases, returns, payments, cheques), and one
uniform record-detail endpoint so the UI can open any row of that file in a popup.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, LedgerLine
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.supplier import Supplier, SupplierAccount
from src.models.voucher import Voucher, VoucherKind


class SupplierProfileError(Exception):
    """The supplier (or the requested document) does not exist."""


# --------------------------------------------------------------------------- balances


def bulk_balances(db: Session, supplier_ids: list[int] | None = None) -> dict[int, Decimal]:
    """Payable balance per supplier, signed by the account's normal side (credit = we owe)."""
    signed = case(
        (LedgerLine.direction == Account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    stmt = (
        select(SupplierAccount.supplier_id, func.coalesce(func.sum(signed), 0))
        .join(Account, Account.id == SupplierAccount.account_id)
        .join(LedgerLine, LedgerLine.account_id == Account.id, isouter=True)
        .group_by(SupplierAccount.supplier_id)
    )
    if supplier_ids is not None:
        if not supplier_ids:
            return {}
        stmt = stmt.where(SupplierAccount.supplier_id.in_(supplier_ids))
    return {sid: to_money(total or 0) for sid, total in db.execute(stmt).all()}


# ----------------------------------------------------------------------------- search


def apply_filters(
    stmt: Select, *, q: str | None = None, active: bool | None = None,
) -> Select:
    """`q` matches code, name, phone or address (partial, any part)."""
    if q:
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Supplier.name.like(needle),
                Supplier.code.like(needle),
                Supplier.phone.like(needle),
                Supplier.address.like(needle),
            )
        )
    if active is not None:
        stmt = stmt.where(Supplier.active.is_(active))
    return stmt


def filter_by_balance(
    rows: list[Supplier], balances: dict[int, Decimal], balance_filter: str | None
) -> list[Supplier]:
    """`due` = we owe him, `settled` = zero, `advance` = he owes us (we paid ahead)."""
    if not balance_filter or balance_filter == "all":
        return rows
    def keep(s: Supplier) -> bool:
        bal = balances.get(s.id, ZERO)
        if balance_filter == "due":
            return bal > 0
        if balance_filter == "settled":
            return bal == 0
        if balance_filter == "advance":
            return bal < 0
        return True
    return [s for s in rows if keep(s)]


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
    supplier_id: int
    account_id: int | None
    balance: Decimal
    total_purchases: Decimal
    total_returns: Decimal
    total_payments: Decimal
    invoice_count: int
    last_invoice_date: date | None
    purchases: list[DocRow] = field(default_factory=list)
    returns: list[DocRow] = field(default_factory=list)
    payments: list[DocRow] = field(default_factory=list)
    cheques: list[dict] = field(default_factory=list)


def _as_date(value: date | datetime | None) -> date | None:
    return value.date() if isinstance(value, datetime) else value


def profile(db: Session, supplier_id: int, *, limit: int = 200) -> Profile:
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise SupplierProfileError("المورد غير موجود.")

    link = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id))
    balance = bulk_balances(db, [supplier_id]).get(supplier_id, ZERO)

    invoices = db.scalars(
        select(PurchaseInvoice).where(PurchaseInvoice.supplier_id == supplier_id)
        .order_by(PurchaseInvoice.id.desc()).limit(limit)
    ).all()
    purchase_rows = [
        DocRow(id=p.id, document_number=p.document_number, doc_date=_as_date(p.created_at),
               amount=to_money(p.total),
               detail=f"نقدي {to_money(p.cash_amount)} / آجل {to_money(p.credit_amount)}")
        for p in invoices
    ]
    total_purchases = to_money(db.scalar(
        select(func.coalesce(func.sum(PurchaseInvoice.total), 0))
        .where(PurchaseInvoice.supplier_id == supplier_id)) or 0)
    invoice_count = db.scalar(
        select(func.count()).select_from(PurchaseInvoice)
        .where(PurchaseInvoice.supplier_id == supplier_id)) or 0

    supplier_invoice_ids = select(PurchaseInvoice.id).where(
        PurchaseInvoice.supplier_id == supplier_id)
    returns = db.scalars(
        select(PurchaseReturn).where(PurchaseReturn.purchase_invoice_id.in_(supplier_invoice_ids))
        .order_by(PurchaseReturn.id.desc()).limit(limit)
    ).all()
    return_rows = [
        DocRow(id=r.id, document_number=r.document_number, doc_date=_as_date(r.created_at),
               amount=to_money(r.value), detail="")
        for r in returns
    ]
    total_returns = to_money(db.scalar(
        select(func.coalesce(func.sum(PurchaseReturn.value), 0))
        .where(PurchaseReturn.purchase_invoice_id.in_(supplier_invoice_ids))) or 0)

    payments = db.scalars(
        select(Voucher).where(Voucher.supplier_id == supplier_id,
                              Voucher.kind == VoucherKind.payment)
        .order_by(Voucher.id.desc()).limit(limit)
    ).all()
    payment_rows = [
        DocRow(id=v.id, document_number=v.document_number, doc_date=v.voucher_date,
               amount=to_money(v.amount), detail=v.description or v.reference or "")
        for v in payments
    ]
    total_payments = to_money(db.scalar(
        select(func.coalesce(func.sum(Voucher.amount), 0)).where(
            Voucher.supplier_id == supplier_id, Voucher.kind == VoucherKind.payment,
            Voucher.reverses_id.is_(None))) or 0)

    return Profile(
        supplier_id=supplier_id,
        account_id=link.account_id if link is not None else None,
        balance=balance,
        total_purchases=total_purchases,
        total_returns=total_returns,
        total_payments=total_payments,
        invoice_count=invoice_count,
        last_invoice_date=purchase_rows[0].doc_date if purchase_rows else None,
        purchases=purchase_rows,
        returns=return_rows,
        payments=payment_rows,
        cheques=_cheques(db, supplier_id, limit),
    )


def _cheques(db: Session, supplier_id: int, limit: int) -> list[dict]:
    from src.models.cheque import Cheque

    rows = db.scalars(
        select(Cheque).where(Cheque.supplier_id == supplier_id)
        .order_by(Cheque.id.desc()).limit(limit)
    ).all()
    return [
        {
            "id": c.id, "cheque_number": c.cheque_number, "bank_name": c.bank_name,
            "amount": str(to_money(c.amount)), "due_date": str(c.due_date) if c.due_date else None,
            "status": getattr(c.status, "value", str(c.status)),
            "direction": getattr(c.direction, "value", str(c.direction)),
        }
        for c in rows
    ]


# ---------------------------------------------------------------------- record detail


def _money(v) -> str:
    return f"{to_money(v or 0):,.2f}"


def record_detail(db: Session, supplier_id: int, kind: str, record_id: int) -> dict:
    """Full detail of one row of the supplier's file, scoped to THIS supplier."""
    handler = {
        "purchase": _purchase_detail,
        "return": _return_detail,
        "payment": _voucher_detail,
        "cheque": _cheque_detail,
        "entry": _entry_detail,
    }.get(kind)
    if handler is None:
        raise SupplierProfileError(f"نوع مستند غير معروف: {kind}")
    return handler(db, supplier_id, record_id)


def _item_names(db: Session, item_ids: list[int]) -> dict[int, str]:
    if not item_ids:
        return {}
    from src.models.catalog import Item

    return {i: n for i, n in db.execute(
        select(Item.id, Item.name).where(Item.id.in_(item_ids))).all()}


def _purchase_detail(db: Session, supplier_id: int, record_id: int) -> dict:
    p = db.get(PurchaseInvoice, record_id)
    if p is None or p.supplier_id != supplier_id:
        raise SupplierProfileError("فاتورة الشراء غير موجودة.")
    names = _item_names(db, [ln.item_id for ln in p.lines])
    supplier = db.get(Supplier, supplier_id)
    return {
        "kind": "purchase",
        "title": f"فاتورة شراء {p.document_number}",
        "doc": {
            "kind": "purchase",
            "document_number": p.document_number,
            "date": str(_as_date(p.created_at) or ""),
            "partyLabel": "المورد",
            "partyName": supplier.name if supplier else f"#{supplier_id}",
            "partyPhone": supplier.phone if supplier else None,
            "partyAddress": supplier.address if supplier else None,
            "gross": str(to_money(p.total)),
            "net": str(to_money(p.total)),
            "cash": str(to_money(p.cash_amount)),
            "credit": str(to_money(p.credit_amount)),
            "entryId": p.ledger_entry_id,
            "lines": [
                {
                    "name": names.get(ln.item_id, f"#{ln.item_id}"),
                    "quantity": str(ln.quantity),
                    "unit": ln.unit,
                    "unit_price": str(to_money(ln.unit_price)),
                    "line_total": str(to_money(ln.line_total)),
                }
                for ln in p.lines
            ],
        },
        "fields": [
            {"label": "رقم الفاتورة", "value": p.document_number},
            {"label": "التاريخ", "value": str(_as_date(p.created_at) or "")},
            {"label": "الإجمالي", "value": _money(p.total)},
            {"label": "المسدد نقداً", "value": _money(p.cash_amount)},
            {"label": "آجل", "value": _money(p.credit_amount)},
        ],
        "line_columns": [],
        "lines": [],
    }


def _return_detail(db: Session, supplier_id: int, record_id: int) -> dict:
    ret = db.get(PurchaseReturn, record_id)
    inv = db.get(PurchaseInvoice, ret.purchase_invoice_id) if ret is not None else None
    if ret is None or inv is None or inv.supplier_id != supplier_id:
        raise SupplierProfileError("المرتجع غير موجود.")
    names = _item_names(db, [ln.item_id for ln in ret.lines])
    return {
        "kind": "return",
        "title": f"مرتجع مشتريات {ret.document_number}",
        "fields": [
            {"label": "رقم المرتجع", "value": ret.document_number},
            {"label": "الفاتورة الأصلية", "value": inv.document_number},
            {"label": "التاريخ", "value": str(_as_date(ret.created_at) or "")},
            {"label": "قيمة المرتجع", "value": _money(ret.value)},
            {"label": "رقم القيد", "value": str(ret.ledger_entry_id or "-")},
        ],
        "line_columns": ["الصنف", "الكمية المرتجعة"],
        "lines": [[names.get(ln.item_id, f"#{ln.item_id}"), str(ln.quantity)] for ln in ret.lines],
    }


def _voucher_detail(db: Session, supplier_id: int, record_id: int) -> dict:
    v = db.get(Voucher, record_id)
    if v is None or v.supplier_id != supplier_id:
        raise SupplierProfileError("السند غير موجود.")
    treasury_name = None
    if v.treasury_id:
        from src.models.treasury import Treasury

        t = db.get(Treasury, v.treasury_id)
        treasury_name = t.name if t is not None else f"#{v.treasury_id}"
    supplier = db.get(Supplier, supplier_id)
    return {
        "kind": "payment",
        "title": f"سند صرف {v.document_number}",
        "voucher": {
            "kind": getattr(v.kind, "value", str(v.kind)),
            "document_number": v.document_number,
            "date": str(v.voucher_date),
            "amount": str(to_money(v.amount)),
            "partyLabel": "المورد",
            "partyName": supplier.name if supplier else f"#{supplier_id}",
            "treasury": treasury_name,
            "paymentMethod": v.payment_method,
            "reference": v.reference,
            "description": v.description,
            "entryId": v.ledger_entry_id,
            "isReversal": v.reverses_id is not None,
        },
        "fields": [
            {"label": "رقم السند", "value": v.document_number},
            {"label": "المبلغ", "value": _money(v.amount)},
        ],
        "line_columns": [],
        "lines": [],
    }


def _cheque_detail(db: Session, supplier_id: int, record_id: int) -> dict:
    from src.models.cheque import Cheque

    c = db.get(Cheque, record_id)
    if c is None or c.supplier_id != supplier_id:
        raise SupplierProfileError("الشيك غير موجود.")
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
            {"label": "تاريخ الصرف", "value": str(c.settled_on) if c.settled_on else "-"},
        ],
        "line_columns": [],
        "lines": [],
    }


def _entry_detail(db: Session, supplier_id: int, record_id: int) -> dict:
    from src.models.ledger import LedgerEntry

    entry = db.get(LedgerEntry, record_id)
    if entry is None:
        raise SupplierProfileError("القيد غير موجود.")
    link = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id))
    if link is None or not any(ln.account_id == link.account_id for ln in entry.lines):
        raise SupplierProfileError("القيد لا يخص هذا المورد.")
    accounts = {a.id: a for a in db.scalars(
        select(Account).where(Account.id.in_([ln.account_id for ln in entry.lines]))).all()}
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
            {"label": "التاريخ",
             "value": str(entry.entry_date or _as_date(entry.created_at) or "")},
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
