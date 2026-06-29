"""T011: reversal symmetry, reverse-once, non-re-reversible. FR-027, Principle IV."""
from decimal import Decimal

import pytest

from src.models.ledger import Account, AccountType, Direction
from src.services.ledger_service import LedgerError, LineInput, post_entry, reverse_entry


def _setup(db):
    a = Account(account_type=AccountType.treasury, normal_side=Direction.debit)
    b = Account(account_type=AccountType.custody, normal_side=Direction.debit)
    db.add_all([a, b])
    db.flush()
    entry = post_entry(
        db,
        entry_type="handover",
        actor_user_id=1,
        lines=[
            LineInput(a.id, Direction.debit, Decimal("100.00")),
            LineInput(b.id, Direction.credit, Decimal("100.00")),
        ],
    )
    db.commit()
    return a, b, entry


def test_reversal_mirrors_and_links(db):
    a, b, entry = _setup(db)
    rev = reverse_entry(db, original_id=entry.id, actor_user_id=1)
    db.commit()
    assert rev.reverses_entry_id == entry.id
    # Legs are swapped relative to the original.
    by_account = {ln.account_id: ln.direction for ln in rev.lines}
    assert by_account[a.id] == Direction.credit
    assert by_account[b.id] == Direction.debit
    # Original is untouched.
    assert entry.reverses_entry_id is None
    assert len(entry.lines) == 2


def test_entry_reversed_at_most_once(db):
    _, _, entry = _setup(db)
    reverse_entry(db, original_id=entry.id, actor_user_id=1)
    db.commit()
    with pytest.raises(LedgerError):
        reverse_entry(db, original_id=entry.id, actor_user_id=1)


def test_reversal_is_not_re_reversible(db):
    _, _, entry = _setup(db)
    rev = reverse_entry(db, original_id=entry.id, actor_user_id=1)
    db.commit()
    with pytest.raises(LedgerError):
        reverse_entry(db, original_id=rev.id, actor_user_id=1)
