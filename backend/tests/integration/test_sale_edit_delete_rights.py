"""إنشاء · تعديل · حذف الفاتورة — تلات صلاحيات مش واحدة (031-a5-restructure).

Writing an invoice and unmaking one are different amounts of trust. A salesman writes them all day;
he should not be able to make yesterday's disappear.

Until now both went through `POST /sales/{id}/returns`, gated by `return.write` — which every
selling role holds. So «تعديل» and «حذف» on the screen were, on the server, indistinguishable from
a customer walking in with goods, and anyone who could take a return could void any invoice ever
posted.

The reversal now has its own endpoint that says WHY, and the why decides which right is needed.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def sold(client, inv_world, login, db):
    """One posted invoice, and logins for a rep and a manager."""
    from tests.conftest import _user
    from src.auth.rbac import RoleName

    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الصلاحيات", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "50", "unit_cost": "6"}]})
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل الصلاحيات", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()

    def make():
        res = client.post("/api/v1/sales", headers=h, json={
            "customer_id": cust["id"],
            "origin": {"location_kind": "warehouse", "location_id": wh},
            "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "10"}],
            "cash_amount": "20", "credit_amount": "0"})
        assert res.status_code == 201, res.text
        return res.json()

    _user(db, "sm_rights", RoleName.sales_manager, branch_id=inv_world["branch_a"])
    db.commit()
    return {"admin": h, "rep": login("rep_a"), "manager": login("sm_rights"), "make": make}


def test_a_rep_can_write_an_invoice(client, sold):
    """The right he must keep. Splitting the others out is worthless if it costs him this one."""
    assert sold["make"]()["id"]


def test_a_rep_cannot_reopen_a_posted_invoice(client, sold):
    inv = sold["make"]()
    res = client.post(f"/api/v1/sales/{inv['id']}/reverse", headers=sold["rep"],
                      json={"reason": "edit"})
    assert res.status_code == 403, res.text


def test_a_rep_cannot_void_a_posted_invoice(client, sold):
    inv = sold["make"]()
    res = client.post(f"/api/v1/sales/{inv['id']}/reverse", headers=sold["rep"],
                      json={"reason": "delete"})
    assert res.status_code == 403, res.text


def test_a_manager_can_reopen_it(client, sold):
    inv = sold["make"]()
    res = client.post(f"/api/v1/sales/{inv['id']}/reverse", headers=sold["manager"],
                      json={"reason": "edit"})
    assert res.status_code == 201, res.text
    assert res.json()["reason"] == "edit"


def test_a_manager_can_void_it(client, sold):
    inv = sold["make"]()
    res = client.post(f"/api/v1/sales/{inv['id']}/reverse", headers=sold["manager"],
                      json={"reason": "delete"})
    assert res.status_code == 201, res.text


def test_the_reason_must_be_one_of_the_two(client, sold):
    """Without a reason the server cannot tell which right is being exercised — and defaulting to
    either would hand out the other one for free."""
    inv = sold["make"]()
    for bad in ({}, {"reason": "whatever"}):
        res = client.post(f"/api/v1/sales/{inv['id']}/reverse", headers=sold["admin"], json=bad)
        assert res.status_code == 422, res.text


def test_reversing_twice_is_refused_rather_than_doubled(client, sold):
    """The goods came back once. A second reversal would return them again."""
    inv = sold["make"]()
    first = client.post(f"/api/v1/sales/{inv['id']}/reverse", headers=sold["admin"],
                        json={"reason": "delete"})
    assert first.status_code == 201, first.text
    second = client.post(f"/api/v1/sales/{inv['id']}/reverse", headers=sold["admin"],
                         json={"reason": "delete"})
    assert second.status_code == 409, second.text


def test_a_genuine_customer_return_still_goes_through_its_own_door(client, sold):
    """The split must not cost the rep the ability to take goods back at the counter — that IS his
    job, and it is a different event from the shop correcting itself."""
    inv = sold["make"]()
    detail = client.get(f"/api/v1/sales/{inv['id']}", headers=sold["admin"]).json()
    line = detail["lines"][0]
    res = client.post(f"/api/v1/sales/{inv['id']}/returns", headers=sold["rep"],
                      json={"lines": [{"item_id": line["item_id"], "quantity": "1"}]})
    assert res.status_code == 201, res.text
