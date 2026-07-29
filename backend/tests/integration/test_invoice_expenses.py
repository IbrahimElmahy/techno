"""مصروفات الفاتورة — على العميل أو على الشركة.

Two kinds, and the difference is the whole reason this is not one field. A **billed** expense is
freight the customer pays for: it adds to what he owes. An **operating** expense is one we bear on
this sale: it does not change his side of the document at all, it reduces the profit.

Folding them together would make either the customer's balance or the profit wrong — and which one
was wrong would depend on who typed the invoice.
"""
from decimal import Decimal

import pytest


@pytest.fixture()
def ready(client, chart, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف المصروف", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=admin, json={"name": "مورد"}).json()
    client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "600", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "60"}]})
    customer = client.post("/api/v1/customers", headers=admin, json={
        "name": "عميل المصروف", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    return {"admin": admin, "wh": wh, "item_id": item["id"],
            "customer_id": customer["id"], "expense_account": chart["rent"],
            "treasury": chart["treasury"]}


def _sell(client, ready, cash, credit, expenses=None):
    return client.post("/api/v1/sales", headers=ready["admin"], json={
        "customer_id": ready["customer_id"],
        "origin": {"location_kind": "warehouse", "location_id": ready["wh"]},
        "variable_discount_pct": "0", "cash_amount": str(cash), "credit_amount": str(credit),
        "lines": [{"item_id": ready["item_id"], "quantity": "1", "discount_pct": "0"}],
        "expenses": expenses or []})


def _balance(client, h, account_id):
    s = client.get(f"/api/v1/accounts/{account_id}/statement", headers=h).json()
    return Decimal(s["closing_balance"])


def test_a_billed_expense_adds_to_what_the_customer_owes(client, ready):
    """Freight he pays for is part of the invoice — so cash+credit has to cover it."""
    resp = _sell(client, ready, cash=0, credit=125, expenses=[
        {"account_id": ready["expense_account"], "amount": "25", "kind": "billed",
         "description": "نولون"}])
    assert resp.status_code == 201, resp.text
    invoice = resp.json()
    assert Decimal(invoice["net"]) == Decimal("100.00")          # the goods
    assert Decimal(invoice["expenses_billed"]) == Decimal("25.00")
    # He owes the goods plus the freight.
    assert Decimal(invoice["credit_amount"]) == Decimal("125.00")


def test_paying_only_the_goods_is_refused_when_an_expense_is_billed(client, ready):
    """The check that keeps the document honest: the money has to add up to the whole document."""
    resp = _sell(client, ready, cash=0, credit=100, expenses=[
        {"account_id": ready["expense_account"], "amount": "25", "kind": "billed"}])
    assert resp.status_code in (409, 422)


def test_an_operating_expense_does_not_touch_the_customer(client, ready):
    """We bear it, so his balance is exactly the goods — and the till pays it out."""
    # Measured as a DELTA: the fixture already bought stock with cash, so the till does not
    # start at zero and an absolute figure would be asserting the fixture, not the feature.
    before = _balance(client, ready["admin"], ready["treasury"])

    resp = _sell(client, ready, cash=100, credit=0, expenses=[
        {"account_id": ready["expense_account"], "amount": "30", "kind": "operating",
         "description": "تحميل"}])
    assert resp.status_code == 201, resp.text
    invoice = resp.json()
    assert Decimal(invoice["expenses_operating"]) == Decimal("30.00")
    assert Decimal(invoice["cash_amount"]) == Decimal("100.00")

    # The till took 100 in and paid 30 out for the expense: 70 net.
    after = _balance(client, ready["admin"], ready["treasury"])
    assert after - before == Decimal("70.00")
    assert _balance(client, ready["admin"], ready["expense_account"]) == Decimal("30.00")


def test_an_expense_cannot_post_to_a_group_account(client, ready, chart):
    """A group heading balances the entry and is unreadable in every report built on the chart."""
    group = chart["groups"]["5"]  # التكلفة والمصروفات — a heading, not a leaf
    resp = _sell(client, ready, cash=100, credit=0, expenses=[
        {"account_id": group, "amount": "10", "kind": "operating"}])
    assert resp.status_code in (409, 422)


def test_an_invoice_without_expenses_is_unchanged(client, ready):
    resp = _sell(client, ready, cash=100, credit=0)
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["expenses_billed"]) == Decimal("0.00")
    assert Decimal(resp.json()["expenses_operating"]) == Decimal("0.00")
