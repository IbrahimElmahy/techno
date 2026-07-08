"""CRUD completion (v2): purchases list/detail, master-data edit/deactivate, sales-returns view."""
from decimal import Decimal


def _item(client, h, **kw):
    return client.post("/api/v1/items", headers=h, json=kw).json()


def test_purchases_list_and_detail(client, inv_world, login):
    h = login("admin")
    central = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": central}
    raw = _item(client, h, name="Steel", kind="raw_material", unit_of_measure="kg", purchase_price="10")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()
    created = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": loc, "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "50", "unit_price": "10"}]}).json()

    lst = client.get("/api/v1/purchases", headers=h)
    assert lst.status_code == 200
    row = next(p for p in lst.json() if p["id"] == created["id"])
    assert row["supplier_name"] == "Acme"
    assert Decimal(row["total"]) == Decimal("500.00")

    detail = client.get(f"/api/v1/purchases/{created['id']}", headers=h).json()
    assert len(detail["lines"]) == 1
    assert detail["lines"][0]["item_id"] == raw["id"]
    assert detail["returns"] == []


def test_supplier_edit_and_deactivate(client, inv_world, login):
    h = login("admin")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Old", "phone": "1"}).json()
    upd = client.patch(f"/api/v1/suppliers/{sup['id']}", headers=h,
                       json={"name": "New", "phone": "2"})
    assert upd.status_code == 200 and upd.json()["name"] == "New" and upd.json()["phone"] == "2"
    assert client.delete(f"/api/v1/suppliers/{sup['id']}", headers=h).status_code == 204
    assert client.get(f"/api/v1/suppliers/{sup['id']}", headers=h).json()["active"] is False


def test_customer_full_edit_and_deactivate(client, inv_world, login, db):
    from tests.conftest import make_customer_with_account
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"])
    db.commit()
    h = login("admin")
    upd = client.patch(f"/api/v1/customers/{cust.id}", headers=h,
                       json={"name": "Renamed", "phone": "0100", "active": True})
    assert upd.status_code == 200 and upd.json()["name"] == "Renamed" and upd.json()["phone"] == "0100"
    assert client.delete(f"/api/v1/customers/{cust.id}", headers=h).status_code == 204
    assert client.get(f"/api/v1/customers/{cust.id}", headers=h).json()["active"] is False


def test_item_soft_delete(client, inv_world, login):
    h = login("admin")
    it = _item(client, h, name="Gadget", kind="product", unit_of_measure="pc", sale_price="10")
    assert client.delete(f"/api/v1/items/{it['id']}", headers=h).status_code == 204
    row = next(i for i in client.get("/api/v1/items", headers=h).json() if i["id"] == it["id"])
    assert row["active"] is False


def test_branch_and_warehouse_edit_deactivate(client, inv_world, login):
    h = login("admin")
    br = client.get("/api/v1/branches", headers=h).json()[0]
    assert client.patch(f"/api/v1/branches/{br['id']}", headers=h,
                        json={"name": "Renamed Branch"}).json()["name"] == "Renamed Branch"
    wh = inv_world["central_wh"]
    assert client.patch(f"/api/v1/warehouses/{wh}", headers=h,
                        json={"active": False}).json()["active"] is False
    assert client.delete(f"/api/v1/warehouses/{wh}", headers=h).status_code == 204
