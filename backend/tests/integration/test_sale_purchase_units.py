"""T016: sell/buy in a unit via API → stock moves by qty × factor (base); no-unit == 002."""
from decimal import Decimal


def _product(client, h):
    p = client.post("/api/v1/items", headers=h, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": "piece", "sale_price": "10"}).json()
    client.put(f"/api/v1/items/{p['id']}/units", headers=h, json={"units": [{"name": "carton", "factor": "12"}]})
    return p


def _raw(client, h):
    r = client.post("/api/v1/items", headers=h, json={
        "name": "Steel", "kind": "raw_material", "unit_of_measure": "kg", "purchase_price": "5"}).json()
    client.put(f"/api/v1/items/{r['id']}/units", headers=h, json={"units": [{"name": "ton", "factor": "1000"}]})
    return r


def _onhand(client, h, item_id, loc_id, kind="warehouse"):
    return client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": kind, "location_id": loc_id}).json()["on_hand"]


def test_sell_in_cartons_moves_base(client, inv_world, login):
    h = login("admin")
    prod = _product(client, h)
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    # seed 100 base into branch warehouse
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": prod["id"], "location": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "quantity": "100"})

    bm = login("bm_a")
    resp = client.post("/api/v1/sales", headers=bm, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "cash_amount": "240", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "2", "unit": "carton"}]})
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["net"]) == Decimal("240.00")  # 2 cartons × (10×12)
    assert Decimal(_onhand(client, bm, prod["id"], inv_world["branch_wh"])) == Decimal("76.000")
    detail = client.get(f"/api/v1/sales/{resp.json()['id']}", headers=bm).json()
    assert detail["lines"][0]["unit"] == "carton" and detail["lines"][0]["unit_factor"] == "12.000"


def test_buy_in_tons_moves_base(client, inv_world, login):
    h = login("admin")
    raw = _raw(client, h)
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "S"}).json()
    resp = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "cash_amount": "600", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "0.5", "unit": "ton", "unit_price": "1200"}]})
    assert resp.status_code == 201, resp.text
    # 0.5 ton × 1000 = 500 kg base in
    assert Decimal(_onhand(client, h, raw["id"], inv_world["central_wh"])) == Decimal("500.000")


def test_no_unit_behaves_like_002(client, inv_world, login):
    h = login("admin")
    prod = _product(client, h)
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K2", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": prod["id"], "location": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "quantity": "5"})
    bm = login("bm_a")
    resp = client.post("/api/v1/sales", headers=bm, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "cash_amount": "30", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "3"}]})  # no unit → base
    assert resp.status_code == 201, resp.text
    assert Decimal(_onhand(client, bm, prod["id"], inv_world["branch_wh"])) == Decimal("2.000")
