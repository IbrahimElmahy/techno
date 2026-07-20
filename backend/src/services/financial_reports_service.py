"""Income statement, balance sheet and receivables aging — 020-finance-reports.

All three read the same ledger the trial balance reads; nothing is stored. Accounts are
classified by their `nature`, so a user-defined chart account lands in the right statement
without any extra bookkeeping.

Aging applies credits against debits **oldest-first (FIFO)** per party, which is how a
collector actually settles a customer: the oldest unpaid amount is what ages.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountNature, LedgerEntry, LedgerLine
from src.models.supplier import Supplier, SupplierAccount


@dataclass(frozen=True)
class ReportLine:
    account_id: int
    code: str | None
    name: str | None
    amount: Decimal


@dataclass(frozen=True)
class IncomeStatement:
    date_from: date | None
    date_to: date | None
    income: list[ReportLine]
    expenses: list[ReportLine]
    total_income: Decimal
    total_expenses: Decimal
    net_profit: Decimal


@dataclass(frozen=True)
class BalanceSheet:
    as_of: date | None
    assets: list[ReportLine]
    liabilities: list[ReportLine]
    equity: list[ReportLine]
    total_assets: Decimal
    total_liabilities: Decimal
    total_equity: Decimal
    net_profit: Decimal          # current-period result, folded into equity
    balanced: bool


@dataclass
class AgingRow:
    party_id: int
    party_name: str
    total: Decimal = ZERO
    buckets: dict[str, Decimal] = field(default_factory=dict)


BUCKETS = ("0-30", "31-60", "61-90", "90+")


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def effective_nature(acc: Account) -> AccountNature | None:
    """The account's classification.

    System accounts (treasury, receivables, revenue, …) only carry an explicit `nature` once
    the standard chart has been seeded; before that it is NULL. Falling back to the type map
    keeps the statements correct on any database instead of silently dropping those balances.
    """
    if acc.nature is not None:
        return acc.nature
    from src.services.chart_service import _NATURE_BY_TYPE

    return _NATURE_BY_TYPE.get(acc.account_type)


def _label(acc: Account) -> tuple[str | None, str | None]:
    if acc.name:
        return acc.code, acc.name
    if acc.owner_ref is not None:
        return acc.code, f"{acc.account_type.value}#{acc.owner_ref}"
    return acc.code, acc.account_type.value


def _movements(
    db: Session, *, date_from: date | None, date_to: date | None
) -> dict[int, Decimal]:
    """account_id -> signed movement (by the account's normal side) within the window."""
    rows = db.scalars(
        select(LedgerLine).options(selectinload(LedgerLine.entry),
                                   selectinload(LedgerLine.account))
    ).all()
    totals: dict[int, Decimal] = {}
    for line in rows:
        when = _effective_date(line.entry)
        if date_from is not None and when < date_from:
            continue
        if date_to is not None and when > date_to:
            continue
        amount = to_money(line.amount)
        signed = amount if line.direction == line.account.normal_side else -amount
        totals[line.account_id] = totals.get(line.account_id, ZERO) + signed
    return totals


def _by_nature(
    db: Session, totals: dict[int, Decimal], nature: AccountNature
) -> tuple[list[ReportLine], Decimal]:
    lines: list[ReportLine] = []
    total = ZERO
    for account_id, amount in totals.items():
        acc = db.get(Account, account_id)
        if acc is None or effective_nature(acc) != nature or amount == ZERO:
            continue
        code, name = _label(acc)
        lines.append(ReportLine(account_id=account_id, code=code, name=name,
                                amount=to_money(amount)))
        total += amount
    lines.sort(key=lambda r: (r.code or "", r.name or ""))
    return lines, to_money(total)


def income_statement(
    db: Session, *, date_from: date | None = None, date_to: date | None = None
) -> IncomeStatement:
    """قائمة الدخل — الإيرادات ناقص المصروفات خلال الفترة."""
    totals = _movements(db, date_from=date_from, date_to=date_to)
    income, total_income = _by_nature(db, totals, AccountNature.income)
    expenses, total_expenses = _by_nature(db, totals, AccountNature.expense)
    return IncomeStatement(
        date_from=date_from, date_to=date_to, income=income, expenses=expenses,
        total_income=total_income, total_expenses=total_expenses,
        net_profit=to_money(total_income - total_expenses),
    )


def balance_sheet(db: Session, *, as_of: date | None = None) -> BalanceSheet:
    """الميزانية — الأصول = الالتزامات + حقوق الملكية (متضمنة أرباح الفترة)."""
    totals = _movements(db, date_from=None, date_to=as_of)
    assets, total_assets = _by_nature(db, totals, AccountNature.asset)
    liabilities, total_liabilities = _by_nature(db, totals, AccountNature.liability)
    equity, total_equity = _by_nature(db, totals, AccountNature.equity)
    _, total_income = _by_nature(db, totals, AccountNature.income)
    _, total_expenses = _by_nature(db, totals, AccountNature.expense)
    net_profit = to_money(total_income - total_expenses)
    balanced = to_money(total_assets) == to_money(total_liabilities + total_equity + net_profit)
    return BalanceSheet(
        as_of=as_of, assets=assets, liabilities=liabilities, equity=equity,
        total_assets=total_assets, total_liabilities=total_liabilities,
        total_equity=total_equity, net_profit=net_profit, balanced=balanced,
    )


def _aging_for_accounts(
    db: Session, *, account_by_party: dict[int, int], names: dict[int, str], as_of: date
) -> list[AgingRow]:
    """FIFO-apply credits against debits per party, then bucket what is left by age."""
    wanted = {account_id: party_id for party_id, account_id in account_by_party.items()}
    if not wanted:
        return []
    rows = db.scalars(
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry), selectinload(LedgerLine.account))
        .where(LedgerLine.account_id.in_(list(wanted)))
    ).all()

    per_party: dict[int, list[tuple[date, Decimal, bool]]] = {}
    for line in rows:
        when = _effective_date(line.entry)
        if when > as_of:
            continue
        party_id = wanted[line.account_id]
        is_charge = line.direction == line.account.normal_side  # debit for AR, credit for AP
        per_party.setdefault(party_id, []).append(
            (when, to_money(line.amount), is_charge))

    result: list[AgingRow] = []
    for party_id, movements in per_party.items():
        movements.sort(key=lambda m: m[0])
        charges: list[list] = []  # [date, remaining]
        credit_pool = ZERO
        for when, amount, is_charge in movements:
            if is_charge:
                charges.append([when, amount])
            else:
                credit_pool += amount
        # Oldest charge is settled first.
        for charge in charges:
            if credit_pool <= ZERO:
                break
            applied = min(charge[1], credit_pool)
            charge[1] -= applied
            credit_pool -= applied

        row = AgingRow(party_id=party_id, party_name=names.get(party_id, f"#{party_id}"),
                       buckets=dict.fromkeys(BUCKETS, ZERO))
        for when, remaining in charges:
            if remaining <= ZERO:
                continue
            age = (as_of - when).days
            bucket = ("0-30" if age <= 30 else "31-60" if age <= 60
                      else "61-90" if age <= 90 else "90+")
            row.buckets[bucket] = to_money(row.buckets[bucket] + remaining)
            row.total = to_money(row.total + remaining)
        if row.total > ZERO:
            result.append(row)
    result.sort(key=lambda r: r.total, reverse=True)
    return result


def receivables_aging(db: Session, *, as_of: date | None = None) -> list[AgingRow]:
    """أعمار ديون العملاء."""
    when = as_of or date.today()
    account_by_party = {
        acc.customer_id: acc.account_id
        for acc in db.scalars(select(CustomerAccount)).all()
    }
    names = {c.id: c.name for c in db.scalars(select(Customer)).all()}
    return _aging_for_accounts(db, account_by_party=account_by_party, names=names, as_of=when)


def payables_aging(db: Session, *, as_of: date | None = None) -> list[AgingRow]:
    """أعمار مستحقات الموردين."""
    when = as_of or date.today()
    account_by_party = {
        acc.supplier_id: acc.account_id
        for acc in db.scalars(select(SupplierAccount)).all()
    }
    names = {s.id: s.name for s in db.scalars(select(Supplier)).all()}
    return _aging_for_accounts(db, account_by_party=account_by_party, names=names, as_of=when)
