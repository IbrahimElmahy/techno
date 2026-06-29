"""T014: trial balance scoped by cost center; unfiltered output unchanged (no regression)."""
from datetime import date
from decimal import Decimal

from src.services import journal_service, trial_balance_service
from src.services.journal_service import JournalLineInput
from src.models.ledger import Direction


def _post(cc, db, cost_center_id, amount):
    return journal_service.post_entry(
        db, entry_date=date(2026, 6, 10), description="t", branch_id=cc["branch_a"],
        lines=[
            JournalLineInput(cc["rent"], Direction.debit, Decimal(amount), None, cost_center_id),
            JournalLineInput(cc["treasury"], Direction.credit, Decimal(amount), None, cost_center_id),
        ],
        actor_user_id=cc["acct"],
    )


def test_filter_aggregates_only_that_center(cost_centers, db):
    _post(cost_centers, db, cost_centers["cc_nasr"], "1000.00")
    _post(cost_centers, db, cost_centers["cc_maadi"], "400.00")
    db.commit()

    tb = trial_balance_service.trial_balance(
        db, from_date=date(2026, 1, 1), to_date=date(2026, 12, 31),
        branch_id=cost_centers["branch_a"], cost_center_id=cost_centers["cc_nasr"],
    )
    rows = {r.account_id: r for r in tb.rows}
    assert rows[cost_centers["rent"]].period_debit == Decimal("1000.00")  # only Nasr
    assert tb.grand_total_debit == tb.grand_total_credit == Decimal("1000.00")
    assert tb.balanced


def test_unfiltered_includes_all(cost_centers, db):
    _post(cost_centers, db, cost_centers["cc_nasr"], "1000.00")
    _post(cost_centers, db, cost_centers["cc_maadi"], "400.00")
    db.commit()

    tb = trial_balance_service.trial_balance(
        db, from_date=date(2026, 1, 1), to_date=date(2026, 12, 31), branch_id=cost_centers["branch_a"],
    )
    rows = {r.account_id: r for r in tb.rows}
    assert rows[cost_centers["rent"]].period_debit == Decimal("1400.00")  # both centers
    assert tb.grand_total_debit == tb.grand_total_credit == Decimal("1400.00")


def test_unfiltered_matches_pre_feature_behaviour(cost_centers, db):
    # An untagged entry behaves exactly as in 005 (no cost-center column effect when unfiltered).
    journal_service.post_entry(
        db, entry_date=date(2026, 3, 1), description="بدون مركز", branch_id=cost_centers["branch_a"],
        lines=[
            JournalLineInput(cost_centers["salaries"], Direction.debit, Decimal("500.00")),
            JournalLineInput(cost_centers["treasury"], Direction.credit, Decimal("500.00")),
        ],
        actor_user_id=cost_centers["acct"],
    )
    db.commit()
    tb = trial_balance_service.trial_balance(
        db, from_date=date(2026, 1, 1), to_date=date(2026, 12, 31), branch_id=cost_centers["branch_a"],
    )
    rows = {r.account_id: r for r in tb.rows}
    assert rows[cost_centers["salaries"]].period_debit == Decimal("500.00")
    assert tb.balanced
