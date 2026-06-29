"""T017: returning N of a unit line reverses N × factor (base stock) and N × unit_price (money)."""
from decimal import Decimal


def _onhand(client, h, item_id, loc_id):
    return client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": loc_id}).json()["on_hand"]


def test_return_one_carton_reverses_base_and_money(client, inv_world, login):
    h = login("admin")
    prod = client.post("/api/v1/items", headers=h, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": "piece", "sale_price": "10"}).json()
    client.put(f"/api/v1/items/{prod['id']}/units", headers=h, json={"units": [{"name": "carton", "factor": "12"}]})
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": prod["id"], "location": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "quantity": "100"})

    bm = login("bm_a")
    sale = client.post("/api/v1/sales", headers=bm, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "cash_amount": "360", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "3", "unit": "carton"}]}).json()
    # sold 3 cartons = 36 base; on hand 64
    assert Decimal(_onhand(client, bm, prod["id"], inv_world["branch_wh"])) == Decimal("64.000")

    # return 1 carton → +12 base (on hand 76); money value = 1 × 120
    ret = client.post(f"/api/v1/sales/{sale['id']}/returns", headers=bm,
                     json={"lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert ret.status_code == 201, ret.text
    assert Decimal(_onhand(client, bm, prod["id"], inv_world["branch_wh"])) == Decimal("76.000")
    # cash refund equals the carton value (full-cash sale)
    assert Decimal(ret.json()["cash_refund"]) == Decimal("120.00")
