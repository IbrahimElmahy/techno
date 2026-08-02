"""Account statements — كشف حساب (018-finance-vouchers).

A running-balance statement for one ledger account over a period: the opening balance carried
from everything before `date_from`, every movement inside the window, and the closing balance.
Signed by the account's normal side, so a customer's «مدين» reads positive = he owes us.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.cost_center import CostCenter
from src.models.ledger import Account, LedgerEntry, LedgerLine


class StatementError(Exception):
    pass


@dataclass(frozen=True)
class StatementLine:
    entry_id: int
    entry_date: date
    entry_type: str
    description: str
    debit: Decimal
    credit: Decimal
    balance_before: Decimal  # the balance this movement started from
    balance: Decimal  # running, signed by the account's normal side
    # (031) Their كشف حساب carries a cost-centre column. The journal line has always held it and
    # the statement dropped it, so «which project was this against?» meant opening the entry.
    cost_center_id: int | None = None
    cost_center_name: str | None = None


@dataclass(frozen=True)
class Statement:
    account_id: int
    account_name: str
    opening_balance: Decimal
    closing_balance: Decimal
    total_debit: Decimal
    total_credit: Decimal
    lines: list[StatementLine]


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def account_statement(
    db: Session, *, account_id: int, date_from: date | None = None,
    date_to: date | None = None,
) -> Statement:
    account = db.get(Account, account_id)
    if account is None:
        raise StatementError("الحساب غير موجود.")

    rows = db.scalars(
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry))
        .where(LedgerLine.account_id == account_id)
    ).all()

    # One query for the names rather than one per line: a statement can run to hundreds of rows.
    cost_centers = {c.id: c.name for c in db.scalars(select(CostCenter)).all()}

    def signed(line: LedgerLine) -> Decimal:
        amount = to_money(line.amount)
        return amount if line.direction == account.normal_side else -amount

    dated = sorted(
        ((_effective_date(line.entry), line) for line in rows),
        key=lambda pair: (pair[0], pair[1].entry_id, pair[1].id),
    )

    opening = ZERO
    window: list[tuple[date, LedgerLine]] = []
    for when, line in dated:
        if date_from is not None and when < date_from:
            opening += signed(line)
            continue
        if date_to is not None and when > date_to:
            continue
        window.append((when, line))

    balance = to_money(opening)
    total_debit = total_credit = ZERO
    lines: list[StatementLine] = []
    for when, line in window:
        amount = to_money(line.amount)
        is_debit = line.direction.value == "debit"
        debit = amount if is_debit else ZERO
        credit = amount if not is_debit else ZERO
        total_debit += debit
        total_credit += credit
        # Both sides of every row: what the account stood at before this movement and after it,
        # so a single line can be read on its own without adding up the ones above it.
        before = balance
        balance = to_money(balance + signed(line))
        lines.append(StatementLine(
            entry_id=line.entry_id, entry_date=when, entry_type=line.entry.entry_type,
            description=line.statement or line.entry.description or "",
            debit=debit, credit=credit, balance_before=before, balance=balance,
            cost_center_id=line.cost_center_id,
            cost_center_name=cost_centers.get(line.cost_center_id),
        ))

    return Statement(
        account_id=account_id, account_name=account.name or f"#{account_id}",
        opening_balance=to_money(opening), closing_balance=balance,
        total_debit=to_money(total_debit), total_credit=to_money(total_credit), lines=lines,
    )
