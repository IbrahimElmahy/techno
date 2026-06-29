"""T013: a journal entry must have >=2 lines and balance (Sigma debit == Sigma credit)."""
from datetime import date
from decimal import Decimal

import pytest

from src.models.ledger import Direction, LedgerEntry
from src.services import journal_service
from src.services.journal_service import JournalError, JournalLineInput


def _line(account_id, direction, amount):
    return JournalLineInput(account_id, direction, Decimal(amount))


def test_balanced_entry_posts_as_one_ledger_entry(chart, db):
    entry = journal_service.post_entry(
        db,
        entry_date=date(2026, 6, 28),
        description="إيجار يونيو",
        branch_id=chart["branch_a"],
        lines=[
            _line(chart["rent"], Direction.debit, "5000.00"),
            _line(chart["treasury"], Direction.credit, "5000.00"),
        ],
        actor_user_id=chart["acct"],
    )
    assert isinstance(entry, LedgerEntry)
    assert entry.entry_type == "journal"
    assert entry.entry_date == date(2026, 6, 28)
    assert len(entry.lines) == 2


def test_unbalanced_entry_rejected(chart, db):
    with pytest.raises(JournalError):
        journal_service.post_entry(
            db, entry_date=date(2026, 6, 28), description="غير متوازن",
            branch_id=chart["branch_a"],
            lines=[
                _line(chart["rent"], Direction.debit, "5000.00"),
                _line(chart["treasury"], Direction.credit, "4000.00"),
            ],
            actor_user_id=chart["acct"],
        )


def test_single_line_rejected(chart, db):
    with pytest.raises(JournalError):
        journal_service.post_entry(
            db, entry_date=date(2026, 6, 28), description="سطر واحد",
            branch_id=chart["branch_a"],
            lines=[_line(chart["rent"], Direction.debit, "5000.00")],
            actor_user_id=chart["acct"],
        )
