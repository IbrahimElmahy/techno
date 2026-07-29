"""تاريخ فاتورة البيع.

A sale is not always typed on the day it happened — a rep comes back from a round, a branch
catches up on a backlog. So the invoice carries the day it happened, and that day dates the
ledger entry too.

That second part is the whole point. A document dated one day and posted on another makes every
statement disagree with the paper it was written from, and the disagreement only surfaces months
later when someone tries to reconcile a closed month.
"""
from datetime import date

import pytest


@pytest.fixture()
def ready(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف التاريخ", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=admin, json={"name": "مورد"}).json()
    client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "600", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "60"}]})
    customer = client.post("/api/v1/customers", headers=admin, json={
        "name": "عميل التاريخ", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    return {"admin": admin, "wh": wh, "item_id": item["id"], "customer_id": customer["id"]}


def _sell(client, ready, **extra):
    return client.post("/api/v1/sales", headers=ready["admin"], json={
        "customer_id": ready["customer_id"],
        "origin": {"location_kind": "warehouse", "location_id": ready["wh"]},
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "100",
        "lines": [{"item_id": ready["item_id"], "quantity": "1", "discount_pct": "0"}],
        **extra})


def test_the_invoice_keeps_the_day_it_happened(client, ready):
    resp = _sell(client, ready, invoice_date="2026-03-15")
    assert resp.status_code == 201, resp.text
    assert resp.json()["invoice_date"] == "2026-03-15"


def test_the_ledger_entry_lands_on_the_same_day(client, ready):
    """The books and the paper have to agree, or a reconciliation months later cannot be done."""
    resp = _sell(client, ready, invoice_date="2026-03-15")
    assert resp.status_code == 201, resp.text

    # The customer's statement is dated by the entry, so a window around that day must contain it
    # and a window before it must not.
    inside = client.get(f"/api/v1/customers/{ready['customer_id']}/statement",
                        headers=ready["admin"],
                        params={"date_from": "2026-03-15", "date_to": "2026-03-15"}).json()
    assert len(inside["lines"]) == 1

    before = client.get(f"/api/v1/customers/{ready['customer_id']}/statement",
                        headers=ready["admin"],
                        params={"date_from": "2026-01-01", "date_to": "2026-03-14"}).json()
    assert before["lines"] == []


def test_an_invoice_without_a_date_still_works(client, ready):
    """The field is optional: an existing caller that sends none behaves exactly as before."""
    resp = _sell(client, ready)
    assert resp.status_code == 201, resp.text
    assert resp.json()["invoice_date"] is None


def test_todays_date_is_accepted_like_any_other(client, ready):
    resp = _sell(client, ready, invoice_date=str(date.today()))
    assert resp.status_code == 201, resp.text
    assert resp.json()["invoice_date"] == str(date.today())
