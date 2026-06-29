"""T051: Sales & Inventory end-to-end smoke (purchase → manufacture → transfer → sale → return)."""
from decimal import Decimal


def _oh(client, h, item_id, kind, loc):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": kind, "location_id": loc}).json()["on_hand"])


def test_full_flow(client, inv_world, login):
    admin = login("admin")
    central = inv_world["central_wh"]
    raw = client.post("/api/v1/items", headers=admin, json={
        "name": "Steel", "kind": "raw_material", "unit_of_measure": "kg", "purchase_price": "10"}).json()
    prod = client.post("/api/v1/items", headers=admin, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=admin, json={"name": "Acme"}).json()

    # Purchase 50 raw into central (cash).
    client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"], "location": {"location_kind": "warehouse", "location_id": central},
        "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "50", "unit_price": "10"}]})
    assert _oh(client, admin, raw["id"], "warehouse", central) == Decimal("50.000")

    # Manufacture: consume 30 raw, produce 10 product at central.
    client.post("/api/v1/manufacturing/consume", headers=admin, json={
        "item_id": raw["id"], "location": {"location_kind": "warehouse", "location_id": central}, "quantity": "30"})
    client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": prod["id"], "location": {"location_kind": "warehouse", "location_id": central}, "quantity": "10"})
    assert _oh(client, admin, raw["id"], "warehouse", central) == Decimal("20.000")

    # Transfer 5 product central→rep_a, admin (central authority) approves.
    t = client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "5", "route": "central_to_rep",
        "source": {"location_kind": "warehouse", "location_id": central},
        "dest": {"location_kind": "custody", "location_id": inv_world["custody_a"]}}).json()
    assert client.post(f"/api/v1/transfers/{t['id']}/approve", headers=admin).status_code == 200
    assert _oh(client, admin, prod["id"], "custody", inv_world["custody_a"]) == Decimal("5.000")

    # Rep sells 3 to own customer (cash 100 / credit 200, no discount → net 300).
    cust = client.post("/api/v1/customers", headers=admin, json={
        "name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    rep = login("rep_a")
    sale = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": "100", "credit_amount": "200",
        "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert sale.status_code == 201
    assert _oh(client, rep, prod["id"], "custody", inv_world["custody_a"]) == Decimal("2.000")

    # Return 1 → stock back to 3.
    client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=rep,
                json={"lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert _oh(client, rep, prod["id"], "custody", inv_world["custody_a"]) == Decimal("3.000")
