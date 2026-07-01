"""T018: end-to-end perishable flow via API — receive batches → FEFO sale → return.

Invariant: the batch-quantity sum at a location equals the item's derived on-hand there.
"""
from datetime import date


def _onhand(client, h, item_id, loc_id):
    return client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": loc_id}).json()["on_hand"]


def _batch_sum(client, h, item_id):
    rows = client.get(f"/api/v1/items/{item_id}/batches", headers=h).json()
    return sum(float(b["quantity"]) for b in rows)


def _make_perishable(client, h):
    return client.post("/api/v1/items", headers=h, json={
        "name": "Milk", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "is_perishable": True}).json()


def test_receive_sell_return_keeps_batch_sum_equal_onhand(client, inv_world, login):
    h = login("admin")
    prod = _make_perishable(client, h)
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    wh = inv_world["central_wh"]

    # two batches, different expiry
    client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-01-01", "quantity": "5"})
    client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-06-01", "quantity": "5"})
    assert _onhand(client, h, prod["id"], wh) == "10.000"
    assert _batch_sum(client, h, prod["id"]) == 10.0

    # sell 7 → FEFO drains the Jan batch fully + 2 from June
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"], "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "70", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "7"}]})
    assert sale.status_code == 201, sale.text
    assert _onhand(client, h, prod["id"], wh) == "3.000"
    assert _batch_sum(client, h, prod["id"]) == 3.0  # invariant holds

    # earliest-expiry batch fully drained
    batches = client.get(f"/api/v1/items/{prod['id']}/batches", headers=h).json()
    jan = next(b for b in batches if b["expiry_date"] == "2026-01-01")
    assert float(jan["quantity"]) == 0.0

    # return 2 units to a fresh expiry
    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=h, json={
        "lines": [{"item_id": prod["id"], "quantity": "2", "expiry_date": "2026-09-01"}]})
    assert ret.status_code == 201, ret.text
    assert _onhand(client, h, prod["id"], wh) == "5.000"
    assert _batch_sum(client, h, prod["id"]) == 5.0  # invariant still holds


def test_perishable_return_without_expiry_rejected(client, inv_world, login):
    h = login("admin")
    prod = _make_perishable(client, h)
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K2", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    wh = inv_world["central_wh"]
    client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-01-01", "quantity": "5"})
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"], "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "20", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "2"}]})
    assert sale.status_code == 201, sale.text
    # return with no expiry_date → 409 (perishable requires it)
    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=h, json={
        "lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert ret.status_code == 409, ret.text


def test_perishable_sale_shortfall_rejected(client, inv_world, login):
    h = login("admin")
    prod = _make_perishable(client, h)
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K3", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    wh = inv_world["central_wh"]
    client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-01-01", "quantity": "1"})
    resp = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"], "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "20", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "2"}]})
    assert resp.status_code == 409, resp.text
