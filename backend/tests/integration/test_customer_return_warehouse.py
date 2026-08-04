"""العميل بيفتكر مخزن مرتجعاته — 031-a5-restructure.

Picking the receiving store on every return asks a question whose answer has not changed since the
last one: a customer's goods come back to the branch that serves him.

So the FIRST return written for him remembers the store, and every later one opens on it. First
time only — a one-off return taken at another store must not silently become his default, or the
next person finds a store nobody chose.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def shop(client, inv_world, login, db):
    h = login("admin")
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف المرتجع", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل المرتجع", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()
    return {"h": h, "item": item, "customer": cust,
            "central": inv_world["central_wh"], "branch": inv_world["branch_wh"]}


def _ret(client, s, warehouse_id):
    return client.post("/api/v1/sales/returns", headers=s["h"], json={
        "customer_id": s["customer"]["id"],
        "origin": {"location_kind": "warehouse", "location_id": warehouse_id},
        "lines": [{"item_id": s["item"]["id"], "quantity": "1", "unit_price": "10"}],
        # The refund has to balance the goods coming back, same as any return.
        "cash_refund": "10", "credit_reduction": "0"})


def _customer(client, s):
    return client.get(f"/api/v1/customers/{s['customer']['id']}", headers=s["h"]).json()


def test_a_new_customer_has_none(client, shop):
    """NULL is «he has never had a return», which is not the same as «he has no preference»."""
    assert _customer(client, shop)["default_return_warehouse_id"] is None


def test_the_first_return_is_remembered(client, shop):
    res = _ret(client, shop, shop["branch"])
    assert res.status_code == 201, res.text
    assert _customer(client, shop)["default_return_warehouse_id"] == shop["branch"]


def test_a_later_return_elsewhere_does_not_overwrite_it(client, shop):
    """The rule that keeps it useful. Last-one-wins would let a single return taken at another
    store rewrite his default, and the next person would open on a store nobody chose."""
    assert _ret(client, shop, shop["branch"]).status_code == 201
    assert _ret(client, shop, shop["central"]).status_code == 201
    assert _customer(client, shop)["default_return_warehouse_id"] == shop["branch"]
