"""حجز عملاء — 031-a5-restructure.

A reservation's whole point is its effect on OTHER screens. Tests that only checked the reservation
list would pass on a feature that holds nothing, so most of these are about the sale and the
transfer refusing what is spoken for.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal


def _customer(client, h, inv_world, name):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _stock(client, h, item_id, wh, qty):
    res = client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "quantity": str(qty),
        "location": {"location_kind": "warehouse", "location_id": wh}})
    assert res.status_code == 201, res.text


def _reserve(client, h, *, customer_id, item_id, wh, qty, days=7):
    return client.post("/api/v1/reservations", headers=h, json={
        "customer_id": customer_id, "item_id": item_id,
        "location": {"location_kind": "warehouse", "location_id": wh},
        "quantity": str(qty), "expires_on": str(date.today() + timedelta(days=days))})


def _sell(client, h, *, customer_id, item_id, wh, qty, price="100"):
    total = str(Decimal(str(qty)) * Decimal(price))
    return client.post("/api/v1/sales", headers=h, json={
        "customer_id": customer_id,
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": total, "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": str(qty), "unit_price": price}]})


def test_a_hold_blocks_another_customer_but_not_its_own(client, inv_world, login):
    """The whole feature in one test: held for A, refused to B, still sellable to A."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج محجوز")
    _stock(client, h, item["id"], wh, 10)
    a = _customer(client, h, inv_world, "عميل الحجز")
    b = _customer(client, h, inv_world, "عميل تاني")

    assert _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=8
                    ).status_code == 201

    # B can have the two that are free, and no more.
    assert _sell(client, h, customer_id=b["id"], item_id=item["id"], wh=wh, qty=3
                 ).status_code == 409
    assert _sell(client, h, customer_id=b["id"], item_id=item["id"], wh=wh, qty=2
                 ).status_code == 201

    # A's own hold must not block A — otherwise it blocks the sale it exists to guarantee.
    assert _sell(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=8
                 ).status_code == 201


def test_the_refusal_says_it_is_a_hold_not_a_shortage(client, inv_world, login):
    """«Out of stock» and «held for someone else» lead to different next actions."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج الرسالة")
    _stock(client, h, item["id"], wh, 5)
    a = _customer(client, h, inv_world, "عميل الرسالة أ")
    b = _customer(client, h, inv_world, "عميل الرسالة ب")
    _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=5)

    res = _sell(client, h, customer_id=b["id"], item_id=item["id"], wh=wh, qty=1)
    assert res.status_code == 409
    assert "محجوزة" in res.json()["detail"]["message"]


def test_an_expired_hold_stops_holding_without_anybody_releasing_it(client, inv_world, login):
    """Expiry is a comparison, not a sweeper — so it is right the moment the day passes."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج ينتهي")
    _stock(client, h, item["id"], wh, 4)
    a = _customer(client, h, inv_world, "عميل ينتهي")
    b = _customer(client, h, inv_world, "عميل بعده")

    # Expiring today still holds today.
    assert _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=4, days=0
                    ).status_code == 201
    assert _sell(client, h, customer_id=b["id"], item_id=item["id"], wh=wh, qty=1
                 ).status_code == 409

    # A hold whose date has already gone is refused at creation rather than stored holding nothing.
    past = client.post("/api/v1/reservations", headers=h, json={
        "customer_id": a["id"], "item_id": item["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "quantity": "1", "expires_on": str(date.today() - timedelta(days=1))})
    assert past.status_code == 409


def test_you_cannot_reserve_what_is_not_there(client, inv_world, login):
    """Two promises over one unit is how the second customer finds out at the door."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج قليل")
    _stock(client, h, item["id"], wh, 3)
    a = _customer(client, h, inv_world, "حاجز أ")
    b = _customer(client, h, inv_world, "حاجز ب")

    assert _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=3
                    ).status_code == 201
    over = _reserve(client, h, customer_id=b["id"], item_id=item["id"], wh=wh, qty=1)
    assert over.status_code == 409


def test_cancelling_releases_the_stock(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج ملغي")
    _stock(client, h, item["id"], wh, 6)
    a = _customer(client, h, inv_world, "ملغي أ")
    b = _customer(client, h, inv_world, "ملغي ب")

    res = _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=6)
    assert _sell(client, h, customer_id=b["id"], item_id=item["id"], wh=wh, qty=1
                 ).status_code == 409

    cancel = client.post(f"/api/v1/reservations/{res.json()['id']}/cancel", headers=h)
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["holding"] is False
    assert _sell(client, h, customer_id=b["id"], item_id=item["id"], wh=wh, qty=1
                 ).status_code == 201


def test_reserved_stock_does_not_leave_on_a_transfer(client, inv_world, login):
    """Sending the goods away breaks the promise as completely as selling them would."""
    h = login("admin")
    src, dest = inv_world["central_wh"], inv_world["branch_wh"]
    item = _product(client, h, "منتج التحويل")
    _stock(client, h, item["id"], src, 10)
    a = _customer(client, h, inv_world, "عميل التحويل")
    _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=src, qty=7)

    too_much = client.post("/api/v1/transfers", headers=h, json={
        "item_id": item["id"], "quantity": "5", "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": src},
        "dest": {"location_kind": "warehouse", "location_id": dest}})
    assert too_much.status_code in (409, 422)
    assert "محجوزة" in str(too_much.json())

    ok = client.post("/api/v1/transfers", headers=h, json={
        "item_id": item["id"], "quantity": "3", "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": src},
        "dest": {"location_kind": "warehouse", "location_id": dest}})
    assert ok.status_code == 201, ok.text


def test_availability_says_how_much_and_why(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج الاستعلام")
    _stock(client, h, item["id"], wh, 9)
    a = _customer(client, h, inv_world, "استعلام أ")
    b = _customer(client, h, inv_world, "استعلام ب")
    _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=4)

    base = f"/api/v1/reservations/availability?item_id={item['id']}&location_kind=warehouse&location_id={wh}"
    for_b = client.get(f"{base}&for_customer_id={b['id']}", headers=h).json()
    assert Decimal(for_b["on_hand"]) == Decimal("9.000")
    assert Decimal(for_b["reserved_for_others"]) == Decimal("4.000")
    assert Decimal(for_b["available"]) == Decimal("5.000")

    # For the holder, their own hold is not «somebody else's».
    for_a = client.get(f"{base}&for_customer_id={a['id']}", headers=h).json()
    assert Decimal(for_a["available"]) == Decimal("9.000")


def test_the_list_marks_which_ones_are_actually_holding(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج القائمة")
    _stock(client, h, item["id"], wh, 5)
    a = _customer(client, h, inv_world, "قائمة أ")
    res = _reserve(client, h, customer_id=a["id"], item_id=item["id"], wh=wh, qty=2)

    rows = client.get("/api/v1/reservations", headers=h).json()
    row = next(r for r in rows if r["id"] == res.json()["id"])
    assert row["holding"] is True
    assert row["customer_name"] == "قائمة أ"
    assert row["item_name"] == "منتج القائمة"
    assert row["location_name"]

    client.post(f"/api/v1/reservations/{res.json()['id']}/cancel", headers=h)
    holding = client.get("/api/v1/reservations?only_holding=true", headers=h).json()
    assert res.json()["id"] not in [r["id"] for r in holding]
