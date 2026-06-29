"""T012: end-to-end serialized flow via API — receive → sell → return; serial count == on-hand."""


def _onhand(client, h, item_id, loc_id):
    return client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": loc_id}).json()["on_hand"]


def _in_stock_count(client, h, item_id):
    return len(client.get(f"/api/v1/items/{item_id}/serials?status=in_stock", headers=h).json())


def test_receive_sell_return_keeps_count_equal_onhand(client, inv_world, login):
    h = login("admin")
    prod = client.post("/api/v1/items", headers=h, json={
        "name": "Phone", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100", "is_serialized": True}).json()
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    wh = inv_world["central_wh"]
    client.post(f"/api/v1/items/{prod['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh, "serials": ["SN-1", "SN-2", "SN-3"]})
    assert _onhand(client, h, prod["id"], wh) == "3.000"
    assert _in_stock_count(client, h, prod["id"]) == 3

    # sell 2 specific serials
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"], "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "2", "serials": ["SN-1", "SN-2"]}]})
    assert sale.status_code == 201, sale.text
    assert _onhand(client, h, prod["id"], wh) == "1.000"
    assert _in_stock_count(client, h, prod["id"]) == 1  # invariant holds

    # return one serial
    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=h, json={
        "lines": [{"item_id": prod["id"], "quantity": "1", "serials": ["SN-1"]}]})
    assert ret.status_code == 201, ret.text
    assert _onhand(client, h, prod["id"], wh) == "2.000"
    assert _in_stock_count(client, h, prod["id"]) == 2  # invariant holds


def test_sell_count_mismatch_422(client, inv_world, login):
    h = login("admin")
    prod = client.post("/api/v1/items", headers=h, json={
        "name": "Phone2", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100", "is_serialized": True}).json()
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K2", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    wh = inv_world["central_wh"]
    client.post(f"/api/v1/items/{prod['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh, "serials": ["A", "B"]})
    resp = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"], "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "2", "serials": ["A"]}]})  # 1 serial, qty 2
    assert resp.status_code == 422
