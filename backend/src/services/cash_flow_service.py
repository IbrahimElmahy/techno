from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.ledger import (
    Account,
    AccountNature,
    AccountType,
    Direction,
    LedgerEntry,
    LedgerLine,
)
from src.models.treasury import Treasury
from src.services import ledger_service
from src.services.financial_reports_service import effective_nature

SECTIONS = ("operating", "investing", "financing", "transfer", "unallocated")

SECTION_LABEL: dict[str, str] = {
    "operating": "التشغيل",
    "investing": "الاستثمار",
    "financing": "التمويل",
    "transfer": "تحويلات بين الخزن",
    "unallocated": "غير موزّع",
}


@dataclass
class CashFlowLine:
    account_id: int | None
    code: str | None
    name: str | None
    inflow: Decimal = ZERO
    outflow: Decimal = ZERO
    net: Decimal = ZERO


@dataclass
class CashFlowSection:
    key: str
    label: str
    lines: list[CashFlowLine] = field(default_factory=list)
    net: Decimal = ZERO


@dataclass
class CashFlow:
    date_from: date | None
    date_to: date | None
    opening: Decimal
    closing: Decimal
    net_change: Decimal
    sections: list[CashFlowSection]
    consistent: bool


def liquidity_account_ids(db: Session) -> set[int]:
    ids = {int(i) for i in db.scalars(select(Treasury.account_id)).all()}
    ids |= {
        int(i) for i in db.scalars(
            select(Account.id).where(Account.account_type == AccountType.treasury)
        ).all()
    }
    return ids


def _section_of(acc: Account, liquidity: set[int]) -> str:
    if acc.id in liquidity:
        return "transfer"
    if acc.account_type in (AccountType.customer_receivable, AccountType.supplier_payable):
        return "operating"
    nature = effective_nature(acc)
    if nature in (AccountNature.income, AccountNature.expense):
        return "operating"
    if nature == AccountNature.equity:
        return "financing"
    if nature == AccountNature.asset:
        return "investing"
    if nature == AccountNature.liability:
        return "financing"
    return "operating"


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def _signed(line: LedgerLine) -> Decimal:
    amount = to_money(line.amount)
    return amount if line.direction == Direction.debit else -amount


def cash_flow(
    db: Session, *, date_from: date | None = None, date_to: date | None = None,
    branch_id: int | None = None,
) -> CashFlow:
    liquidity = liquidity_account_ids(db)
    empty = CashFlow(date_from=date_from, date_to=date_to, opening=ZERO, closing=ZERO,
                     net_change=ZERO, sections=[], consistent=True)
    if not liquidity:
        return empty

    entry_ids = {
        int(i) for i in db.scalars(
            select(LedgerLine.entry_id).where(LedgerLine.account_id.in_(list(liquidity)))
        ).all()
    }
    if not entry_ids:
        return empty

    stmt = (
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry), selectinload(LedgerLine.account))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.entry_id.in_(list(entry_ids)), ledger_service.is_posted_sql())
    )
    if branch_id is not None:
        stmt = stmt.where(
            (LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    lines = db.scalars(stmt).all()

    by_entry: dict[int, list[LedgerLine]] = {}
    for line in lines:
        by_entry.setdefault(line.entry_id, []).append(line)

    opening = ZERO
    cash_in_window = ZERO
    buckets: dict[str, dict[int | None, CashFlowLine]] = {k: {} for k in SECTIONS}

    for entry_lines in by_entry.values():
        entry = entry_lines[0].entry
        when = _effective_date(entry)
        if date_to is not None and when > date_to:
            continue
        cash_delta = sum(
            (_signed(ln) for ln in entry_lines if ln.account_id in liquidity), ZERO
        )
        if date_from is not None and when < date_from:
            opening = to_money(opening + cash_delta)
            continue
        cash_in_window = to_money(cash_in_window + cash_delta)

        all_liquidity = all(ln.account_id in liquidity for ln in entry_lines)

        attributed = ZERO
        for line in entry_lines:
            if line.account_id in liquidity and not all_liquidity:
                continue
            value = to_money(-_signed(line))
            attributed = to_money(attributed + value)
            acc = line.account
            section = _section_of(acc, liquidity)
            slot = buckets[section].get(acc.id)
            if slot is None:
                slot = CashFlowLine(account_id=acc.id, code=acc.code,
                                    name=acc.name or acc.account_type.value)
                buckets[section][acc.id] = slot
            if value >= ZERO:
                slot.inflow = to_money(slot.inflow + value)
            else:
                slot.outflow = to_money(slot.outflow - value)
            slot.net = to_money(slot.net + value)

        gap = to_money(cash_delta - attributed)
        if gap != ZERO:
            slot = buckets["unallocated"].get(None)
            if slot is None:
                slot = CashFlowLine(account_id=None, code=None, name="قيود غير متوازنة")
                buckets["unallocated"][None] = slot
            if gap >= ZERO:
                slot.inflow = to_money(slot.inflow + gap)
            else:
                slot.outflow = to_money(slot.outflow - gap)
            slot.net = to_money(slot.net + gap)

    sections: list[CashFlowSection] = []
    for key in SECTIONS:
        rows = [r for r in buckets[key].values() if r.net != ZERO or r.inflow or r.outflow]
        if not rows:
            continue
        rows.sort(key=lambda r: (r.code or "", r.name or ""))
        sections.append(CashFlowSection(
            key=key, label=SECTION_LABEL[key], lines=rows,
            net=to_money(sum((r.net for r in rows), ZERO)),
        ))

    net_change = to_money(sum((s.net for s in sections), ZERO))
    return CashFlow(
        date_from=date_from, date_to=date_to,
        opening=to_money(opening),
        closing=to_money(opening + cash_in_window),
        net_change=net_change,
        sections=sections,
        consistent=net_change == cash_in_window,
    )
