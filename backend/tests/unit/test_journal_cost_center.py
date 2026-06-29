"""T010: journal lines carry an optional cost center; deactivated/unknown rejected; balance unaffected."""
from datetime import date
from decimal import Decimal

import pytest

from src.models.ledger import Direction
from src.services import cost_center_service, journal_service
from src.services.journal_service import JournalError, JournalLineInput


def _post(cc, db, cost_center_id=None):
    return journal_service.post_entry(
        db, entry_date=date(2026, 6, 28), description="إيجار", branch_id=cc["branch_a"],
        lines=[
            JournalLineInput(cc["rent"], Direction.debit, Decimal("5000.00"), None, cost_center_id),
            JournalLineInput(cc["treasury"], Direction.credit, Decimal("5000.00")),
        ],
        actor_user_id=cc["acct"],
    )


def test_line_posts_with_cost_center(cost_centers, db):
    entry = _post(cost_centers, db, cost_center_id=cost_centers["cc_nasr"])
    tagged = [l for l in entry.lines if l.cost_center_id == cost_centers["cc_nasr"]]
    untagged = [l for l in entry.lines if l.cost_center_id is None]
    assert len(tagged) == 1 and len(untagged) == 1  # optional per line


def test_line_posts_without_cost_center(cost_centers, db):
    entry = _post(cost_centers, db, cost_center_id=None)
    assert all(l.cost_center_id is None for l in entry.lines)


def test_unknown_cost_center_rejected(cost_centers, db):
    with pytest.raises(JournalError):
        _post(cost_centers, db, cost_center_id=999999)


def test_deactivated_cost_center_rejected(cost_centers, db):
    cost_center_service.deactivate(db, cost_center_id=cost_centers["cc_maadi"])
    with pytest.raises(JournalError):
        _post(cost_centers, db, cost_center_id=cost_centers["cc_maadi"])


def test_tagging_does_not_affect_balance(cost_centers, db):
    # Same balanced entry posts whether tagged or not (tag is orthogonal to balancing).
    e1 = _post(cost_centers, db, cost_center_id=cost_centers["cc_nasr"])
    e2 = _post(cost_centers, db, cost_center_id=None)
    assert len(e1.lines) == len(e2.lines) == 2
