"""Ledger service (T017–T019): post_entry, reverse_entry, balance_of.

The only write paths into the ledger. No update/delete — corrections are reversals (FR-027/028).
All balances are derived here from `ledger_line` (FR-026); nothing is stored standalone.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine


class LedgerError(Exception):
    """Invalid ledger operation (unbalanced, too few lines, double reversal, ...)."""


@dataclass(frozen=True)
class LineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None  # per-line بيان (005); ignored by 001/002/003 callers
    cost_center_id: int | None = None  # optional analytical dimension (006)


def _validate_lines(lines: list[LineInput]) -> None:
    if len(lines) < 2:
        raise LedgerError("A ledger entry MUST have at least two lines.")
    debit = sum((to_money(l.amount) for l in lines if l.direction == Direction.debit), ZERO)
    credit = sum((to_money(l.amount) for l in lines if l.direction == Direction.credit), ZERO)
    if any(to_money(l.amount) <= ZERO for l in lines):
        raise LedgerError("Every line amount MUST be positive.")
    if debit != credit:
        raise LedgerError(f"Unbalanced entry: debit {debit} != credit {credit}.")


def post_entry(
    db: Session,
    *,
    entry_type: str,
    actor_user_id: int,
    lines: list[LineInput],
    description: str = "",
    rep_id: int | None = None,
    branch_id: int | None = None,
    reverses_entry_id: int | None = None,
    entry_date: date | None = None,
) -> LedgerEntry:
    """Append a balanced, immutable entry. Returns the persisted entry with lines."""
    _validate_lines(lines)
    entry = LedgerEntry(
        entry_type=entry_type,
        description=description,
        actor_user_id=actor_user_id,
        rep_id=rep_id,
        branch_id=branch_id,
        reverses_entry_id=reverses_entry_id,
        entry_date=entry_date,
    )
    entry.lines = [
        LedgerLine(
            account_id=l.account_id,
            direction=l.direction,
            amount=to_money(l.amount),
            statement=l.statement,
            cost_center_id=l.cost_center_id,
        )
        for l in lines
    ]
    db.add(entry)
    db.flush()
    return entry


def reverse_entry(db: Session, *, original_id: int, actor_user_id: int) -> LedgerEntry:
    """Create the mirror reversal of an entry (debits<->credits swapped).

    Enforces reverse-once (UNIQUE reverses_entry_id) and that a reversal is not re-reversible.
    """
    original = db.get(LedgerEntry, original_id)
    if original is None:
        raise LedgerError("Original entry not found.")
    if original.reverses_entry_id is not None:
        raise LedgerError("A reversal entry is itself not re-reversible.")
    existing = db.scalar(
        select(LedgerEntry).where(LedgerEntry.reverses_entry_id == original_id)
    )
    if existing is not None:
        raise LedgerError("Entry has already been reversed (reverse-once).")

    swapped = [
        LineInput(
            account_id=line.account_id,
            direction=(
                Direction.credit if line.direction == Direction.debit else Direction.debit
            ),
            amount=line.amount,
            statement=line.statement,
            cost_center_id=line.cost_center_id,  # reversal nets within the same cost center (006)
        )
        for line in original.lines
    ]
    return post_entry(
        db,
        entry_type="reversal",
        actor_user_id=actor_user_id,
        lines=swapped,
        description=f"Reversal of entry {original_id}",
        rep_id=original.rep_id,
        branch_id=original.branch_id,
        reverses_entry_id=original_id,
        # Reversal nets in the original's accounting period (005 analysis finding A/C).
        entry_date=original.entry_date,
    )


def balance_of(db: Session, account_id: int) -> Decimal:
    """Derive an account's balance from its lines (signed by the account's normal side)."""
    account = db.get(Account, account_id)
    if account is None:
        raise LedgerError("Account not found.")
    total = ZERO
    lines = db.scalars(select(LedgerLine).where(LedgerLine.account_id == account_id)).all()
    for line in lines:
        signed = (
            to_money(line.amount)
            if line.direction == account.normal_side
            else -to_money(line.amount)
        )
        total += signed
    return to_money(total)
