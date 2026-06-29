"""T026: partial purchase return, proportional money. FR-012; research R9; US6."""
from decimal import Decimal


def _setup_purchase(client, h, inv_world):
    item = client.post("/api/v1/items", headers=h,
                       json={"name": "Steel", "kind": "raw_material", "unit_of_measure": "kg",
                             "purchase_price": "10"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()
    central = inv_world["central_wh"]
    pur = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": central},
        "cash_amount": "400", "credit_amount": "600",
        "lines": [{"item_id": item["id"], "quantity": "100", "unit_price": "10"}]}).json()
    return item, sup, pur, central


def test_partial_return_proportional(client, inv_world, login):
    h = login("admin")
    item, sup, pur, central = _setup_purchase(client, h, inv_world)

    # Return 30 of 100 → value 300; original 400/600 of 1000 → 40% cash / 60% credit.
    r = client.post(f"/api/v1/purchases/{pur['id']}/returns", headers=h,
                    json={"lines": [{"item_id": item["id"], "quantity": "30"}]})
    assert r.status_code == 201, r.text

    # Stock: 100 − 30 = 70.
    oh = client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": central}).json()
    assert Decimal(oh["on_hand"]) == Decimal("70.000")
    # Supplier payable reduced by 60% of 300 = 180 → 600 − 180 = 420.
    acc = client.get(f"/api/v1/suppliers/{sup['id']}/account", headers=h).json()
    assert Decimal(acc["balance"]) == Decimal("420.00")


def test_cumulative_over_return_rejected(client, inv_world, login):
    h = login("admin")
    item, sup, pur, central = _setup_purchase(client, h, inv_world)
    client.post(f"/api/v1/purchases/{pur['id']}/returns", headers=h,
                json={"lines": [{"item_id": item["id"], "quantity": "70"}]})
    # 70 already returned; returning 40 more exceeds 100 → rejected.
    assert client.post(f"/api/v1/purchases/{pur['id']}/returns", headers=h,
                       json={"lines": [{"item_id": item["id"], "quantity": "40"}]}).status_code == 409
