"""الفاتورة بتترحّل على حساب النوع اللي اتحدد — 031-a5-restructure.

Once a customer holds one receivable account per product line, «which account does this invoice
post to?» has a real answer and the code has to ask for it. It did not: three places in
`sales_service` looked the account up with an unscoped
`select(CustomerAccount).where(customer_id == X)` and took whatever came back first.

For every customer who was never split that is correct — he has one. For a merged customer it
returns **an arbitrary one of the two**, so a sale could land on «أبيض» when it belonged to «بولي»,
silently, and possibly differently between two runs.

The rule now lives in one place, and its most important branch is the one that REFUSES.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from src.services import customer_merge_service as merge


@pytest.fixture()
def split_customer(client, inv_world, login, db):
    """One customer holding both an أبيض and a بولي account, and something to sell him."""
    from src.models.customer import CustomerAccount
    from src.services import customer_service

    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف النوع", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "100", "unit_cost": "6"}]})

    for name in ("طارق فؤاد", "تكنو طارق فؤاد"):
        customer_service.create_customer(
            db, name=name, customer_type="trader", rep_id=inv_world["rep_a"],
            territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()
    merge.apply(db, dry_run=False)
    db.commit()

    from src.models.customer import Customer
    keep = db.scalar(select(Customer).where(
        Customer.name == "طارق فؤاد", Customer.active.is_(True)))
    accounts = {a.family: a.account_id for a in db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == keep.id)).all()}
    return {"h": h, "wh": wh, "item": item, "customer": keep, "accounts": accounts}


def _sell(client, s, family=None):
    body = {
        "customer_id": s["customer"].id,
        "origin": {"location_kind": "warehouse", "location_id": s["wh"]},
        "lines": [{"item_id": s["item"]["id"], "quantity": "3", "unit_price": "10"}],
        "cash_amount": "0", "credit_amount": "30",
    }
    if family is not None:
        body["family"] = family
    return client.post("/api/v1/sales", headers=s["h"], json=body)


def _balance(db, account_id):
    from src.services import chart_service
    return chart_service.account_balance(db, account_id)


def test_the_invoice_posts_to_the_family_it_names(client, db, split_customer):
    res = _sell(client, split_customer, merge.FAMILY_POLY)
    assert res.status_code == 201, res.text

    poly = split_customer["accounts"][merge.FAMILY_POLY]
    white = split_customer["accounts"][merge.FAMILY_WHITE]
    assert _balance(db, poly) == Decimal("30.00")
    assert _balance(db, white) == Decimal("0.00"), "the other line must not move"


def test_the_other_family_posts_to_the_other_account(client, db, split_customer):
    res = _sell(client, split_customer, merge.FAMILY_WHITE)
    assert res.status_code == 201, res.text
    assert _balance(db, split_customer["accounts"][merge.FAMILY_WHITE]) == Decimal("30.00")
    assert _balance(db, split_customer["accounts"][merge.FAMILY_POLY]) == Decimal("0.00")


def test_a_split_customer_with_no_family_named_is_refused(client, split_customer):
    """The branch that matters. Guessing would put a sale on «أبيض» that belonged to «بولي» with
    no trace of the decision anywhere."""
    res = _sell(client, split_customer, None)
    assert res.status_code in (409, 422), res.text
    assert "النوع" in res.text or "حساب" in res.text


def test_a_family_the_customer_does_not_have_is_refused(client, split_customer):
    res = _sell(client, split_customer, "خط تالت")
    assert res.status_code in (409, 422), res.text


def test_an_unsplit_customer_still_needs_no_family(client, db, inv_world, login):
    """Every customer who was never merged holds exactly one account, and naming a line for him
    would be asking a question that has no meaning yet."""
    from src.models.customer import CustomerAccount
    from src.services import customer_service

    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف بسيط", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "20", "unit_cost": "6"}]})
    res = customer_service.create_customer(
        db, name="عميل بحساب واحد", customer_type="trader", rep_id=inv_world["rep_a"],
        territory_id=inv_world["terr_a"], phone=None, actor_user_id=inv_world["admin"])
    db.commit()

    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": res.customer.id,
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "10"}],
        "cash_amount": "0", "credit_amount": "20"})
    assert sale.status_code == 201, sale.text

    acc = db.scalar(select(CustomerAccount).where(
        CustomerAccount.customer_id == res.customer.id))
    assert _balance(db, acc.account_id) == Decimal("20.00")


def test_the_return_goes_back_to_the_account_the_sale_used(client, db, split_customer):
    """Read off the document, not resolved again — otherwise a refund lands on whichever line the
    customer happens to be split into by the time it is taken."""
    sale = _sell(client, split_customer, merge.FAMILY_POLY)
    assert sale.status_code == 201, sale.text
    poly = split_customer["accounts"][merge.FAMILY_POLY]
    white = split_customer["accounts"][merge.FAMILY_WHITE]

    res = client.post(f"/api/v1/sales/{sale.json()['id']}/reverse",
                      headers=split_customer["h"], json={"reason": "delete"})
    assert res.status_code == 201, res.text

    assert _balance(db, poly) == Decimal("0.00"), "the line it came off must be cleared"
    assert _balance(db, white) == Decimal("0.00"), "and the other must never have moved"
