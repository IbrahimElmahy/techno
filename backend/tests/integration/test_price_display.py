"""شاشة معلومات المنتج — 031-a5-restructure.

The one thing this screen must not do is disagree with the invoice. A customer who has read a
figure off the counter display has to be argued out of it, which is worse than never showing one.

It resolves the ITEM CODE, not a barcode — barcodes are out of this system at the client's request,
so this is a deliberate divergence from their `/price-display-screen` rather than a gap.
"""
from __future__ import annotations

from decimal import Decimal


def _item(client, h, name, price="100", **kw):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": price, **kw}).json()


def _tier(client, h, item_id, tier, price):
    res = client.put(f"/api/v1/items/{item_id}/prices", headers=h, json={
        "tiers": [{"tier": tier, "price": str(price)}]})
    assert res.status_code in (200, 201), res.text


def _look(client, h, code):
    return client.get(f"/api/v1/price-display/lookup?code={code}", headers=h)


def test_a_code_answers_with_the_consumer_price(client, world, login):
    """المستهلك — a walk-in is not on a trade tier."""
    h = login("admin")
    item = _item(client, h, "صنف الشاشة", "80")
    _tier(client, h, item["id"], "consumer", "120")
    _tier(client, h, item["id"], "wholesale", "70")

    res = _look(client, h, item["code"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["name"] == "صنف الشاشة"
    assert Decimal(body["unit_price"]) == Decimal("120.00"), "the consumer tier, not wholesale"


def test_the_displayed_price_equals_what_the_invoice_bills(client, inv_world, login):
    """The whole point. Same item, same unit — the screen and the line must agree."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _item(client, h, "صنف المطابقة", "100", default_discount_pct="10")
    _tier(client, h, item["id"], "consumer", "200")

    shown = _look(client, h, item["code"]).json()
    assert Decimal(shown["unit_price"]) == Decimal("200.00")
    assert Decimal(shown["discount_pct"]) == Decimal("10")
    assert Decimal(shown["price_after_discount"]) == Decimal("180.00")

    # Now bill one of them and compare against the line the system actually produced.
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item["id"], "quantity": "5",
        "location": {"location_kind": "warehouse", "location_id": wh}})
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل الشاشة", "customer_type": "consumer", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": str(shown["price_with_vat"]), "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1"}]})
    assert sale.status_code == 201, sale.text
    # The sale accepting exactly the displayed figure as payment IS the agreement being asserted:
    # cash must equal the payable, so a mismatch would have been a 422 above.


def test_it_answers_the_second_question_too(client, inv_world, login):
    """«Do you have it?» comes right after «how much?», so it does not need a second scan."""
    h = login("admin")
    item = _item(client, h, "صنف الرصيد", "50")
    _tier(client, h, item["id"], "consumer", "50")

    empty = _look(client, h, item["code"]).json()
    assert empty["in_stock"] is False
    assert Decimal(empty["on_hand"]) == Decimal("0.000")

    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item["id"], "quantity": "7",
        "location": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]}})
    full = _look(client, h, item["code"]).json()
    assert full["in_stock"] is True
    assert Decimal(full["on_hand"]) == Decimal("7.000")


def test_unknown_and_inactive_codes_say_so(client, world, login):
    h = login("admin")
    assert _look(client, h, "NOT-A-CODE").status_code == 404

    item = _item(client, h, "صنف موقوف", "20")
    _tier(client, h, item["id"], "consumer", "20")
    client.patch(f"/api/v1/items/{item['id']}", headers=h, json={"active": False})

    dead = _look(client, h, item["code"])
    assert dead.status_code == 404, "a discontinued item must not be quoted at a counter"
