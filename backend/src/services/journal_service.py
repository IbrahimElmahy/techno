"""Manual journal entries (005, T015/T019).

A journal entry IS a balanced Foundation `ledger_entry` (one ledger; Principle VI). This service
adds the chart-specific guard — every line must target a postable, active leaf — then delegates
balancing, immutability, and reverse-once to `ledger_service`, and records audit explicitly
(post_entry does NOT auto-audit, analysis finding B).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from src.models.ledger import Direction, LedgerEntry
from src.services import audit_service, chart_service, ledger_service
from src.services.ledger_service import LedgerError, LineInput


class JournalError(Exception):
    """Invalid journal entry (non-postable account, unbalanced, etc.)."""


@dataclass(frozen=True)
class JournalLineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None


def post_entry(
    db: Session,
    *,
    entry_date: date,
    description: str,
    branch_id: int | None,
    lines: list[JournalLineInput],
    actor_user_id: int,
    entry_type: str = "journal",
) -> LedgerEntry:
    """Post a manual journal entry. ≥2 balanced lines, all on postable+active leaves."""
    if not lines:
        raise JournalError("A journal entry must have at least two lines.")
    for ln in lines:
        if not chart_service.is_postable_leaf(db, ln.account_id):
            raise JournalError(
                f"Account {ln.account_id} is not a postable, active leaf; journals post to leaves."
            )
    try:
        entry = ledger_service.post_entry(
            db,
            entry_type=entry_type,
            actor_user_id=actor_user_id,
            lines=[LineInput(ln.account_id, ln.direction, ln.amount, ln.statement) for ln in lines],
            description=description,
            branch_id=branch_id,
            entry_date=entry_date,
        )
    except LedgerError as exc:  # unbalanced / <2 lines / non-positive amount
        raise JournalError(str(exc)) from exc

    audit_service.record(
        db, action="journal.post", actor_user_id=actor_user_id, entity_type="ledger_entry",
        entity_id=entry.id, after={"entry_type": entry_type, "branch_id": branch_id},
    )
    return entry


def reverse_entry(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    """Correct a journal entry by posting its linked mirror (reverse-once; never edit/delete)."""
    try:
        reversal = ledger_service.reverse_entry(
            db, original_id=entry_id, actor_user_id=actor_user_id
        )
    except LedgerError as exc:  # already reversed / not re-reversible / missing
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.reverse", actor_user_id=actor_user_id, entity_type="ledger_entry",
        entity_id=reversal.id, after={"reverses_entry_id": entry_id},
    )
    return reversal
