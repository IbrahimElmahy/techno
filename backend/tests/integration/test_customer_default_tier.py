"""T012: customer default price tier — set on create/patch; read back; RBAC."""


def test_default_tier_on_create(client, world, login):
    h = login("admin")
    resp = client.post("/api/v1/customers", headers=h, json={
        "name": "Wholesaler", "customer_type": "trader",
        "rep_id": world["rep_a"], "territory_id": world["terr_a"],
        "default_price_tier": "wholesale"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["default_price_tier"] == "wholesale"


def test_default_tier_patch(client, world, login):
    h = login("admin")
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "C", "customer_type": "trader",
        "rep_id": world["rep_a"], "territory_id": world["terr_a"]}).json()
    assert cust["default_price_tier"] is None
    resp = client.patch(f"/api/v1/customers/{cust['id']}", headers=h,
                       json={"default_price_tier": "commercial"})
    assert resp.status_code == 200
    assert resp.json()["default_price_tier"] == "commercial"
    # persisted on read
    got = client.get(f"/api/v1/customers/{cust['id']}", headers=h).json()
    assert got["default_price_tier"] == "commercial"


def test_patch_requires_customer_write(client, world, login):
    h_admin = login("admin")
    cust = client.post("/api/v1/customers", headers=h_admin, json={
        "name": "C2", "customer_type": "trader",
        "rep_id": world["rep_a"], "territory_id": world["terr_a"]}).json()
    h = login("rep_a")  # rep has no customer.write
    resp = client.patch(f"/api/v1/customers/{cust['id']}", headers=h,
                       json={"default_price_tier": "wholesale"})
    assert resp.status_code == 403
