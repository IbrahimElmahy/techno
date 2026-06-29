"""T018: a journal entry is corrected by a linked reversing entry; reverse-once."""
from datetime import date
from decimal import Decimal

import pytest

from src.models.ledger import Direction
from src.services import journal_service
from src.services.journal_service import JournalError, JournalLineInput


def _post(chart, db):
    return journal_service.post_entry(
        db, entry_date=date(2026, 6, 28), description="قيد للعكس",
        branch_id=chart["branch_a"],
        lines=[
            JournalLineInput(chart["rent"], Direction.debit, Decimal("700.00")),
            JournalLineInput(chart["treasury"], Direction.credit, Decimal("700.00")),
        ],
        actor_user_id=chart["acct"],
    )


def test_reversal_mirrors_and_links(chart, db):
    entry = _post(chart, db)
    rev = journal_service.reverse_entry(db, entry_id=entry.id, actor_user_id=chart["acct"])
    assert rev.reverses_entry_id == entry.id
    # directions swapped
    orig = {(l.account_id, l.direction) for l in entry.lines}
    revd = {(l.account_id, l.direction) for l in rev.lines}
    assert orig != revd
    # the same account that was debited is now credited
    assert (chart["rent"], Direction.credit) in revd
    # nets to zero — entry_date carried so it nets in the same period
    assert rev.entry_date == entry.entry_date


def test_reverse_twice_rejected(chart, db):
    entry = _post(chart, db)
    journal_service.reverse_entry(db, entry_id=entry.id, actor_user_id=chart["acct"])
    with pytest.raises(JournalError):
        journal_service.reverse_entry(db, entry_id=entry.id, actor_user_id=chart["acct"])


def test_reversing_a_reversal_rejected(chart, db):
    entry = _post(chart, db)
    rev = journal_service.reverse_entry(db, entry_id=entry.id, actor_user_id=chart["acct"])
    with pytest.raises(JournalError):
        journal_service.reverse_entry(db, entry_id=rev.id, actor_user_id=chart["acct"])
