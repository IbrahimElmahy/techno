"""T011: reversing a tagged entry copies each line's cost center onto its mirror line."""
from datetime import date
from decimal import Decimal

from src.models.ledger import Direction
from src.services import journal_service
from src.services.journal_service import JournalLineInput


def test_reversal_copies_cost_center(cost_centers, db):
    entry = journal_service.post_entry(
        db, entry_date=date(2026, 6, 28), description="إيجار", branch_id=cost_centers["branch_a"],
        lines=[
            JournalLineInput(cost_centers["rent"], Direction.debit, Decimal("700.00"), None,
                             cost_centers["cc_nasr"]),
            JournalLineInput(cost_centers["treasury"], Direction.credit, Decimal("700.00"), None,
                             cost_centers["cc_nasr"]),
        ],
        actor_user_id=cost_centers["acct"],
    )
    rev = journal_service.reverse_entry(db, entry_id=entry.id, actor_user_id=cost_centers["acct"])
    # every mirror line carries the same cost center → nets to zero within that center
    assert all(l.cost_center_id == cost_centers["cc_nasr"] for l in rev.lines)
    # directions are swapped relative to the original
    assert {(l.account_id, l.direction) for l in rev.lines} != {
        (l.account_id, l.direction) for l in entry.lines
    }
