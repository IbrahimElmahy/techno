"""T012: item units endpoints — set/read units; duplicate/factor validation; RBAC."""


def _product(client, h, uom="piece"):
    return client.post("/api/v1/items", headers=h, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": uom, "sale_price": "10"}).json()


def test_set_and_read_units(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    resp = client.put(f"/api/v1/items/{prod['id']}/units", headers=h, json={"units": [
        {"name": "carton", "factor": "12.000"}, {"name": "dozen", "factor": "12.000"}]})
    assert resp.status_code == 200, resp.text
    got = client.get(f"/api/v1/items/{prod['id']}/units", headers=h).json()
    assert got["base_unit"] == "piece"
    names = {u["name"]: u for u in got["units"]}
    assert names["piece"]["is_base"] is True
    assert names["carton"]["factor"] == "12.000" and names["carton"]["is_base"] is False
    assert len(got["units"]) == 3  # base + 2 alternates


def test_replace_semantics(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    client.put(f"/api/v1/items/{prod['id']}/units", headers=h,
               json={"units": [{"name": "carton", "factor": "12"}]})
    client.put(f"/api/v1/items/{prod['id']}/units", headers=h,
               json={"units": [{"name": "box", "factor": "24"}]})
    names = {u["name"] for u in client.get(f"/api/v1/items/{prod['id']}/units", headers=h).json()["units"]}
    assert names == {"piece", "box"}  # carton replaced


def test_duplicate_and_base_name_rejected(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    # name duplicates the base unit
    assert client.put(f"/api/v1/items/{prod['id']}/units", headers=h,
                     json={"units": [{"name": "piece", "factor": "2"}]}).status_code == 422
    # duplicate within the set
    assert client.put(f"/api/v1/items/{prod['id']}/units", headers=h, json={"units": [
        {"name": "carton", "factor": "12"}, {"name": "carton", "factor": "6"}]}).status_code == 422


def test_non_positive_factor_rejected(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    assert client.put(f"/api/v1/items/{prod['id']}/units", headers=h,
                     json={"units": [{"name": "carton", "factor": "0"}]}).status_code == 422


def test_rbac_denied(client, world, login):
    h_admin = login("admin")
    prod = _product(client, h_admin)
    h = login("rep_a")
    assert client.put(f"/api/v1/items/{prod['id']}/units", headers=h,
                     json={"units": [{"name": "c", "factor": "2"}]}).status_code == 403
