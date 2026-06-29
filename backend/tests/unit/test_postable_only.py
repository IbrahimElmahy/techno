"""T014: a journal line may only target a postable (leaf) account; group nodes are rejected."""
from datetime import date
from decimal import Decimal

import pytest

from src.models.ledger import Direction
from src.services import journal_service
from src.services.journal_service import JournalError, JournalLineInput


def test_posting_to_a_group_node_is_rejected(chart, db):
    group_id = chart["expense_group"]  # the seeded 5.10 group (non-postable)
    with pytest.raises(JournalError):
        journal_service.post_entry(
            db, entry_date=date(2026, 6, 28), description="إلى مجموعة",
            branch_id=chart["branch_a"],
            lines=[
                JournalLineInput(group_id, Direction.debit, Decimal("100.00")),
                JournalLineInput(chart["treasury"], Direction.credit, Decimal("100.00")),
            ],
            actor_user_id=chart["acct"],
        )


def test_posting_to_a_deactivated_leaf_is_rejected(chart, db):
    from src.services import chart_service

    chart_service.deactivate_account(db, account_id=chart["salaries"])
    with pytest.raises(JournalError):
        journal_service.post_entry(
            db, entry_date=date(2026, 6, 28), description="إلى ورقة معطلة",
            branch_id=chart["branch_a"],
            lines=[
                JournalLineInput(chart["salaries"], Direction.debit, Decimal("100.00")),
                JournalLineInput(chart["treasury"], Direction.credit, Decimal("100.00")),
            ],
            actor_user_id=chart["acct"],
        )
