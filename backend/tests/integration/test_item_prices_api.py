"""T010: item tier-price endpoints — set/read five tiers; product-only; RBAC."""


def _product(client, h, price="100"):
    return client.post("/api/v1/items", headers=h,
                       json={"name": "Gadget", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": price}).json()


FIVE = [
    {"tier": "commercial", "price": "100.00"},
    {"tier": "semi_commercial", "price": "110.00"},
    {"tier": "wholesale", "price": "90.00"},
    {"tier": "semi_wholesale", "price": "95.00"},
    {"tier": "consumer", "price": "130.00"},
]


def test_set_and_read_five_tiers(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    resp = client.put(f"/api/v1/items/{prod['id']}/prices", headers=h, json={"tiers": FIVE})
    assert resp.status_code == 200, resp.text
    got = client.get(f"/api/v1/items/{prod['id']}/prices", headers=h).json()
    assert got["base_sale_price"] == "100.00"
    tiers = {t["tier"]: t["price"] for t in got["tiers"]}
    assert tiers["wholesale"] == "90.00" and tiers["consumer"] == "130.00"
    assert len(tiers) == 5


def test_upsert_leaves_others_unchanged(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    client.put(f"/api/v1/items/{prod['id']}/prices", headers=h, json={"tiers": FIVE})
    # update only wholesale
    client.put(f"/api/v1/items/{prod['id']}/prices", headers=h,
               json={"tiers": [{"tier": "wholesale", "price": "85.00"}]})
    tiers = {t["tier"]: t["price"] for t in client.get(
        f"/api/v1/items/{prod['id']}/prices", headers=h).json()["tiers"]}
    assert tiers["wholesale"] == "85.00" and tiers["consumer"] == "130.00"


def test_raw_material_rejected(client, world, login):
    h = login("admin")
    raw = client.post("/api/v1/items", headers=h, json={
        "name": "Steel", "kind": "raw_material", "unit_of_measure": "kg",
        "purchase_price": "5"}).json()
    resp = client.put(f"/api/v1/items/{raw['id']}/prices", headers=h,
                     json={"tiers": [{"tier": "consumer", "price": "10"}]})
    assert resp.status_code == 422


def test_rbac_non_catalog_writer_denied(client, world, login):
    h_admin = login("admin")
    prod = _product(client, h_admin)
    h = login("rep_a")  # rep cannot write catalog
    resp = client.put(f"/api/v1/items/{prod['id']}/prices", headers=h,
                     json={"tiers": [{"tier": "consumer", "price": "1"}]})
    assert resp.status_code == 403
