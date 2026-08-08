"""مزامنة السكيمة لازم تتكلم لهجة القاعدة اللي شغالة عليها.

This database is synced at startup rather than by alembic, so a constraint change either happens in
`main.py` or it never happens on a running server. That makes those statements load-bearing, and it
makes getting one wrong very quiet: the migration is wrapped in `try/except` so boot survives a
transient hiccup, which also means a permanently-wrong statement fails on every start and nobody
sees it.

That is what happened. The drop said `DROP INDEX` — MySQL's spelling — while production runs
Postgres, which wants `DROP CONSTRAINT`. Postgres rejected it, the exception was swallowed at info
level, and the old `UNIQUE (customer_id)` stayed. A customer therefore could not hold two
receivable accounts on the server, which is the entire point of the أبيض/بولي merge: the merge came
back 503 every time, while passing every test here against MySQL.

Three attempts at making the merge faster were spent before the cause was found. None of them were
the problem.
"""
from __future__ import annotations

import pytest

from src.main import _drop_unique_sql


@pytest.mark.parametrize("dialect", ["postgresql", "postgres"])
def test_postgres_drops_a_constraint(dialect):
    """Postgres has no `ALTER TABLE ... DROP INDEX`. It is a syntax error, not a no-op."""
    sql = _drop_unique_sql(dialect, "customer_account", "uq_old")
    assert "DROP CONSTRAINT" in sql
    assert "DROP INDEX" not in sql


@pytest.mark.parametrize("dialect", ["mysql", "mariadb"])
def test_mysql_drops_an_index(dialect):
    """MySQL is the other way round: a UNIQUE is an index and `DROP CONSTRAINT` is the newer
    spelling that older servers do not take. The original statement was right for this dialect —
    it was simply used for both."""
    sql = _drop_unique_sql(dialect, "customer_account", "uq_old")
    assert "DROP INDEX" in sql
    assert "DROP CONSTRAINT" not in sql


def test_it_names_the_table_and_the_constraint_given():
    # The old constraint was created by different tools on different installs and has no
    # predictable name, so the caller finds it by inspecting columns and passes it in.
    sql = _drop_unique_sql("postgresql", "customer_account", "some_generated_name")
    assert "customer_account" in sql
    assert "some_generated_name" in sql


def test_a_customer_can_hold_two_receivable_accounts(db, inv_world):
    """The end state the migration exists to reach.

    Independent of dialect: whatever the schema sync had to do to get here, a customer holding one
    أبيض account and one بولي account is what the merge produces, and if the database refuses it
    the merge cannot work at all.
    """
    from src.models.customer import Customer, CustomerAccount
    from src.models.ledger import Account, AccountType, Direction

    cust = Customer(name="عميل بحسابين", code="TWOACC", customer_type="trader",
                    rep_id=inv_world["rep_a"], territory_id=inv_world["terr_a"], active=True)
    db.add(cust)
    db.flush()

    for family in ("أبيض", "بولي"):
        acc = Account(account_type=AccountType.customer_receivable, normal_side=Direction.debit)
        db.add(acc)
        db.flush()
        db.add(CustomerAccount(customer_id=cust.id, account_id=acc.id, family=family))
    db.flush()

    held = db.query(CustomerAccount).filter(CustomerAccount.customer_id == cust.id).all()
    assert len(held) == 2, "العميل لازم يقدر يمسك حساب لكل عيلة"
    assert {a.family for a in held} == {"أبيض", "بولي"}
