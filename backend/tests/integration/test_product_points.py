"""T013: per-product point value. FR-001/002; US1."""
from decimal import Decimal


def _product(client, admin, price="100"):
    return client.post("/api/v1/items", headers=admin,
                       json={"name": "Gadget", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": price}).json()


def test_set_and_edit_point_value(client, inv_world, login):
    admin = login("admin")
    asales = login("asales")
    prod = _product(client, admin)
    r = client.put(f"/api/v1/products/{prod['id']}/point-value", headers=asales,
                   json={"point_value": 5})
    assert r.status_code == 200 and Decimal(r.json()["point_value"]) == 5
    r2 = client.put(f"/api/v1/products/{prod['id']}/point-value", headers=asales,
                    json={"point_value": 8})
    assert Decimal(r2.json()["point_value"]) == 8


def test_point_value_on_non_product_rejected(client, inv_world, login):
    admin = login("admin")
    asales = login("asales")
    raw = client.post("/api/v1/items", headers=admin,
                      json={"name": "Steel", "kind": "raw_material", "unit_of_measure": "kg"}).json()
    assert client.put(f"/api/v1/products/{raw['id']}/point-value", headers=asales,
                      json={"point_value": 3}).status_code == 422


def test_fractional_point_value(client, inv_world, login):
    """v4: a product may be worth a fraction of a point (e.g. 6 pieces = 1 point)."""
    admin = login("admin")
    asales = login("asales")
    prod = _product(client, admin)
    r = client.put(f"/api/v1/products/{prod['id']}/point-value", headers=asales,
                   json={"point_value": "0.167"})
    assert r.status_code == 200
    assert Decimal(r.json()["point_value"]) == Decimal("0.167")
    got = client.get(f"/api/v1/products/{prod['id']}/point-value", headers=asales).json()
    assert Decimal(got["point_value"]) == Decimal("0.167")
