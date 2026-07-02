"""Credit exposure & overdue reports (012).

Both are read-only and fully derived: a customer's outstanding receivable is the ledger balance of
its linked receivable account (`ledger_service.balance_of`, Principle III). No stored balance exists.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.sales import SalesInvoice
from src.services import ledger_service


@dataclass
class ExposureRow:
    customer_id: int
    code: str
    name: str
    credit_limit: Decimal
    outstanding: Decimal
    available: Decimal
    over_limit: bool


@dataclass
class OverdueRow:
    invoice_id: int
    document_number: str
    customer_id: int
    customer_name: str
    due_date: date
    outstanding: Decimal


def _outstanding(db: Session, customer: Customer) -> Decimal:
    """A customer's derived receivable balance (0 if it has no account yet)."""
    acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer.id))
    if acc is None:
        return ZERO
    return to_money(ledger_service.balance_of(db, acc.account_id))


def exposure(db: Session) -> list[ExposureRow]:
    """Per-customer credit exposure for every customer with a non-null credit_limit (FR-007)."""
    customers = db.scalars(
        select(Customer).where(Customer.credit_limit.is_not(None))
    ).all()
    out: list[ExposureRow] = []
    for c in customers:
        limit = to_money(c.credit_limit)
        bal = _outstanding(db, c)
        out.append(ExposureRow(
            customer_id=c.id, code=c.code, name=c.name, credit_limit=limit,
            outstanding=bal, available=to_money(limit - bal), over_limit=bal > limit,
        ))
    return out


def overdue(db: Session, *, as_of: date) -> list[OverdueRow]:
    """Credit invoices whose due_date < as_of while the customer still owes (FR-008)."""
    invoices = db.scalars(
        select(SalesInvoice).where(
            SalesInvoice.due_date.is_not(None), SalesInvoice.due_date < as_of
        ).order_by(SalesInvoice.due_date, SalesInvoice.id)
    ).all()
    out: list[OverdueRow] = []
    for inv in invoices:
        customer = db.get(Customer, inv.customer_id)
        bal = _outstanding(db, customer) if customer else ZERO
        if bal <= ZERO:  # settled — nothing at risk
            continue
        out.append(OverdueRow(
            invoice_id=inv.id, document_number=inv.document_number, customer_id=inv.customer_id,
            customer_name=customer.name if customer else "", due_date=inv.due_date, outstanding=bal,
        ))
    return out
