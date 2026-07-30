"""كوبونات الفاتورة لكل نوع.

The invoice used to carry one serial range and one count, which said THAT coupons were handed over
and never WHICH. A counter giving out a hundred gold and fifty silver had one pair of boxes between
them and had to choose which of the two to write down.

One row per kind instead. The serial range stays on each row — it is what the returns app checks a
returned serial against — and the kind is what lets the books say what was given.
"""


def _coupon_type(client, h, name: str, cost: int, value: str) -> dict:
    return client.post("/api/v1/loyalty/coupon-types", headers=h, json={
        "name": name, "kind": "money", "point_cost": cost, "value": value}).json()


def _sale(client, h, world, coupons):
    return client.post("/api/v1/sales", headers=h, json={
        "customer_id": world["cust"], "origin": {"location_kind": "warehouse",
                                                 "location_id": world["wh"]},
        # One unit at ten, paid in cash — the sale itself is beside the point here, it just has
        # to be a real posted document for the coupons to hang off.
        "cash_amount": "10", "credit_amount": "0",
        "lines": [{"item_id": world["item"], "quantity": "1", "unit_price": "10"}],
        "coupons": coupons,
    })


def _world(client, h, base):
    """A customer, a warehouse with one item in it — the least a sale needs."""
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل الكوبونات", "customer_type": "trader",
        "rep_id": base["rep_a"], "territory_id": base["terr_a"]}).json()
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الكوبونات", "kind": "product", "unit_of_measure": "قطعة",
        "sale_price": "10"}).json()
    wh = client.post("/api/v1/warehouses", headers=h, json={
        "name": "مخزن الكوبونات", "warehouse_type": "branch",
        "branch_id": base["branch_a"]}).json()
    # Produced straight into the warehouse — the shortest way to real sellable stock.
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item["id"],
        "location": {"location_kind": "warehouse", "location_id": wh["id"]},
        "quantity": "50"})
    return {"cust": cust["id"], "item": item["id"], "wh": wh["id"]}


def test_two_kinds_on_one_invoice(client, world, login):
    h = login("admin")
    w = _world(client, h, world)
    gold = _coupon_type(client, h, "ذهبي", 100, "50")
    silver = _coupon_type(client, h, "فضي", 50, "20")

    resp = _sale(client, h, w, [
        {"coupon_type_id": gold["id"], "count": 100,
         "serial_from": "1000", "serial_to": "1099"},
        {"coupon_type_id": silver["id"], "count": 50,
         "serial_from": "2000", "serial_to": "2049"},
    ])
    assert resp.status_code == 201, resp.text

    got = {c["coupon_type_name"]: c for c in resp.json()["coupons"]}
    assert got["ذهبي"]["count"] == 100
    assert got["ذهبي"]["serial_from"] == "1000"
    assert got["فضي"]["count"] == 50
    assert got["فضي"]["serial_to"] == "2049"


def test_a_book_with_no_kind_is_still_recorded(client, world, login):
    """A book with no type printed on it is still a book.

    Refusing it would push the count back out of the system and into somebody's memory, which is
    the thing this feature exists to stop.
    """
    h = login("admin")
    w = _world(client, h, world)

    resp = _sale(client, h, w, [{"count": 20, "serial_from": "500", "serial_to": "519"}])
    assert resp.status_code == 201, resp.text
    row = resp.json()["coupons"][0]
    assert row["coupon_type_id"] is None
    assert row["coupon_type_name"] is None
    assert row["count"] == 20


def test_an_empty_row_is_dropped(client, world, login):
    """A row somebody started and left is not a hand-over of nothing."""
    h = login("admin")
    w = _world(client, h, world)

    resp = _sale(client, h, w, [{}, {"count": 5}])
    assert resp.status_code == 201, resp.text
    assert len(resp.json()["coupons"]) == 1
    assert resp.json()["coupons"][0]["count"] == 5


def test_the_coupons_come_back_when_the_invoice_is_reopened(client, world, login):
    """The printed invoice reads them off the document, so they have to survive a read."""
    h = login("admin")
    w = _world(client, h, world)
    gold = _coupon_type(client, h, "ذهبي ٢", 100, "50")

    inv = _sale(client, h, w, [{"coupon_type_id": gold["id"], "count": 7}]).json()

    detail = client.get(f"/api/v1/sales/{inv['id']}", headers=h).json()
    assert [c["count"] for c in detail["coupons"]] == [7]
    assert detail["coupons"][0]["coupon_type_name"] == "ذهبي ٢"


def test_no_coupons_is_an_ordinary_invoice(client, world, login):
    h = login("admin")
    w = _world(client, h, world)
    resp = _sale(client, h, w, [])
    assert resp.status_code == 201, resp.text
    assert resp.json()["coupons"] == []
