"""T010: balanced posting, validation, immutability. FR-024, FR-028."""
from decimal import Decimal

import pytest

from src.models.ledger import Account, AccountType, Direction, LedgerImmutableError
from src.services.ledger_service import LedgerError, LineInput, post_entry


def _two_accounts(db):
    a = Account(account_type=AccountType.treasury, normal_side=Direction.debit)
    b = Account(account_type=AccountType.custody, normal_side=Direction.debit)
    db.add_all([a, b])
    db.flush()
    return a, b


def test_balanced_entry_commits(db):
    a, b = _two_accounts(db)
    entry = post_entry(
        db,
        entry_type="opening",
        actor_user_id=1,
        lines=[
            LineInput(a.id, Direction.debit, Decimal("100.00")),
            LineInput(b.id, Direction.credit, Decimal("100.00")),
        ],
    )
    db.commit()
    assert entry.id is not None
    assert len(entry.lines) == 2


def test_unbalanced_entry_rejected(db):
    a, b = _two_accounts(db)
    with pytest.raises(LedgerError):
        post_entry(
            db,
            entry_type="bad",
            actor_user_id=1,
            lines=[
                LineInput(a.id, Direction.debit, Decimal("100.00")),
                LineInput(b.id, Direction.credit, Decimal("90.00")),
            ],
        )


def test_single_line_rejected(db):
    a, _ = _two_accounts(db)
    with pytest.raises(LedgerError):
        post_entry(
            db,
            entry_type="bad",
            actor_user_id=1,
            lines=[LineInput(a.id, Direction.debit, Decimal("10.00"))],
        )


def test_posted_line_cannot_be_updated(db):
    a, b = _two_accounts(db)
    entry = post_entry(
        db,
        entry_type="opening",
        actor_user_id=1,
        lines=[
            LineInput(a.id, Direction.debit, Decimal("50.00")),
            LineInput(b.id, Direction.credit, Decimal("50.00")),
        ],
    )
    db.commit()
    entry.lines[0].amount = Decimal("999.00")
    with pytest.raises(LedgerImmutableError):
        db.flush()


def test_posted_entry_cannot_be_deleted(db):
    a, b = _two_accounts(db)
    entry = post_entry(
        db,
        entry_type="opening",
        actor_user_id=1,
        lines=[
            LineInput(a.id, Direction.debit, Decimal("50.00")),
            LineInput(b.id, Direction.credit, Decimal("50.00")),
        ],
    )
    db.commit()
    db.delete(entry)
    with pytest.raises(LedgerImmutableError):
        db.flush()
