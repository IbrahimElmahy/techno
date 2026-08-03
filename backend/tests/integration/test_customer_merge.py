"""دمج «تكنو فلان» مع «فلان» — 031-a5-restructure.

The client's old system gave a customer one receivable account, so two product lines at two
commissions meant opening him twice. The import brought that across: 230 customers for 144 people.

The merge puts them back together. Its safety argument is one sentence — **it moves a pointer, not
money** — and these are the tests of that sentence:

* the two balances after a merge are the two balances before it;
* nothing is deleted, so a document that names the duplicate still resolves;
* an ambiguous case is SKIPPED WITH A REASON rather than guessed at;
* and the dry run, which is the default, changes nothing at all.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from src.services import customer_merge_service as merge


@pytest.fixture()
def two_names(client, inv_world, login, db):
    """«سامي حسن» and «تكنو سامي حسن» — one man, opened twice, each owing something."""
    from src.models.customer import CustomerAccount
    from src.models.ledger import Direction
    from src.services import account_resolver, customer_service, ledger_service
    from src.services.ledger_service import LineInput

    made = {}
    for name, amount in (("سامي حسن", 500), ("تكنو سامي حسن", 1200)):
        res = customer_service.create_customer(
            db, name=name, customer_type="trader", rep_id=inv_world["rep_a"],
            territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
        acc = db.scalar(select(CustomerAccount).where(
            CustomerAccount.customer_id == res.customer.id))
        equity = account_resolver.opening_balance_equity_account(db)
        ledger_service.post_entry(
            db, entry_type="opening_balance", actor_user_id=inv_world["admin"],
            entry_date=datetime.date(2026, 1, 1),
            lines=[LineInput(acc.account_id, Direction.debit, amount),
                   LineInput(equity.id, Direction.credit, amount)])
        made[name] = {"customer": res.customer, "account_id": acc.account_id}
    db.commit()
    return {"h": login("admin"), "made": made}


def _balance(db, account_id):
    from src.services import chart_service
    return chart_service.account_balance(db, account_id)


def test_the_plan_finds_the_pair_and_changes_nothing(db, two_names):
    from src.models.customer import Customer

    p = merge.plan(db)
    names = {pair.base_name for pair in p.pairs}
    assert "سامي حسن" in names

    # `plan` reads. The duplicate is still there, still active, still named as it was.
    dupe = db.get(Customer, two_names["made"]["تكنو سامي حسن"]["customer"].id)
    assert dupe.active is True
    assert dupe.name == "تكنو سامي حسن"


def test_a_dry_run_is_the_default_and_writes_nothing(db, two_names):
    from src.models.customer import Customer

    out = merge.apply(db)                      # no dry_run= given
    assert out["applied"] is False
    assert out["totals"]["pairs"] >= 1

    dupe = db.get(Customer, two_names["made"]["تكنو سامي حسن"]["customer"].id)
    assert dupe.active is True


def test_the_merge_moves_the_account_and_not_the_money(db, two_names):
    from src.models.customer import Customer, CustomerAccount

    keep_id = two_names["made"]["سامي حسن"]["customer"].id
    white_account = two_names["made"]["سامي حسن"]["account_id"]
    poly_account = two_names["made"]["تكنو سامي حسن"]["account_id"]
    before = (_balance(db, white_account), _balance(db, poly_account))

    out = merge.apply(db, dry_run=False)
    db.commit()
    assert out["applied"] is True

    accounts = db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == keep_id)).all()
    families = {a.family: a.account_id for a in accounts}
    assert families.get(merge.FAMILY_WHITE) == white_account
    assert families.get(merge.FAMILY_POLY) == poly_account

    # The whole safety claim, asserted: the same two numbers, now under one man.
    assert (_balance(db, white_account), _balance(db, poly_account)) == before
    assert _balance(db, white_account) == Decimal("500.00")
    assert _balance(db, poly_account) == Decimal("1200.00")

    # And the total that could not be asked for before.
    assert sum(_balance(db, a.account_id) for a in accounts) == Decimal("1700.00")

    dupe = db.get(Customer, two_names["made"]["تكنو سامي حسن"]["customer"].id)
    assert dupe.active is False, "deactivated"
    assert dupe is not None, "never deleted — documents still name this row"


def test_merging_twice_changes_nothing_the_second_time(db, two_names):
    from src.models.customer import CustomerAccount

    merge.apply(db, dry_run=False)
    db.commit()
    keep_id = two_names["made"]["سامي حسن"]["customer"].id
    after_first = {(a.family, a.account_id) for a in db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == keep_id)).all()}

    second = merge.apply(db, dry_run=False)
    db.commit()
    # The duplicate is inactive now, so the plan no longer sees a pair to make.
    assert not any(p["base_name"] == "سامي حسن" for p in second["pairs"])
    after_second = {(a.family, a.account_id) for a in db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == keep_id)).all()}
    assert after_second == after_first


def test_an_ambiguous_name_is_skipped_with_a_reason(db, inv_world):
    """«اداره مبيعات» exists under BOTH reps in the client's file. Guessing which one a تكنو row
    belongs to would put a balance on the wrong card, so it is reported and left alone."""
    from src.services import customer_service

    for rep, terr in ((inv_world["rep_a"], inv_world["terr_a"]),
                      (inv_world["rep_b"], inv_world["terr_b"])):
        customer_service.create_customer(
            db, name="اداره مبيعات", customer_type="trader", rep_id=rep,
            territory_id=terr, phone=None, actor_user_id=inv_world["admin"])
    customer_service.create_customer(
        db, name="تكنو اداره مبيعات", customer_type="trader", rep_id=inv_world["rep_a"],
        territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()

    p = merge.plan(db)
    skipped = {n: r for n, r in p.skipped}
    assert "تكنو اداره مبيعات" in skipped
    assert "متكرر" in skipped["تكنو اداره مبيعات"]
    assert not any(pair.base_name == "اداره مبيعات" for pair in p.pairs)


def test_a_techno_row_with_no_partner_is_renamed_not_merged(db, inv_world):
    """He exists and sells one line. Leaving «تكنو» in his name keeps a filing convention that has
    stopped meaning anything."""
    from src.models.customer import Customer, CustomerAccount
    from src.services import customer_service

    res = customer_service.create_customer(
        db, name="تكنو وحيد فريد", customer_type="trader", rep_id=inv_world["rep_a"],
        territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()

    merge.apply(db, dry_run=False)
    db.commit()

    c = db.get(Customer, res.customer.id)
    assert c.name == "وحيد فريد"
    assert c.active is True
    acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == c.id))
    assert acc.family == merge.FAMILY_POLY


def test_extra_spaces_do_not_hide_a_pair(db, inv_world):
    """The workbook was typed by hand over years. «احمد  جمعه» is the same man as «احمد جمعه», and
    matching on the raw string would leave the pair unmerged while reporting success."""
    from src.services import customer_service

    customer_service.create_customer(
        db, name="احمد  جمعه", customer_type="trader", rep_id=inv_world["rep_a"],
        territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    customer_service.create_customer(
        db, name="تكنو احمد جمعه", customer_type="trader", rep_id=inv_world["rep_a"],
        territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()

    assert any(p.base_name == "احمد جمعه" for p in merge.plan(db).pairs)


def test_the_api_returns_the_branches_and_the_total(client, db, two_names):
    """What the screen reads: a row per family and the sum under them."""
    merge.apply(db, dry_run=False)
    db.commit()
    keep_id = two_names["made"]["سامي حسن"]["customer"].id

    res = client.get(f"/api/v1/customers/{keep_id}/accounts", headers=two_names["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    families = {a["family"]: Decimal(a["balance"]) for a in body["accounts"]}
    assert families[merge.FAMILY_WHITE] == Decimal("500.00")
    assert families[merge.FAMILY_POLY] == Decimal("1200.00")
    assert Decimal(body["total_balance"]) == Decimal("1700.00")


def test_the_single_account_endpoint_refuses_rather_than_guessing(client, db, two_names):
    """A merged customer has no family-less account. Returning the first of his two would answer a
    different question than the one asked, and the caller would never know."""
    merge.apply(db, dry_run=False)
    db.commit()
    keep_id = two_names["made"]["سامي حسن"]["customer"].id

    res = client.get(f"/api/v1/customers/{keep_id}/account", headers=two_names["h"])
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "multiple_accounts"


def test_an_unmerged_customer_still_answers_the_old_way(client, db, inv_world, login):
    """The endpoint every existing caller uses must keep working for everyone not merged."""
    from src.services import customer_service

    res = customer_service.create_customer(
        db, name="عميل بحساب واحد", customer_type="trader", rep_id=inv_world["rep_a"],
        territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()

    got = client.get(f"/api/v1/customers/{res.customer.id}/account", headers=login("admin"))
    assert got.status_code == 200, got.text
    assert got.json()["family"] is None
