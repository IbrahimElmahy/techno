"""T012: balances derived from lines; net to zero after reversal. FR-026, SC-004, SC-005."""
from decimal import Decimal

from sqlalchemy import inspect

from src.models.customer import CustomerAccount
from src.models.ledger import Account, AccountType, Direction
from src.services.ledger_service import LineInput, balance_of, post_entry, reverse_entry


def _accounts(db):
    treasury = Account(account_type=AccountType.treasury, normal_side=Direction.debit)
    custody = Account(account_type=AccountType.custody, normal_side=Direction.debit)
    db.add_all([treasury, custody])
    db.flush()
    return treasury, custody


def test_balance_equals_signed_sum(db):
    treasury, custody = _accounts(db)
    post_entry(
        db, entry_type="opening", actor_user_id=1,
        lines=[
            LineInput(treasury.id, Direction.debit, Decimal("250.00")),
            LineInput(custody.id, Direction.credit, Decimal("250.00")),
        ],
    )
    db.commit()
    # treasury normal side = debit -> +250; custody received a credit on a debit-normal acct -> -250
    assert balance_of(db, treasury.id) == Decimal("250.00")
    assert balance_of(db, custody.id) == Decimal("-250.00")


def test_balance_nets_to_zero_after_reversal(db):
    treasury, custody = _accounts(db)
    entry = post_entry(
        db, entry_type="opening", actor_user_id=1,
        lines=[
            LineInput(treasury.id, Direction.debit, Decimal("80.00")),
            LineInput(custody.id, Direction.credit, Decimal("80.00")),
        ],
    )
    db.commit()
    reverse_entry(db, original_id=entry.id, actor_user_id=1)
    db.commit()
    assert balance_of(db, treasury.id) == Decimal("0.00")
    assert balance_of(db, custody.id) == Decimal("0.00")


def test_no_stored_balance_column_on_balance_bearing_tables(db):
    # SC-004: balances are derived, never stored standalone.
    for model in (Account, CustomerAccount):
        cols = {c.key for c in inspect(model).columns}
        assert "balance" not in cols
