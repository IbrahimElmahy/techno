"""Configurable dropdown lists (013): lazy seed, relabel/reorder/hide, custom add, system guard."""


def test_system_category_seeds_and_relabels_but_locks_values(client, world, login):
    h = login("admin")
    # Lazy-seed on first read: the 5 price tiers appear.
    opts = client.get("/api/v1/settings/lookups", headers=h, params={"category": "price_tier"}).json()
    assert {o["value"] for o in opts} == {
        "commercial", "semi_commercial", "wholesale", "semi_wholesale", "consumer"}
    assert all(o["is_system"] for o in opts)

    # Relabel one tier.
    wholesale = next(o for o in opts if o["value"] == "wholesale")
    upd = client.patch(f"/api/v1/settings/lookups/{wholesale['id']}", headers=h,
                       json={"label": "جملة كبار"})
    assert upd.status_code == 200 and upd.json()["label"] == "جملة كبار"

    # Cannot add a new value to a system list.
    assert client.post("/api/v1/settings/lookups", headers=h, json={
        "category": "price_tier", "value": "vip", "label": "كبار"}).status_code == 409

    # Cannot delete a system option — hide it instead.
    assert client.delete(f"/api/v1/settings/lookups/{wholesale['id']}", headers=h).status_code == 409
    hide = client.patch(f"/api/v1/settings/lookups/{wholesale['id']}", headers=h,
                        json={"active": False})
    assert hide.json()["active"] is False
    active = client.get("/api/v1/settings/lookups", headers=h,
                        params={"category": "price_tier", "active_only": True}).json()
    assert "wholesale" not in {o["value"] for o in active}


def test_custom_category_full_crud(client, world, login):
    h = login("admin")
    client.get("/api/v1/settings/lookups", headers=h, params={"category": "unit_of_measure"})
    created = client.post("/api/v1/settings/lookups", headers=h, json={
        "category": "unit_of_measure", "value": "طن", "label": "طن"})
    assert created.status_code == 201
    oid = created.json()["id"]
    assert client.delete(f"/api/v1/settings/lookups/{oid}", headers=h).status_code == 204


def test_categories_grouped_by_page(client, world, login):
    h = login("admin")
    pages = client.get("/api/v1/settings/lookups/categories", headers=h).json()
    by_page = {p["page"] for p in pages}
    assert {"catalog", "customers", "loyalty", "org"} <= by_page
