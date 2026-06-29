"""Trial balance (005, T025).

Fully derived from `ledger_line`/`ledger_entry` (Principle IX) — never stored. Per postable account:
opening (signed Σ before `from`), period debit/credit (in range), and closing (opening + movement
on the normal side). Group nodes roll up descendant leaves. Grand-total debit == grand-total credit.

Dates filter by the entry's **accounting date** (`entry_date`), falling back to `created_at::date`
for legacy 001/002/003 posts that predate the column (finding A). DB-agnostic (SQLite + MySQL).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.services import chart_service


@dataclass
class _Bucket:
    opening: Decimal = ZERO
    period_debit: Decimal = ZERO
    period_credit: Decimal = ZERO

    @property
    def closing(self) -> Decimal:
        return self.opening + self.period_debit - self.period_credit  # in debit-positive terms


@dataclass
class TrialBalanceRow:
    account_id: int
    code: str | None
    name: str | None
    is_postable: bool
    opening: Decimal
    period_debit: Decimal
    period_credit: Decimal
    closing: Decimal


@dataclass
class TrialBalanceResult:
    from_date: date
    to_date: date
    branch_id: int | None
    rows: list[TrialBalanceRow] = field(default_factory=list)
    grand_total_debit: Decimal = ZERO
    grand_total_credit: Decimal = ZERO

    @property
    def balanced(self) -> bool:
        return self.grand_total_debit == self.grand_total_credit


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def _account_label(db: Session, acc: Account) -> str | None:
    """Per-owner system accounts have no name/code — label them by type+owner for the report."""
    if acc.name:
        return acc.name
    if acc.owner_ref is not None:
        return f"{acc.account_type.value}#{acc.owner_ref}"
    return acc.account_type.value


def trial_balance(
    db: Session,
    *,
    from_date: date,
    to_date: date,
    branch_id: int | None = None,
    include_groups: bool = True,
    cost_center_id: int | None = None,
) -> TrialBalanceResult:
    # Pull lines joined to their entry once; bucket in Python (DB-agnostic date handling).
    stmt = select(LedgerLine, LedgerEntry).join(LedgerEntry, LedgerLine.entry_id == LedgerEntry.id)
    if branch_id is not None:
        stmt = stmt.where(LedgerEntry.branch_id == branch_id)
    if cost_center_id is not None:  # optional analytical scope (006)
        stmt = stmt.where(LedgerLine.cost_center_id == cost_center_id)

    buckets: dict[int, _Bucket] = {}
    for line, entry in db.execute(stmt).all():
        eff = _effective_date(entry)
        if eff > to_date:
            continue
        b = buckets.setdefault(line.account_id, _Bucket())
        amount = to_money(line.amount)
        if eff < from_date:
            # opening accumulates in debit-positive terms (debit +, credit −)
            b.opening += amount if line.direction == Direction.debit else -amount
        else:
            if line.direction == Direction.debit:
                b.period_debit += amount
            else:
                b.period_credit += amount

    result = TrialBalanceResult(from_date=from_date, to_date=to_date, branch_id=branch_id)

    # Leaf rows (postable accounts that have any activity in or before the range).
    leaf_rows: dict[int, TrialBalanceRow] = {}
    for account_id, b in buckets.items():
        acc = db.get(Account, account_id)
        if acc is None or not acc.is_postable:
            continue
        # Sign opening/closing to the account's normal side for display.
        sign = 1 if acc.normal_side == Direction.debit else -1
        row = TrialBalanceRow(
            account_id=account_id,
            code=acc.code,
            name=_account_label(db, acc),
            is_postable=True,
            opening=to_money(b.opening * sign),
            period_debit=to_money(b.period_debit),
            period_credit=to_money(b.period_credit),
            closing=to_money(b.closing * sign),
        )
        leaf_rows[account_id] = row
        result.grand_total_debit += row.period_debit
        result.grand_total_credit += row.period_credit

    result.grand_total_debit = to_money(result.grand_total_debit)
    result.grand_total_credit = to_money(result.grand_total_credit)

    rows: list[TrialBalanceRow] = list(leaf_rows.values())

    if include_groups:
        rows.extend(_group_rows(db, buckets))

    rows.sort(key=lambda r: (r.code or "~", r.account_id))
    result.rows = rows
    return result


def _group_rows(db: Session, buckets: dict[int, _Bucket]) -> list[TrialBalanceRow]:
    """Roll each leaf's movement up to every ancestor group via effective parent links."""
    group_acc: dict[int, _Bucket] = {}
    for account_id, b in buckets.items():
        acc = db.get(Account, account_id)
        if acc is None or not acc.is_postable:
            continue
        parent_id = chart_service.effective_parent_id(db, acc)
        guard = 0
        while parent_id is not None and guard < 64:
            gb = group_acc.setdefault(parent_id, _Bucket())
            gb.opening += b.opening
            gb.period_debit += b.period_debit
            gb.period_credit += b.period_credit
            parent = db.get(Account, parent_id)
            parent_id = parent.parent_id if parent else None
            guard += 1

    rows: list[TrialBalanceRow] = []
    for group_id, gb in group_acc.items():
        grp = db.get(Account, group_id)
        if grp is None:
            continue
        sign = 1 if grp.normal_side == Direction.debit else -1
        rows.append(
            TrialBalanceRow(
                account_id=group_id,
                code=grp.code,
                name=grp.name,
                is_postable=False,
                opening=to_money(gb.opening * sign),
                period_debit=to_money(gb.period_debit),
                period_credit=to_money(gb.period_credit),
                closing=to_money(gb.closing * sign),
            )
        )
    return rows
