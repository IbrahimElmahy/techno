"""سند القبض بيقول هو على أنهي مديونية — 031-a5-restructure.

A customer may owe on more than one product line. A receipt therefore has to say which debt it
settles: «أبيض», «بولي», or the whole thing.

The third one is the interesting case. A ledger has no «total» to credit, so a receipt against the
whole debt is **split across the lines in the proportion each one owes** — the same apportioning
rule the system already uses for the tax on a partial return and the cash/credit split on a refund.
One rule the whole system follows beats three that each look reasonable on their own.

And `voucher_service._customer_account` had the same defect the sale did: it took whichever row came
back first, which for a merged customer is an arbitrary one of the two. A collection credited to
«أبيض» that was paid against «بولي» is money the next statement cannot explain.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from src.services import customer_merge_service as merge
from src.services.voucher_service import VoucherError


@pytest.fixture()
def owing(client, inv_world, login, db):
    """One customer owing 300 on أبيض and 700 on بولي — a 30/70 split."""
    from src.models.customer import CustomerAccount, Customer
    from src.models.ledger import Direction
    from src.services import account_resolver, customer_service, ledger_service
    from src.services.ledger_service import LineInput

    for name, amount in (("مجدي راشد", 300), ("تكنو مجدي راشد", 700)):
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
    db.commit()
    merge.apply(db, dry_run=False)
    db.commit()

    keep = db.scalar(select(Customer).where(
        Customer.name == "مجدي راشد", Customer.active.is_(True)))
    accounts = {a.family: a.account_id for a in db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == keep.id)).all()}
    return {"h": login("admin"), "customer": keep, "accounts": accounts}


def _bal(db, account_id):
    from src.services import chart_service
    return chart_service.account_balance(db, account_id)


def _receipt(client, o, **extra):
    return client.post("/api/v1/vouchers/receipts", headers=o["h"],
                       json={"customer_id": o["customer"].id, "amount": "100", **extra})


def test_a_receipt_on_one_line_settles_only_that_line(client, db, owing):
    res = _receipt(client, owing, family=merge.FAMILY_POLY)
    assert res.status_code in (200, 201), res.text
    assert _bal(db, owing["accounts"][merge.FAMILY_POLY]) == Decimal("600.00")
    assert _bal(db, owing["accounts"][merge.FAMILY_WHITE]) == Decimal("300.00"), "untouched"


def test_a_receipt_on_the_total_is_split_in_proportion(client, db, owing):
    """300 and 700 of a 1000 debt: a 100 collection goes 30 and 70."""
    res = _receipt(client, owing, on_total=True)
    assert res.status_code in (200, 201), res.text
    assert _bal(db, owing["accounts"][merge.FAMILY_WHITE]) == Decimal("270.00")
    assert _bal(db, owing["accounts"][merge.FAMILY_POLY]) == Decimal("630.00")


def test_the_split_adds_back_to_the_amount_exactly(client, db, owing):
    """Rounding is settled on the last line. A split that loses a piastre posts an unbalanced
    entry, and the ledger refuses it — so this is the difference between working and not."""
    before = sum(_bal(db, a) for a in owing["accounts"].values())
    res = client.post("/api/v1/vouchers/receipts", headers=owing["h"],
                      json={"customer_id": owing["customer"].id, "amount": "33.33",
                            "on_total": True})
    assert res.status_code in (200, 201), res.text
    after = sum(_bal(db, a) for a in owing["accounts"].values())
    assert before - after == Decimal("33.33")


def test_naming_neither_is_refused_rather_than_guessed(client, owing):
    """The defect this replaces: whichever account came back first got the money."""
    res = _receipt(client, owing)
    assert res.status_code in (409, 422), res.text
    assert "حساب" in res.text or "النوع" in res.text


def test_a_family_he_does_not_have_is_refused(client, owing):
    res = _receipt(client, owing, family="خط تالت")
    assert res.status_code in (409, 422), res.text


def test_a_customer_with_one_account_needs_no_choice(client, db, inv_world, login):
    """Everyone who was never split — which is most customers — is unaffected."""
    from src.models.customer import CustomerAccount
    from src.services import customer_service

    res = customer_service.create_customer(
        db, name="عميل بمديونية واحدة", customer_type="trader", rep_id=inv_world["rep_a"],
        territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()

    got = client.post("/api/v1/vouchers/receipts", headers=login("admin"),
                      json={"customer_id": res.customer.id, "amount": "50"})
    assert got.status_code in (200, 201), got.text
    acc = db.scalar(select(CustomerAccount).where(
        CustomerAccount.customer_id == res.customer.id))
    assert _bal(db, acc.account_id) == Decimal("-50.00")


def test_an_advance_on_a_clear_account_is_refused_not_apportioned(db, inv_world):
    """«على الإجمالي» has no proportion to follow when nothing is owed. Inventing one — equal
    shares, or all on the first line — would put an advance somewhere nobody chose."""
    from src.models.customer import Customer, CustomerAccount
    from src.services import customer_service, voucher_service

    for name in ("هاني صادق", "تكنو هاني صادق"):
        customer_service.create_customer(
            db, name=name, customer_type="trader", rep_id=inv_world["rep_a"],
            territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()
    merge.apply(db, dry_run=False)
    db.commit()
    keep = db.scalar(select(Customer).where(
        Customer.name == "هاني صادق", Customer.active.is_(True)))

    with pytest.raises(VoucherError, match="مديونية"):
        voucher_service.create_receipt(
            db, customer_id=keep.id, amount=Decimal("100"),
            actor_user_id=inv_world["admin"],
            actor_role=__import__("src.models.role", fromlist=["RoleName"]).RoleName.system_admin,
            on_total=True)


def test_the_voucher_records_which_debt_it_settled(client, db, owing):
    """A statement has to be able to say what the collection was for."""
    from src.models.voucher import Voucher

    res = _receipt(client, owing, family=merge.FAMILY_WHITE)
    assert res.status_code in (200, 201), res.text
    v = db.get(Voucher, res.json()["id"])
    assert v.family == merge.FAMILY_WHITE


def test_the_api_returns_which_debt_it_settled(client, owing):
    """Stored AND returned. A field that goes in and never comes back is a field the printed
    receipt cannot carry, and the sheet the customer signs is where it matters most."""
    res = _receipt(client, owing, family=merge.FAMILY_POLY)
    assert res.status_code in (200, 201), res.text
    assert res.json()["family"] == merge.FAMILY_POLY


def test_a_receipt_on_the_total_reports_no_single_family(client, owing):
    """Null is the honest answer for «على الإجمالي» — it was not one line's debt."""
    res = _receipt(client, owing, on_total=True)
    assert res.status_code in (200, 201), res.text
    assert res.json()["family"] is None
