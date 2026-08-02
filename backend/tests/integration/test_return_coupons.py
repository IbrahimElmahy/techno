"""الكوبونات الراجعة مع المرتجع — 031-a5-restructure.

A customer can only bring back what he was handed. The return takes the coupons in through the same
receipt path the استلام الكوبونات screen uses, so «unknown», «already received» and «not this
customer's» are one set of rules with one place deciding them.
"""
from __future__ import annotations

from decimal import Decimal


def _product(client, h, name):
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


def _sell(client, h, wh, cust, item, *, first, last, count):
    res = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}],
        "coupon_serial_from": first, "coupon_serial_to": last, "coupon_count": count})
    assert res.status_code == 201, res.text
    return res.json()


def _return(client, h, wh, cust, item, coupons):
    return client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "0", "credit_reduction": "100",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}],
        "returned_coupons": coupons})


def test_his_own_coupons_come_back_with_the_goods(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج كوبون راجع")
    _stock(client, h, item["id"], wh, 10)
    cust = _customer(client, h, inv_world, "عميل الكوبون الراجع")
    _sell(client, h, wh, cust, item, first="5100", last="5104", count=5)

    res = _return(client, h, wh, cust, item, [{"serial_from": "5100", "serial_to": "5102"}])
    assert res.status_code == 201, res.text

    # The book now shows three of five back, so the screen offers the remainder next time.
    book = client.get(f"/api/v1/coupon-receipts/issued-to/{cust['id']}", headers=h).json()[0]
    assert book["returned"] == 3
    assert book["remaining"] == 2


def test_another_customers_coupon_is_refused_and_takes_the_return_with_it(
        client, inv_world, login):
    """The goods and the coupons are one act at the counter.

    Accepting the goods while rejecting the coupons would leave the customer holding paper nobody
    will now take — and the return already posted, so there is no obvious way back.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج كوبون الغلط")
    _stock(client, h, item["id"], wh, 10)
    owner = _customer(client, h, inv_world, "صاحب الدفتر")
    other = _customer(client, h, inv_world, "عميل مالوش دفتر")
    _sell(client, h, wh, owner, item, first="6100", last="6103", count=4)

    before = client.get("/api/v1/sales/returns", headers=h).json()
    res = _return(client, h, wh, other, item, [{"serial_from": "6100", "serial_to": "6101"}])
    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "coupon_invalid"

    after = client.get("/api/v1/sales/returns", headers=h).json()
    assert len(after) == len(before), "the return must not survive its coupons being refused"


def test_a_coupon_cannot_come_back_twice(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج كوبون مكرر")
    _stock(client, h, item["id"], wh, 10)
    cust = _customer(client, h, inv_world, "عميل التكرار")
    _sell(client, h, wh, cust, item, first="7100", last="7102", count=3)

    assert _return(client, h, wh, cust, item,
                   [{"serial_from": "7100", "serial_to": "7100"}]).status_code == 201
    again = _return(client, h, wh, cust, item, [{"serial_from": "7100", "serial_to": "7100"}])
    assert again.status_code == 422
    assert "اتستلمت قبل كده" in again.json()["detail"]["message"]


def test_a_return_with_no_coupons_is_unaffected(client, inv_world, login):
    """Most returns carry none, and the field must stay optional."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج بلا كوبون")
    _stock(client, h, item["id"], wh, 10)
    cust = _customer(client, h, inv_world, "عميل بلا كوبون")

    res = _return(client, h, wh, cust, item, [])
    assert res.status_code == 201, res.text
    rows = client.get("/api/v1/sales/returns", headers=h).json()
    row = next(r for r in rows if r["id"] == res.json()["id"])
    assert Decimal(row["net"]) == Decimal("100.00")
