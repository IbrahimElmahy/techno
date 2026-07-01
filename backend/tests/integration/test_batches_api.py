"""T018: batch receive/list + reorder + expiring report endpoints (011)."""


def _perishable(client, h, min_stock=None, max_stock=None):
    body = {"name": "Yogurt", "kind": "product", "unit_of_measure": "piece",
            "sale_price": "10", "is_perishable": True}
    if min_stock is not None:
        body["min_stock"] = min_stock
    if max_stock is not None:
        body["max_stock"] = max_stock
    return client.post("/api/v1/items", headers=h, json=body).json()


def test_receive_and_list_batches(client, inv_world, login):
    h = login("admin")
    prod = _perishable(client, h)
    wh = inv_world["central_wh"]
    r = client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-03-01", "quantity": "8"})
    assert r.status_code == 201, r.text
    rows = client.get(f"/api/v1/items/{prod['id']}/batches", headers=h).json()
    assert len(rows) == 1
    assert rows[0]["quantity"] == "8.000"
    assert rows[0]["expiry_date"] == "2026-03-01"


def test_receive_on_non_perishable_rejected(client, inv_world, login):
    h = login("admin")
    prod = client.post("/api/v1/items", headers=h, json={
        "name": "Widget", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    wh = inv_world["central_wh"]
    r = client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-03-01", "quantity": "8"})
    assert r.status_code == 422, r.text


def test_reorder_report(client, inv_world, login):
    h = login("admin")
    prod = _perishable(client, h, min_stock="10")
    wh = inv_world["central_wh"]
    client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-03-01", "quantity": "4"})
    rows = client.get("/api/v1/stock/reorder", headers=h).json()
    row = next(r for r in rows if r["item_id"] == prod["id"])
    assert row["flag"] == "below_min"
    assert row["on_hand"] == "4.000"


def test_expiring_report(client, inv_world, login):
    h = login("admin")
    prod = _perishable(client, h)
    wh = inv_world["central_wh"]
    client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-02-01", "quantity": "3"})
    client.post(f"/api/v1/items/{prod['id']}/batches/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "expiry_date": "2026-12-01", "quantity": "3"})
    rows = client.get("/api/v1/stock/expiring", headers=h,
                      params={"before": "2026-06-01"}).json()
    mine = [r for r in rows if r["item_id"] == prod["id"]]
    assert len(mine) == 1  # only the Feb batch is on/before Jun 1
    assert mine[0]["expiry_date"] == "2026-02-01"
