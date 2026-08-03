"""خصم العميل بيلغي خصم الصنف — 031-a5-restructure.

An item can carry a fixed discount: sell this, and 10% comes off. Some customers are on a
different rate — a dealer agreed at 20%. Asked which wins, the answer is the customer: «خصمه» is
the rate agreed with HIM, not a bonus added on top of whatever the item already gave. A dealer on
20% against an item on 10% is on twenty, not twenty-eight.

`customer.discount_pct` had existed as a column since the customer form was rebuilt and **nothing
read it**. Every sale took the item's rate, and a rate typed on the customer's card changed
nothing at all — silently, because a discount that quietly fails to apply looks exactly like a
discount that was never agreed.

Empty and zero are different answers and both are tested: NULL means «nothing agreed with him» and
the item's rate applies; 0 means «agreed, and it is nothing» and the item's rate is cancelled.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def shop(client, inv_world, login):
    """An item discounted 10% by default, and a warehouse holding a hundred of them at 10 each."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الخصم", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "default_discount_pct": "10"}).json()
    assert "id" in item, item
    client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "100", "unit_cost": "6"}]})
    return {"h": h, "wh": wh, "item": item, "inv_world": inv_world}


def _customer(client, h, inv_world, name, **extra):
    res = client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"], **extra})
    assert res.status_code in (200, 201), res.text
    return res.json()


def _sell(client, shop, customer_id, payable, line=None):
    """Sell ten at ten without naming a line discount, so the line takes what the rules decide.

    `payable` is what the invoice must come to. The service refuses a sale whose cash + credit does
    not equal the total, so stating the expected figure makes the MONEY part of the assertion: get
    the discount rule wrong and the sale is rejected outright rather than quietly posting a
    different number.
    """
    body_line = {"item_id": shop["item"]["id"], "quantity": "10", "unit_price": "10"}
    if line:
        body_line.update(line)
    return client.post("/api/v1/sales", headers=shop["h"], json={
        "customer_id": customer_id,
        "origin": {"location_kind": "warehouse", "location_id": shop["wh"]},
        "lines": [body_line],
        "cash_amount": payable, "credit_amount": "0"})


def _line_discount(client, h, invoice_id):
    detail = client.get(f"/api/v1/sales/{invoice_id}", headers=h)
    assert detail.status_code == 200, detail.text
    return Decimal(str(detail.json()["lines"][0]["discount_pct"]))


def test_a_customer_with_no_rate_takes_the_item_rate(client, shop):
    """NULL on the customer is «nothing agreed with him» — the item's 10% applies."""
    cust = _customer(client, shop["h"], shop["inv_world"], "عميل بلا اتفاق")
    res = _sell(client, shop, cust["id"], "90")   # 100 less the item's 10%
    assert res.status_code == 201, res.text
    assert _line_discount(client, shop["h"], res.json()["id"]) == Decimal("10")


def test_the_customer_rate_replaces_the_item_rate(client, shop):
    """20% agreed with him beats the item's 10% — and does NOT stack into 28%."""
    cust = _customer(client, shop["h"], shop["inv_world"], "تاجر ٢٠٪", discount_pct="20")
    # 80, not 72: stacking his 20% onto the item's 10% would have made it 72.
    res = _sell(client, shop, cust["id"], "80")
    assert res.status_code == 201, res.text
    assert _line_discount(client, shop["h"], res.json()["id"]) == Decimal("20")

    # 10 pieces at 10 with 20% off is 80. Stacking would have produced 72.
    total = Decimal(str(client.get(f"/api/v1/sales/{res.json()['id']}",
                                   headers=shop["h"]).json()["lines"][0]["line_total"]))
    assert total == Decimal("80.00")


def test_a_customer_rate_of_zero_cancels_the_item_rate(client, shop):
    """0 is «agreed, and it is nothing» — a different answer from «nothing agreed»."""
    cust = _customer(client, shop["h"], shop["inv_world"], "عميل بلا خصم", discount_pct="0")
    res = _sell(client, shop, cust["id"], "100")   # nothing comes off at all
    assert res.status_code == 201, res.text
    assert _line_discount(client, shop["h"], res.json()["id"]) == Decimal("0")


def test_a_discount_typed_on_the_line_beats_both(client, shop):
    """A one-off agreed at the counter is the most specific answer there is."""
    cust = _customer(client, shop["h"], shop["inv_world"], "عميل السطر", discount_pct="20")
    res = _sell(client, shop, cust["id"], "65", line={"discount_pct": "35"})
    assert res.status_code == 201, res.text
    assert _line_discount(client, shop["h"], res.json()["id"]) == Decimal("35")
