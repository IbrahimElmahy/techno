"""T039: partial sales return, proportional money split. FR-021; US6; research R9."""
from decimal import Decimal


def _setup_sale(client, admin, inv_world):
    prod = client.post("/api/v1/items", headers=admin,
                       json={"name": "Gadget", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": "100"}).json()
    cust = client.post("/api/v1/customers", headers=admin,
                       json={"name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
                             "territory_id": inv_world["terr_a"]}).json()
    client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": prod["id"], "location": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "quantity": "5"})
    rep = client.post("/api/v1/auth/login", json={"username": "rep_a", "password": "pw"}).json()
    reph = {"Authorization": f"Bearer {rep['access_token']}"}
    sale = client.post("/api/v1/sales", headers=reph, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": "100", "credit_amount": "200",
        "lines": [{"item_id": prod["id"], "quantity": "3"}]}).json()  # net 300, 1/3 cash 2/3 credit
    return prod, sale, reph


def test_partial_return_proportional_split(client, inv_world, login):
    admin = login("admin")
    prod, sale, reph = _setup_sale(client, admin, inv_world)

    # Return 1 of 3 → value 100; original split 100 cash / 200 credit → 1/3 cash, 2/3 credit.
    r = client.post(f"/api/v1/sales/{sale['id']}/returns", headers=reph,
                    json={"lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert r.status_code == 201, r.text
    body = r.json()
    assert Decimal(body["cash_refund"]) == Decimal("33.33")
    assert Decimal(body["credit_reduction"]) == Decimal("66.67")

    # Stock returned: 2 sold remained → +1 back = 3.
    oh = client.get("/api/v1/stock/on-hand", headers=reph, params={
        "item_id": prod["id"], "location_kind": "custody", "location_id": inv_world["custody_a"]}).json()
    assert Decimal(oh["on_hand"]) == Decimal("3.000")


def test_over_return_rejected(client, inv_world, login):
    admin = login("admin")
    prod, sale, reph = _setup_sale(client, admin, inv_world)
    # Returning 4 of 3 sold → rejected.
    assert client.post(f"/api/v1/sales/{sale['id']}/returns", headers=reph,
                       json={"lines": [{"item_id": prod["id"], "quantity": "4"}]}).status_code == 409
