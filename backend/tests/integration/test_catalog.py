"""T009: catalog kinds + validation. FR-002/003/004; US2."""


def _mk(client, h, **kw):
    return client.post("/api/v1/items", headers=h, json=kw)


def test_create_raw_and_product_with_codes(client, world, login):
    h = login("admin")
    rm = _mk(client, h, name="Steel", kind="raw_material", unit_of_measure="kg",
             purchase_price="12.50")
    pr = _mk(client, h, name="Gadget", kind="product", unit_of_measure="piece", sale_price="100")
    assert rm.status_code == 201 and rm.json()["code"].startswith("RM-")
    assert pr.status_code == 201 and pr.json()["code"].startswith("PR-")


def test_product_with_purchase_price_rejected(client, world, login):
    h = login("admin")
    r = _mk(client, h, name="Bad", kind="product", unit_of_measure="piece", purchase_price="5")
    assert r.status_code == 422


def test_raw_with_sale_price_rejected(client, world, login):
    h = login("admin")
    r = _mk(client, h, name="Bad", kind="raw_material", unit_of_measure="kg", sale_price="5")
    assert r.status_code == 422


def test_code_is_editable(client, world, login):
    h = login("admin")
    rm = _mk(client, h, name="Steel", kind="raw_material", unit_of_measure="kg").json()
    patched = client.patch(f"/api/v1/items/{rm['id']}", headers=h, json={"code": "RM-CUSTOM"})
    assert patched.status_code == 200 and patched.json()["code"] == "RM-CUSTOM"
