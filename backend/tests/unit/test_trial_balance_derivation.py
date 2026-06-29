"""T024: trial balance is derived from ledger lines; filters by entry_date; grand totals equal."""
from datetime import date
from decimal import Decimal

from src.models.ledger import Direction
from src.services import journal_service, opening_balance_service, trial_balance_service
from src.services.journal_service import JournalLineInput
from src.services.opening_balance_service import OpeningLineInput


def _post(chart, db, d, debit_acc, credit_acc, amount):
    return journal_service.post_entry(
        db, entry_date=d, description="t", branch_id=chart["branch_a"],
        lines=[
            JournalLineInput(debit_acc, Direction.debit, Decimal(amount)),
            JournalLineInput(credit_acc, Direction.credit, Decimal(amount)),
        ],
        actor_user_id=chart["acct"],
    )


def test_per_account_derivation_and_grand_totals(chart, db):
    _post(chart, db, date(2026, 3, 1), chart["rent"], chart["treasury"], "1000.00")
    _post(chart, db, date(2026, 3, 5), chart["salaries"], chart["treasury"], "2000.00")
    db.commit()

    tb = trial_balance_service.trial_balance(
        db, from_date=date(2026, 1, 1), to_date=date(2026, 12, 31), branch_id=chart["branch_a"],
    )
    rows = {r.account_id: r for r in tb.rows}
    assert rows[chart["rent"]].period_debit == Decimal("1000.00")
    assert rows[chart["salaries"]].period_debit == Decimal("2000.00")
    # treasury credited 3000 total
    assert rows[chart["treasury"]].period_credit == Decimal("3000.00")
    # grand totals equal (the book balances)
    assert tb.grand_total_debit == tb.grand_total_credit == Decimal("3000.00")
    assert tb.balanced


def test_backdated_opening_lands_in_correct_period(chart, db):
    # Posted "today" but accounting-dated 2026-01-01 (before the period start of the read window).
    opening_balance_service.post_opening_balances(
        db, entry_date=date(2026, 1, 1), branch_id=chart["branch_a"],
        lines=[OpeningLineInput(chart["treasury"], Decimal("50000.00"))],
        actor_user_id=chart["acct"],
    )
    db.commit()

    tb = trial_balance_service.trial_balance(
        db, from_date=date(2026, 6, 1), to_date=date(2026, 6, 30), branch_id=chart["branch_a"],
    )
    rows = {r.account_id: r for r in tb.rows}
    # The opening is BEFORE the window -> it shows as opening, not period movement.
    assert rows[chart["treasury"]].opening == Decimal("50000.00")
    assert rows[chart["treasury"]].period_debit == Decimal("0.00")


def test_empty_range_returns_zero_not_error(chart, db):
    tb = trial_balance_service.trial_balance(
        db, from_date=date(2030, 1, 1), to_date=date(2030, 1, 31), branch_id=chart["branch_a"],
    )
    assert tb.grand_total_debit == Decimal("0.00")
    assert tb.grand_total_credit == Decimal("0.00")
    assert tb.balanced
