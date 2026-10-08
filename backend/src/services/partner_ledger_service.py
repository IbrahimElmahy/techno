from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.lib import entry_text
from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee
from src.models.ledger import (
    Account,
    AccountType,
    Direction,
    LedgerEntry,
    LedgerLine,
    PartnerKind,
)
from src.models.reconcile import FullReconcile
from src.models.supplier import Supplier, SupplierAccount
from src.services import ledger_service, move_registry

PARTNER_ACCOUNT_TYPES = (AccountType.customer_receivable, AccountType.supplier_payable)


@dataclass
class PartnerLedgerLine:
    line_id: int
    entry_id: int
    entry_number: str | None
    entry_date: date
    date_maturity: date | None
    journal_code: str | None
    move_type: str | None
    move_type_label: str | None
    account_id: int
    account_code: str | None
    account_name: str | None
    description: str
    statement: str | None
    debit: Decimal
    credit: Decimal
    balance: Decimal
    residual: Decimal | None
    reconcile_number: str | None


@dataclass
class PartnerLedgerRow:
    partner_kind: str
    partner_id: int
    partner_name: str
    opening: Decimal = ZERO
    debit: Decimal = ZERO
    credit: Decimal = ZERO
    closing: Decimal = ZERO
    open_residual: Decimal = ZERO
    lines: list[PartnerLedgerLine] = field(default_factory=list)


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def _account_party_map(db: Session) -> dict[int, tuple[str, int]]:
    out: dict[int, tuple[str, int]] = {}
    for acc in db.scalars(select(CustomerAccount)).all():
        out[acc.account_id] = (PartnerKind.customer.value, acc.customer_id)
    for acc in db.scalars(select(SupplierAccount)).all():
        out[acc.account_id] = (PartnerKind.supplier.value, acc.supplier_id)
    return out


def _partner_names(db: Session, wanted: set[tuple[str, int]]) -> dict[tuple[str, int], str]:
    models = {
        PartnerKind.customer.value: Customer,
        PartnerKind.supplier.value: Supplier,
        PartnerKind.employee.value: Employee,
    }
    names: dict[tuple[str, int], str] = {}
    for kind, model in models.items():
        ids = [pid for k, pid in wanted if k == kind]
        if not ids:
            continue
        for pid, name in db.execute(
            select(model.id, model.name).where(model.id.in_(ids))
        ).all():
            names[(kind, int(pid))] = name
    return names


def partner_ledger(
    db: Session,
    *,
    partner_kind: str | None = None,
    partner_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    only_open: bool = False,
    branch_id: int | None = None,
) -> list[PartnerLedgerRow]:
    accounts = {
        acc.id: acc
        for acc in db.scalars(
            select(Account).where(
                (Account.reconcilable.is_(True))
                | (Account.account_type.in_(PARTNER_ACCOUNT_TYPES))
            )
        ).all()
    }
    if not accounts:
        return []

    stmt = (
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry).selectinload(LedgerEntry.journal))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(list(accounts)), ledger_service.is_posted_sql())
    )
    if branch_id is not None:
        stmt = stmt.where(
            (LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    lines = db.scalars(stmt).all()
    if not lines:
        return []

    fallback = _account_party_map(db)
    recon_numbers = {
        int(i): n for i, n in db.execute(select(FullReconcile.id, FullReconcile.number)).all()
    }

    rows: dict[tuple[str, int], PartnerLedgerRow] = {}
    pending: dict[tuple[str, int], list[tuple[date, int, LedgerLine]]] = {}

    for line in lines:
        if line.partner_kind and line.partner_id:
            key: tuple[str, int] | None = (str(line.partner_kind), int(line.partner_id))
        else:
            key = fallback.get(line.account_id)
        if key is None:
            continue
        if partner_kind is not None and key[0] != partner_kind:
            continue
        if partner_id is not None and key[1] != partner_id:
            continue
        when = _effective_date(line.entry)
        if date_to is not None and when > date_to:
            continue
        row = rows.get(key)
        if row is None:
            row = PartnerLedgerRow(partner_kind=key[0], partner_id=key[1], partner_name="")
            rows[key] = row
        amount = to_money(line.amount)
        signed = amount if line.direction == Direction.debit else -amount
        if date_from is not None and when < date_from:
            row.opening = to_money(row.opening + signed)
            continue
        pending.setdefault(key, []).append((when, line.id, line))

    names = _partner_names(db, set(rows))
    for key, row in rows.items():
        row.partner_name = names.get(key, f"#{key[1]}")
        running = row.opening
        for when, _line_id, line in sorted(pending.get(key, []), key=lambda t: (t[0], t[1])):
            amount = to_money(line.amount)
            debit = amount if line.direction == Direction.debit else ZERO
            credit = amount if line.direction == Direction.credit else ZERO
            running = to_money(running + debit - credit)
            acc = accounts[line.account_id]
            entry = line.entry
            residual = (to_money(line.amount_residual)
                        if line.amount_residual is not None else None)
            if residual is not None:
                row.open_residual = to_money(row.open_residual + residual)
            row.debit = to_money(row.debit + debit)
            row.credit = to_money(row.credit + credit)
            row.lines.append(PartnerLedgerLine(
                line_id=line.id,
                entry_id=entry.id,
                entry_number=entry.number,
                entry_date=when,
                date_maturity=line.date_maturity,
                journal_code=entry.journal.code if entry.journal is not None else None,
                move_type=entry.move_type,
                move_type_label=move_registry.MOVE_TYPE_LABEL.get(entry.move_type or ""),
                account_id=acc.id,
                account_code=acc.code,
                account_name=acc.name,
                description=entry_text.arabic(entry.description),
                statement=line.statement,
                debit=debit,
                credit=credit,
                balance=running,
                residual=residual,
                reconcile_number=recon_numbers.get(line.full_reconcile_id or -1),
            ))
        row.closing = running
        row.lines.reverse()

    out = [r for r in rows.values() if r.lines or r.opening != ZERO]
    if only_open:
        out = [r for r in out if r.open_residual != ZERO]
    out.sort(key=lambda r: (r.partner_kind, -abs(r.closing), r.partner_name))
    return out
