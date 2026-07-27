"""Transfers move only what the source actually holds, and nothing in the system may go negative.

The no-negative rule lives in `stock_service.post_movement`, so every path obeys it. These tests
pin the two user-visible promises: a transfer request for more than is available is refused up
front (not at approval time), and a sale can never exceed the on-hand quantity.
"""
from decimal import Decimal


def _seed(client, h, item_id, kind, loc, qty):
    return client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": kind, "location_id": loc},
        "quantity": qty})


def _product(client, h, name="Widget", price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _by_location(client, h, kind, loc, only_available=True):
    return client.get("/api/v1/stock/by-location", headers=h, params={
        "location_kind": kind, "location_id": loc, "only_available": only_available}).json()


def test_by_location_lists_only_what_is_there(client, inv_world, login):
    admin = login("admin")
    stocked = _product(client, admin, "Stocked")
    never = _product(client, admin, "NeverStocked")
    _seed(client, admin, stocked["id"], "warehouse", inv_world["central_wh"], "7")

    rows = _by_location(client, admin, "warehouse", inv_world["central_wh"])
    by_id = {r["item_id"]: r for r in rows}
    assert Decimal(by_id[stocked["id"]]["on_hand"]) == Decimal("7.000")
    assert never["id"] not in by_id          # never moved here → not offered at all
    # The row carries what a picker needs to show the item without a second call.
    assert by_id[stocked["id"]]["name"] == "Stocked"


def test_by_location_hides_items_drained_to_zero(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin, "Drained")
    _seed(client, admin, prod["id"], "warehouse", inv_world["central_wh"], "5")
    # Move all 5 out to the branch warehouse.
    t = client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "5", "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "dest": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]}}).json()
    assert client.post(f"/api/v1/transfers/{t['id']}/approve", headers=admin).status_code == 200

    src_ids = {r["item_id"] for r in _by_location(client, admin, "warehouse", inv_world["central_wh"])}
    assert prod["id"] not in src_ids         # zero on-hand → no longer transferable
    dest = {r["item_id"]: r for r in _by_location(client, admin, "warehouse", inv_world["branch_wh"])}
    assert Decimal(dest[prod["id"]]["on_hand"]) == Decimal("5.000")


def test_transfer_over_available_rejected_at_request_time(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin, "Scarce")
    _seed(client, admin, prod["id"], "warehouse", inv_world["central_wh"], "3")

    over = client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "4", "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "dest": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]}})
    assert over.status_code == 422, over.text
    # Refused before a document exists, so nothing is left pending to trip up later.
    assert client.get("/api/v1/transfers", headers=admin).json() == []

    exact = client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "3", "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "dest": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]}})
    assert exact.status_code == 201, exact.text


def test_transfer_to_same_location_and_zero_qty_rejected(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin, "Same")
    _seed(client, admin, prod["id"], "warehouse", inv_world["central_wh"], "5")
    same = {"location_kind": "warehouse", "location_id": inv_world["central_wh"]}

    assert client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "1", "route": "central_to_branch",
        "source": same, "dest": same}).status_code == 422
    assert client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "0", "route": "central_to_branch",
        "source": same,
        "dest": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]}},
    ).status_code == 422


def test_sale_cannot_exceed_on_hand(client, inv_world, login):
    """No negative stock anywhere — a sale for more than the custody holds is refused."""
    admin = login("admin")
    prod = _product(client, admin, "Limited")
    cust = client.post("/api/v1/customers", headers=admin, json={
        "name": "C", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    _seed(client, admin, prod["id"], "custody", inv_world["custody_a"], "2")

    rep = login("rep_a")
    origin = {"location_kind": "custody", "location_id": inv_world["custody_a"]}
    over = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "variable_discount_pct": "0", "cash_amount": "300", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "3", "discount_pct": "0"}]})
    assert over.status_code == 409, over.text          # no-negative-stock conflict
    assert over.json()["detail"]["code"] == "no_negative_stock"

    ok = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "variable_discount_pct": "0", "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "2", "discount_pct": "0"}]})
    assert ok.status_code == 201, ok.text
    # Sold down to exactly zero, never below.
    remaining = client.get("/api/v1/stock/on-hand", headers=admin, params={
        "item_id": prod["id"], "location_kind": "custody",
        "location_id": inv_world["custody_a"]}).json()["on_hand"]
    assert Decimal(remaining) == Decimal("0.000")
