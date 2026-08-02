"""A coupon can only come back from the customer it went out to — 031-a5-restructure.

The return screen asks this before it will accept a coupon. Offering a free serial box and
validating afterwards means finding out at the end of a document that half of it cannot be saved,
with the customer still standing at the counter.
"""
from __future__ import annotations


def _product(client, h, name="منتج الكوبون"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()


def _stock(client, h, item_id, wh, qty):
    assert client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "quantity": str(qty),
        "location": {"location_kind": "warehouse", "location_id": wh}}).status_code == 201


def _customer(client, h, inv_world, name):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _sell_with_coupons(client, h, inv_world, cust, item, *, first, last, count):
    return client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}],
        "coupon_serial_from": first, "coupon_serial_to": last, "coupon_count": count,
    })


def test_the_books_a_customer_holds_are_listed(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h)
    _stock(client, h, item["id"], wh, 10)
    cust = _customer(client, h, inv_world, "عميل الكوبونات")

    sale = _sell_with_coupons(client, h, inv_world, cust, item,
                              first="1200", last="1204", count=5)
    assert sale.status_code == 201, sale.text

    books = client.get(f"/api/v1/coupon-receipts/issued-to/{cust['id']}", headers=h)
    assert books.status_code == 200, books.text
    book = books.json()[0]
    assert book["document_number"] == sale.json()["document_number"]
    assert book["serial_from"] == "1200" and book["serial_to"] == "1204"
    assert book["count"] == 5
    assert book["returned"] == 0
    assert book["remaining"] == 5


def test_another_customer_holds_none_of_it(client, inv_world, login):
    """The whole rule: a coupon belongs to the sale that issued it, not to whoever presents it."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج كوبون ٢")
    _stock(client, h, item["id"], wh, 10)
    mine = _customer(client, h, inv_world, "صاحب الكوبونات")
    other = _customer(client, h, inv_world, "عميل تاني")
    _sell_with_coupons(client, h, inv_world, mine, item, first="2200", last="2202", count=3)

    assert client.get(f"/api/v1/coupon-receipts/issued-to/{other['id']}", headers=h).json() == []


def test_a_serial_names_the_customer_it_was_issued_to(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج كوبون ٣")
    _stock(client, h, item["id"], wh, 10)
    cust = _customer(client, h, inv_world, "عميل السيريال")
    _sell_with_coupons(client, h, inv_world, cust, item, first="3300", last="3309", count=10)

    inside = client.get("/api/v1/coupon-receipts/check?serial=3305", headers=h).json()
    assert inside["status"] == "valid"
    assert inside["customer_id"] == cust["id"]
    assert inside["customer_name"] == "عميل السيريال"

    # One past the end of the book was never issued to anybody.
    outside = client.get("/api/v1/coupon-receipts/check?serial=3310", headers=h).json()
    assert outside["status"] == "unknown"
    assert outside["customer_id"] is None


def test_a_per_kind_book_is_found_too(client, inv_world, login):
    """0049 moved coupons to a row per kind; a check that reads only the old range misses them."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج كوبون ٤")
    _stock(client, h, item["id"], wh, 10)
    cust = _customer(client, h, inv_world, "عميل الأنواع")
    made = client.post("/api/v1/loyalty/coupon-types", headers=h, json={
        "name": "ذهبي", "kind": "money", "point_cost": 100, "value": "50"})
    assert made.status_code == 201, made.text
    gold = made.json()

    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}],
        "coupons": [{"coupon_type_id": gold["id"], "count": 4,
                     "serial_from": "7700", "serial_to": "7703"}],
    })
    assert sale.status_code == 201, sale.text

    books = client.get(f"/api/v1/coupon-receipts/issued-to/{cust['id']}", headers=h).json()
    assert any(b["coupon_type_name"] == "ذهبي" and b["count"] == 4 for b in books), books

    found = client.get("/api/v1/coupon-receipts/check?serial=7702", headers=h).json()
    assert found["status"] == "valid", "a per-kind book must be findable, not just the old range"
    assert found["customer_id"] == cust["id"]
