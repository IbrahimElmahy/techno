"""مردودات شراء as a register of its own — 031-a5-restructure.

The returns were always recorded and could only be reached by opening the purchase they came off.
That answers «what came back off THIS invoice» and never «what went back to suppliers this month»,
which is the question their standalone screen exists to answer.
"""
from __future__ import annotations


def _raw(client, h):
    return client.post("/api/v1/items", headers=h,
                       json={"name": "R", "kind": "raw_material", "unit_of_measure": "piece",
                             "purchase_price": "100"}).json()


def _supplier(client, h, name="Acme"):
    return client.post("/api/v1/suppliers", headers=h, json={"name": name}).json()


def _purchase(client, h, *, supplier_id, warehouse_id, item_id, qty, price):
    res = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier_id,
        "location": {"location_kind": "warehouse", "location_id": warehouse_id},
        "lines": [{"item_id": item_id, "quantity": str(qty), "unit_price": str(price)}],
        "cash_amount": "0", "credit_amount": str(qty * price),
    })
    assert res.status_code == 201, res.text
    return res.json()


def test_returns_register_names_the_purchase_and_the_supplier(client, inv_world, login):
    """The register's whole point: each return says which purchase and which supplier."""
    h = login("admin")
    item = _raw(client, h)
    sup = _supplier(client, h)
    purchase = _purchase(client, h, supplier_id=sup["id"], warehouse_id=inv_world["central_wh"],
                         item_id=item["id"], qty=10, price=100)

    res = client.post(f"/api/v1/purchases/{purchase['id']}/returns", headers=h,
                      json={"lines": [{"item_id": item["id"], "quantity": "3"}]})
    assert res.status_code == 201, res.text
    ret = res.json()

    listed = client.get("/api/v1/purchases/returns", headers=h)
    assert listed.status_code == 200, listed.text
    row = next(r for r in listed.json() if r["id"] == ret["id"])

    assert row["purchase_invoice_id"] == purchase["id"]
    assert row["purchase_document_number"] == purchase["document_number"]
    assert row["supplier_id"] == sup["id"]
    assert row["supplier_name"] == "Acme"
    assert float(row["value"]) == 300.0


def test_returns_route_is_not_swallowed_by_the_id_route(client, inv_world, login):
    """`/purchases/returns` must not be parsed as purchase #«returns».

    Declaration order is the only thing keeping these apart, and nothing at the call site makes
    that visible — so it is pinned here rather than left to whoever edits the file next.
    """
    h = login("admin")
    res = client.get("/api/v1/purchases/returns", headers=h)
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_register_filters_by_supplier(client, inv_world, login):
    h = login("admin")
    item = _raw(client, h)
    mine, other = _supplier(client, h, "Mine"), _supplier(client, h, "Other")

    p1 = _purchase(client, h, supplier_id=mine["id"], warehouse_id=inv_world["central_wh"],
                   item_id=item["id"], qty=5, price=50)
    p2 = _purchase(client, h, supplier_id=other["id"], warehouse_id=inv_world["central_wh"],
                   item_id=item["id"], qty=5, price=50)
    for p in (p1, p2):
        client.post(f"/api/v1/purchases/{p['id']}/returns", headers=h,
                    json={"lines": [{"item_id": item["id"], "quantity": "1"}]})

    rows = client.get(f"/api/v1/purchases/returns?supplier_id={mine['id']}", headers=h).json()
    assert rows, "the supplier we just returned to must appear"
    assert all(r["supplier_id"] == mine["id"] for r in rows)
    assert all(r["supplier_name"] == "Mine" for r in rows)

    assert client.get("/api/v1/purchases/returns?supplier_id=999999", headers=h).json() == []
