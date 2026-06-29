"""T008: serial endpoints — mark serialized, receive, list; duplicate/non-serialized; RBAC."""


def _serialized_product(client, h):
    return client.post("/api/v1/items", headers=h, json={
        "name": "Phone", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100", "is_serialized": True}).json()


def test_receive_and_list(client, inv_world, login):
    h = login("admin")
    prod = _serialized_product(client, h)
    assert prod["is_serialized"] is True
    resp = client.post(f"/api/v1/items/{prod['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": inv_world["central_wh"],
        "serials": ["SN-1", "SN-2"]})
    assert resp.status_code == 201, resp.text
    # on-hand reflects the count
    oh = client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": prod["id"], "location_kind": "warehouse", "location_id": inv_world["central_wh"]}).json()
    assert oh["on_hand"] == "2.000"
    in_stock = client.get(f"/api/v1/items/{prod['id']}/serials?status=in_stock", headers=h).json()
    assert {s["serial"] for s in in_stock} == {"SN-1", "SN-2"}


def test_duplicate_serial_422(client, inv_world, login):
    h = login("admin")
    prod = _serialized_product(client, h)
    client.post(f"/api/v1/items/{prod['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": inv_world["central_wh"], "serials": ["SN-1"]})
    resp = client.post(f"/api/v1/items/{prod['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": inv_world["central_wh"], "serials": ["SN-1"]})
    assert resp.status_code == 422


def test_non_serialized_receive_422(client, inv_world, login):
    h = login("admin")
    prod = client.post("/api/v1/items", headers=h, json={
        "name": "Plain", "kind": "product", "unit_of_measure": "piece", "sale_price": "10"}).json()
    resp = client.post(f"/api/v1/items/{prod['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": inv_world["central_wh"], "serials": ["X"]})
    assert resp.status_code == 422


def test_receive_rbac(client, inv_world, login):
    h_admin = login("admin")
    prod = _serialized_product(client, h_admin)
    h = login("sm_a")  # sales manager — no purchase.write
    resp = client.post(f"/api/v1/items/{prod['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": inv_world["central_wh"], "serials": ["Z"]})
    assert resp.status_code == 403
