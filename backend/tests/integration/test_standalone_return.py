"""Standalone sales return (028) — "a sale, reversed": pick a customer + items directly, goods go
back INTO stock, the customer is credited, points earned on the goods are removed, and the refund
price defaults to what the customer last paid."""
from decimal import Decimal

from src.services import stock_service
from src.models.stock import LocationKind


def _set_points(client, asales, item_id, pv):
    client.put(f"/api/v1/products/{item_id}/point-value", headers=asales, json={"point_value": pv})


def _seed_custody(client, admin, item_id, custody_id, qty):
    client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def _customer(client, admin, inv_world, name="K"):
    return client.post("/api/v1/customers", headers=admin, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _points_balance(client, admin, cust_id):
    return Decimal(client.get(f"/api/v1/customers/{cust_id}/points", headers=admin).json()["balance"])


def _on_hand(Session, item_id, custody_id):
    s = Session()
    try:
        return stock_service.on_hand(s, item_id=item_id, location_kind=LocationKind.custody,
                                     location_id=custody_id)
    finally:
        s.close()


def test_standalone_return_raises_stock_credits_customer_reverses_points(
    client, inv_world, login, Session):
    admin = login("admin")
    asales = login("asales")
    prod = client.post("/api/v1/items", headers=admin, json={
        "name": "Valve", "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()
    _set_points(client, asales, prod["id"], 5)
    cust = _customer(client, admin, inv_world)
    _seed_custody(client, admin, prod["id"], inv_world["custody_a"], "10")

    rep = login("rep_a")
    # Sell 4 → stock 10-4=6, points +20, customer owes 400 (all credit).
    sale = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "400",
        "lines": [{"item_id": prod["id"], "quantity": "4"}]})
    assert sale.status_code == 201, sale.text
    assert _on_hand(Session, prod["id"], inv_world["custody_a"]) == Decimal("6.000")
    assert _points_balance(client, admin, cust["id"]) == Decimal("20.000")

    # The last-price endpoint offers the effective price paid (100).
    hist = client.get("/api/v1/sales/customer-item-history", headers=rep,
                      params={"customer_id": cust["id"], "item_id": prod["id"]}).json()
    assert hist["last_price"] == "100.00"
    assert len(hist["history"]) == 1

    # Standalone return of 2 at that price, credited to the customer (reduce their debt).
    ret = client.post("/api/v1/sales/returns", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_refund": "0", "credit_reduction": "200",
        "lines": [{"item_id": prod["id"], "quantity": "2", "unit_price": hist["last_price"]}]})
    assert ret.status_code == 201, ret.text
    body = ret.json()
    assert body["document_number"].startswith("SRET-")
    assert Decimal(body["net"]) == Decimal("200.00")
    assert Decimal(body["credit_reduction"]) == Decimal("200.00")

    # Goods back in stock: 6 + 2 = 8. Points removed: 20 - 10 = 10.
    assert _on_hand(Session, prod["id"], inv_world["custody_a"]) == Decimal("8.000")
    assert _points_balance(client, admin, cust["id"]) == Decimal("10.000")

    # It shows up in the standalone returns list.
    lst = client.get("/api/v1/sales/returns", headers=rep,
                     params={"customer_id": cust["id"]}).json()
    assert any(r["document_number"] == body["document_number"] for r in lst)


def test_standalone_return_balance_must_match(client, inv_world, login):
    admin = login("admin")
    prod = client.post("/api/v1/items", headers=admin, json={
        "name": "Nipple", "kind": "product", "unit_of_measure": "piece", "sale_price": "50"}).json()
    cust = _customer(client, admin, inv_world)
    _seed_custody(client, admin, prod["id"], inv_world["custody_a"], "5")
    rep = login("rep_a")
    # 2 × 50 = 100 net, but only 90 accounted for → rejected.
    resp = client.post("/api/v1/sales/returns", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_refund": "0", "credit_reduction": "90",
        "lines": [{"item_id": prod["id"], "quantity": "2", "unit_price": "50"}]})
    assert resp.status_code == 422
