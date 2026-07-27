"""Advisory min/max limits and the reorder report — 011 (US1).

The point of these limits is planning, not control: they tell a manager what to buy and what is
overstocked. They must never stand between a salesman and a sale — only No-Negative-Stock
(Principle XI) does that.
"""
from decimal import Decimal


def _product(client, h, name, **extra):
    body = {"name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}
    body.update(extra)
    return client.post("/api/v1/items", headers=h, json=body).json()


def _seed(client, h, item_id, wh, qty):
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": "warehouse", "location_id": wh},
        "quantity": qty})


def _customer(client, h, inv_world):
    return client.post("/api/v1/customers", headers=h, json={
        "name": "C", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _reorder(client, h):
    return client.get("/api/v1/reports/reorder", headers=h).json()["rows"]


def test_limits_are_stored_and_returned_on_the_item(client, world, login):
    admin = login("admin")
    item = _product(client, admin, "Limited", min_stock="10", max_stock="100")
    assert Decimal(item["min_stock"]) == Decimal("10.000")
    assert Decimal(item["max_stock"]) == Decimal("100.000")

    fetched = client.get(f"/api/v1/items/{item['id']}", headers=admin).json()
    assert Decimal(fetched["min_stock"]) == Decimal("10.000")


def test_reorder_report_flags_below_min_and_above_max_only(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    low = _product(client, admin, "TooLow", min_stock="10", max_stock="100")
    high = _product(client, admin, "TooHigh", min_stock="1", max_stock="5")
    ok = _product(client, admin, "JustRight", min_stock="1", max_stock="100")
    unlimited = _product(client, admin, "NoLimits")

    _seed(client, admin, low["id"], wh, "5")        # below its min of 10
    _seed(client, admin, high["id"], wh, "20")      # above its max of 5
    _seed(client, admin, ok["id"], wh, "50")        # comfortably within range
    _seed(client, admin, unlimited["id"], wh, "999")  # no limits set at all

    rows = {r["item_id"]: r for r in _reorder(client, admin)}
    assert rows[low["id"]]["flag"] == "below_min"
    assert Decimal(rows[low["id"]]["on_hand"]) == Decimal("5.000")
    assert rows[high["id"]]["flag"] == "above_max"
    # In range, or no limits at all — neither is a planning problem, so neither is listed.
    assert ok["id"] not in rows
    assert unlimited["id"] not in rows


def test_limits_never_block_a_sale(client, inv_world, login):
    """A limit is advice. Selling below the minimum is allowed; only running out is not."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Advisory", min_stock="100", max_stock="200")
    _seed(client, admin, item["id"], wh, "10")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "800", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "8", "discount_pct": "0"}]})
    assert resp.status_code == 201, "a min-stock limit must not block a sale"

    # It now shows up as needing a reorder — which is the whole point.
    rows = {r["item_id"]: r for r in _reorder(client, admin)}
    assert rows[item["id"]]["flag"] == "below_min"


def test_limits_can_be_updated_on_an_existing_item(client, world, login):
    admin = login("admin")
    item = _product(client, admin, "Adjustable")
    assert item["min_stock"] is None

    client.patch(f"/api/v1/items/{item['id']}", headers=admin,
                 json={"min_stock": "25", "max_stock": "75", "is_perishable": True})
    fetched = client.get(f"/api/v1/items/{item['id']}", headers=admin).json()
    assert Decimal(fetched["min_stock"]) == Decimal("25.000")
    assert Decimal(fetched["max_stock"]) == Decimal("75.000")
    assert fetched["is_perishable"] is True
