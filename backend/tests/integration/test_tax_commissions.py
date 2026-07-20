"""VAT (opt-in) and rep commissions — 021."""
from __future__ import annotations

from decimal import Decimal

import pytest


def _product(client, admin, price="100"):
    # A product carries a sale price only — its cost is derived from manufacturing.
    r = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف ضريبة", "kind": "product", "unit_of_measure": "قطعة",
        "sale_price": price})
    assert r.status_code == 201, r.text
    return r.json()


def _stock(client, admin, item_id, custody_id, qty=100):
    """Products enter stock by being produced (same path the loyalty tests use)."""
    r = client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": item_id,
        "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": str(qty)})
    assert r.status_code in (200, 201), r.text


@pytest.fixture()
def shop(client, inv_world, login, db):
    admin, rep = login("admin"), login("rep_a")
    item = _product(client, admin)
    _stock(client, admin, item["id"], inv_world["custody_a"])
    customer = client.post("/api/v1/customers", headers=admin, json={
        "name": "عميل الضريبة", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    return {"admin": admin, "rep": rep, "item_id": item["id"],
            "customer_id": customer["id"], "custody": inv_world["custody_a"],
            "rep_id": inv_world["rep_a"], "rep_b": inv_world["rep_b"]}


def _sell(client, headers, shop, qty=2, cash="0", credit=None, expect=201):
    body = {
        "customer_id": shop["customer_id"],
        "origin": {"location_kind": "custody", "location_id": shop["custody"]},
        "variable_discount_pct": "0", "cash_amount": cash,
        "credit_amount": credit if credit is not None else "0",
        "lines": [{"item_id": shop["item_id"], "quantity": str(qty)}],
    }
    r = client.post("/api/v1/sales", headers=headers, json=body)
    assert r.status_code == expect, r.text
    return r


def _set_vat(client, admin, rate):
    r = client.put("/api/v1/settings/sales", headers=admin,
                   json={"fixed_discount_pct": "0", "vat_rate_pct": str(rate)})
    assert r.status_code == 200, r.text


def test_vat_is_off_by_default_and_posting_is_unchanged(client, shop):
    """The shipped default must keep the pre-VAT contract exactly: pay the net, no tax."""
    s = client.get("/api/v1/settings/sales", headers=shop["admin"]).json()
    assert Decimal(s["vat_rate_pct"]) == 0

    inv = _sell(client, shop["rep"], shop, qty=2, cash="200").json()
    assert Decimal(inv["net"]) == 200
    vat = client.get("/api/v1/reports/vat-return", headers=shop["admin"]).json()
    assert Decimal(vat["output_tax"]) == 0


def test_enabling_vat_charges_tax_on_top_of_the_net(client, shop):
    admin = shop["admin"]
    _set_vat(client, admin, 14)
    # net 200 + 14% = 228 payable; paying only the net must be refused (422 = validation).
    _sell(client, shop["rep"], shop, qty=2, cash="200", expect=422)
    inv = _sell(client, shop["rep"], shop, qty=2, cash="228").json()
    assert Decimal(inv["net"]) == 200

    vat = client.get("/api/v1/reports/vat-return", headers=admin).json()
    assert Decimal(vat["output_tax"]) == 28
    assert Decimal(vat["net_payable"]) == 28


def test_return_gives_back_the_tax_proportionally(client, shop):
    admin = shop["admin"]
    _set_vat(client, admin, 10)
    inv = _sell(client, shop["rep"], shop, qty=4, cash="440").json()  # net 400 + 40 tax

    r = client.post(f"/api/v1/sales/{inv['id']}/returns", headers=shop["rep"], json={
        "lines": [{"item_id": shop["item_id"], "quantity": "2"}]})
    assert r.status_code == 201, r.text
    # Half the goods back ⇒ half the tax back.
    vat = client.get("/api/v1/reports/vat-return", headers=admin).json()
    assert Decimal(vat["output_tax"]) == 20


def test_full_return_leaves_no_tax_behind(client, shop):
    admin = shop["admin"]
    _set_vat(client, admin, 14)
    inv = _sell(client, shop["rep"], shop, qty=2, cash="228").json()
    client.post(f"/api/v1/sales/{inv['id']}/returns", headers=shop["rep"], json={
        "lines": [{"item_id": shop["item_id"], "quantity": "2"}]})
    vat = client.get("/api/v1/reports/vat-return", headers=admin).json()
    assert Decimal(vat["output_tax"]) == 0


def test_vat_rate_bounds(client, shop):
    admin = shop["admin"]
    bad = client.put("/api/v1/settings/sales", headers=admin,
                     json={"fixed_discount_pct": "0", "vat_rate_pct": "150"})
    assert bad.status_code == 422


def test_commission_on_collection(client, shop, db):
    admin, rep = shop["admin"], shop["rep"]
    r = client.put("/api/v1/commission-rules", headers=admin, json={
        "rep_user_id": shop["rep_id"], "rate_pct": "5", "basis": "collection"})
    assert r.status_code == 200, r.text

    _sell(client, rep, shop, qty=3, credit="300")  # raises a 300 receivable
    client.post("/api/v1/vouchers/receipts", headers=rep, json={
        "customer_id": shop["customer_id"], "amount": "200"})

    rows = client.get("/api/v1/reports/commissions", headers=admin).json()
    mine = next(r for r in rows if r["rep_user_id"] == shop["rep_id"])
    assert Decimal(mine["base_amount"]) == 200  # collected, not sold
    assert Decimal(mine["commission"]) == 10


def test_commission_on_sales_is_clawed_back_by_returns(client, shop):
    admin, rep = shop["admin"], shop["rep"]
    client.put("/api/v1/commission-rules", headers=admin, json={
        "rep_user_id": shop["rep_id"], "rate_pct": "10", "basis": "sales"})
    inv = _sell(client, rep, shop, qty=4, cash="400").json()
    rows = client.get("/api/v1/reports/commissions", headers=admin).json()
    assert Decimal(next(r for r in rows)["commission"]) == 40

    client.post(f"/api/v1/sales/{inv['id']}/returns", headers=rep, json={
        "lines": [{"item_id": shop["item_id"], "quantity": "1"}]})
    rows = client.get("/api/v1/reports/commissions", headers=admin).json()
    assert Decimal(next(r for r in rows)["commission"]) == 30  # 400 - 100 returned


def test_default_rule_applies_to_reps_without_their_own(client, shop):
    admin, rep = shop["admin"], shop["rep"]
    client.put("/api/v1/commission-rules", headers=admin,
               json={"rate_pct": "2", "basis": "sales"})  # company default
    _sell(client, rep, shop, qty=5, cash="500")
    rows = client.get("/api/v1/reports/commissions", headers=admin).json()
    mine = next(r for r in rows if r["rep_user_id"] == shop["rep_id"])
    assert Decimal(mine["rate_pct"]) == 2 and Decimal(mine["commission"]) == 10


def test_rep_sees_only_his_own_commission_and_cannot_set_rules(client, shop):
    admin, rep = shop["admin"], shop["rep"]
    client.put("/api/v1/commission-rules", headers=admin,
               json={"rate_pct": "5", "basis": "sales"})
    _sell(client, rep, shop, qty=2, cash="200")
    rows = client.get("/api/v1/reports/commissions", headers=rep).json()
    assert all(r["rep_user_id"] == shop["rep_id"] for r in rows)
    assert client.put("/api/v1/commission-rules", headers=rep,
                      json={"rate_pct": "50", "basis": "sales"}).status_code == 403


def test_commission_rate_bounds(client, shop):
    bad = client.put("/api/v1/commission-rules", headers=shop["admin"],
                     json={"rate_pct": "120", "basis": "sales"})
    assert bad.status_code == 409
