"""Paying more than the invoice at sale time settles the customer's PRIOR balance too (028).

The surplus over this invoice credits the customer's receivable, so his overall account total drops
— "the amount paid is deducted from the customer's whole account, not just this invoice".
"""
from decimal import Decimal

from src.services import customer_profile_service


def _customer(client, admin, inv_world):
    return client.post("/api/v1/customers", headers=admin, json={
        "name": "Payer", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _seed(client, admin, item_id, custody_id, qty):
    client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def _balance(db_session, customer_id):
    return customer_profile_service.bulk_balances(db_session, [customer_id]).get(customer_id, Decimal("0"))


def test_overpayment_reduces_prior_balance(client, inv_world, login, Session):
    admin = login("admin")
    prod = client.post("/api/v1/items", headers=admin, json={
        "name": "Bend", "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()
    cust = _customer(client, admin, inv_world)
    _seed(client, admin, prod["id"], inv_world["custody_a"], "10")

    rep = login("rep_a")
    origin = {"location_kind": "custody", "location_id": inv_world["custody_a"]}
    # Sale 1: 3 × 100 all on credit → the customer owes 300.
    s1 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "300",
        "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert s1.status_code == 201, s1.text
    s = Session(); assert _balance(s, cust["id"]) == Decimal("300.00"); s.close()

    # Sale 2: 1 × 100 = 100, but the customer pays 250 cash. credit = 100 − 250 = −150 (surplus
    # settles prior debt). cash + credit = 100 = net. Balance → 300 + (−150) = 150.
    s2 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "variable_discount_pct": "0", "cash_amount": "250", "credit_amount": "-150",
        "lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert s2.status_code == 201, s2.text
    assert Decimal(s2.json()["credit_amount"]) == Decimal("-150.00")

    s = Session()
    assert _balance(s, cust["id"]) == Decimal("150.00")   # 300 owed − 150 surplus paid
    s.close()
