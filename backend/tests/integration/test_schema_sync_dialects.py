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


def test_the_new_hr_column_is_actually_added_to_an_old_employee_table():
    """`employee.department_id` — نفس النوع من العمود اللي بيفشل في صمت.

    A column in `_ADDED_COLUMNS` is the only way a live database ever gets it: `create_all` makes
    missing TABLES and never alters an existing one. And when the DDL is wrong the failure is
    logged at `info` and swallowed, so the column simply never appears and every screen that reads
    it comes back empty — with nothing anywhere saying why.

    This builds a database from the metadata as it stood BEFORE the column existed, runs the real
    startup sync over it, and looks for the column afterwards. That is the shape a live server is
    in on the deploy that introduces it.
    """
    from sqlalchemy import Column, MetaData, Table, create_engine
    from sqlalchemy import inspect as sa_inspect

    import src.models  # noqa: F401 — populate the metadata
    from src.core.db import Base
    from src.main import _ADDED_COLUMNS, _ensure_columns

    assert ("employee", "department_id", "BIGINT") in _ADDED_COLUMNS, (
        "العمود مش في _ADDED_COLUMNS — يبقى مش هيتضاف على قاعدة شغالة"
    )

    # جدول موظفين زي ما كان قبل الميزة: نفس الأعمدة ناقصة العمود الجديد، ومن غير مفاتيح أجنبية
    # عشان الجدول يتعمل لوحده.
    live = Base.metadata.tables["employee"]
    before = MetaData()
    Table("employee", before, *[
        Column(c.name, c.type, primary_key=c.primary_key, nullable=c.nullable)
        for c in live.columns if c.name != "department_id"
    ])
    engine = create_engine("sqlite://")
    before.create_all(engine)

    def columns():
        return {c["name"] for c in sa_inspect(engine).get_columns("employee")}

    assert "department_id" not in columns()
    _ensure_columns(engine)
    assert "department_id" in columns(), (
        "المزامنة عدّت من غير ما تضيف العمود — والفشل بيتبلع، فمحدش هيعرف"
    )

    # Idempotent: a serverless cold start runs this on every request.
    _ensure_columns(engine)
    assert len([c for c in sa_inspect(engine).get_columns("employee")
                if c["name"] == "department_id"]) == 1
