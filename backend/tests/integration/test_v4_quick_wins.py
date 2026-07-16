"""v4 quick wins: user edit, governorate CRUD, item category, addresses/phones, plumber rule."""
import pytest

from tests.conftest import _user  # noqa: F401 (fixture helper style)


def test_user_edit_and_sales_rep_creation(client, world, login):
    """A sales rep can be created, and users are editable (both were blocked before)."""
    h = login("admin")
    created = client.post("/api/v1/users", headers=h, json={
        "username": "rep_new", "password": "pw12345", "role": "sales_rep",
        "full_name": "مندوب جديد", "branch_id": world["branch_a"], "territory_id": world["terr_a"]})
    assert created.status_code == 201, created.text
    uid = created.json()["id"]

    upd = client.patch(f"/api/v1/users/{uid}", headers=h, json={"full_name": "مندوب معدّل"})
    assert upd.status_code == 200 and upd.json()["full_name"] == "مندوب معدّل"
    # password reset works (can log in with the new one)
    assert client.patch(f"/api/v1/users/{uid}", headers=h,
                        json={"password": "newpass123"}).status_code == 200
    assert client.post("/api/v1/auth/login",
                       json={"username": "rep_new", "password": "newpass123"}).status_code == 200


def test_governorate_create_and_edit(client, world, login):
    h = login("admin")
    r = client.post("/api/v1/governorates", headers=h, json={"name": "أسيوط"})
    assert r.status_code == 201, r.text
    gid = r.json()["id"]
    assert client.post("/api/v1/governorates", headers=h, json={"name": "أسيوط"}).status_code == 409
    assert client.patch(f"/api/v1/governorates/{gid}", headers=h,
                        json={"name": "أسيوط الجديدة"}).json()["name"] == "أسيوط الجديدة"
    assert "أسيوط الجديدة" in [g["name"] for g in
                               client.get("/api/v1/governorates", headers=h).json()]


def test_item_category_set_and_filter(client, world, login):
    h = login("admin")
    a = client.post("/api/v1/items", headers=h, json={
        "name": "ماسورة", "kind": "product", "unit_of_measure": "قطعة", "sale_price": "10",
        "category": "مواسير"}).json()
    client.post("/api/v1/items", headers=h, json={
        "name": "لحام", "kind": "product", "unit_of_measure": "قطعة", "sale_price": "5",
        "category": "لحامات"})
    assert a["category"] == "مواسير"
    only = client.get("/api/v1/items", headers=h, params={"category": "مواسير"}).json()
    assert [i["name"] for i in only] == ["ماسورة"]


def test_supplier_address_and_multiple_phones(client, world, login):
    h = login("admin")
    s = client.post("/api/v1/suppliers", headers=h, json={
        "name": "مورد", "phone": "0100", "address": "القاهرة - شبرا",
        "phones": ["0111", "0122"]}).json()
    assert s["address"] == "القاهرة - شبرا" and set(s["phones"]) == {"0111", "0122"}
    upd = client.patch(f"/api/v1/suppliers/{s['id']}", headers=h,
                       json={"phones": ["0155"], "address": "الجيزة"}).json()
    assert upd["phones"] == ["0155"] and upd["address"] == "الجيزة"


def test_customer_detailed_address_and_phones(client, inv_world, login):
    h = login("admin")
    gov = client.post("/api/v1/governorates", headers=h, json={"name": "المنيا"}).json()
    c = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"], "phone": "0100",
        "governorate_id": gov["id"], "markaz": "مركز ملوي", "address": "شارع 1",
        "phones": ["0111", "0122"]}).json()
    assert c["governorate_id"] == gov["id"] and c["markaz"] == "مركز ملوي"
    assert set(c["phones"]) == {"0111", "0122"}


def test_plumber_must_be_owned_by_after_sales_rep(client, inv_world, login):
    """Client rule (v4): a plumber's responsible rep must be after-sales staff."""
    h = login("admin")
    body = {"name": "سباك", "customer_type": "plumber", "territory_id": inv_world["terr_a"],
            "phone": "0100"}
    # a sales rep is rejected...
    bad = client.post("/api/v1/customers", headers=h, json={**body, "rep_id": inv_world["rep_a"]})
    assert bad.status_code == 422
    # ...the after-sales user is accepted
    ok = client.post("/api/v1/customers", headers=h, json={**body, "rep_id": inv_world["asales"]})
    assert ok.status_code == 201, ok.text
