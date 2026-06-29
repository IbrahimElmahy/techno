"""T009: barcode endpoints — manage, lookup, 404, RBAC."""


def _product(client, h, uom="piece"):
    return client.post("/api/v1/items", headers=h, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": uom, "sale_price": "100"}).json()


def test_set_read_and_lookup(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    client.put(f"/api/v1/items/{prod['id']}/units", headers=h, json={"units": [{"name": "carton", "factor": "12"}]})
    resp = client.put(f"/api/v1/items/{prod['id']}/barcodes", headers=h, json={"barcodes": [
        {"barcode": "BC-1"}, {"barcode": "BC-12", "unit": "carton"}]})
    assert resp.status_code == 200, resp.text

    got = client.get(f"/api/v1/items/{prod['id']}/barcodes", headers=h).json()
    assert {b["barcode"] for b in got} == {"BC-1", "BC-12"}

    look = client.get("/api/v1/barcodes/BC-12", headers=h).json()
    assert look["item_id"] == prod["id"] and look["unit"] == "carton" and look["factor"] == "12.000"
    assert look["base_sale_price"] == "100.00"

    base = client.get("/api/v1/barcodes/BC-1", headers=h).json()
    assert base["unit"] is None and base["factor"] == "1.000"


def test_unknown_lookup_404(client, world, login):
    h = login("admin")
    assert client.get("/api/v1/barcodes/NOPE", headers=h).status_code == 404


def test_duplicate_barcode_422(client, world, login):
    h = login("admin")
    a = _product(client, h)
    b = _product(client, h)
    client.put(f"/api/v1/items/{a['id']}/barcodes", headers=h, json={"barcodes": [{"barcode": "DUP"}]})
    resp = client.put(f"/api/v1/items/{b['id']}/barcodes", headers=h, json={"barcodes": [{"barcode": "DUP"}]})
    assert resp.status_code == 422


def test_unknown_unit_422(client, world, login):
    h = login("admin")
    prod = _product(client, h)
    resp = client.put(f"/api/v1/items/{prod['id']}/barcodes", headers=h,
                     json={"barcodes": [{"barcode": "X", "unit": "pallet"}]})
    assert resp.status_code == 422


def test_rbac_set_denied(client, world, login):
    h_admin = login("admin")
    prod = _product(client, h_admin)
    h = login("rep_a")  # no catalog.write
    resp = client.put(f"/api/v1/items/{prod['id']}/barcodes", headers=h,
                     json={"barcodes": [{"barcode": "Z"}]})
    assert resp.status_code == 403
