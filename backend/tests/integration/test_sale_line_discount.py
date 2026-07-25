"""Per-line discounts on a sale — item fixed + typed variable, then invoice-total discount (027)."""
from decimal import Decimal

from src.models.sales import SalesInvoiceLine


def _customer(client, h, rep_id, terr_id):
    return client.post("/api/v1/customers", headers=h,
                       json={"name": "K", "customer_type": "trader", "rep_id": rep_id,
                             "territory_id": terr_id}).json()


def _seed(client, h, item_id, custody_id, qty):
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def test_item_fixed_discount_applies_automatically(client, inv_world, login, Session):
    admin = login("admin")
    # The product carries its own 10% fixed discount.
    prod = client.post("/api/v1/items", headers=admin, json={
        "name": "Elbow", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100", "default_discount_pct": "10"}).json()
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"])
    _seed(client, admin, prod["id"], inv_world["custody_a"], "5")

    rep = login("rep_a")
    # No discount sent on the line → the item's 10% fixed discount is used.
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": "270", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert resp.status_code == 201, resp.text
    # 3 × 100 = 300, − 10% line discount = 270.
    assert Decimal(resp.json()["net"]) == Decimal("270.00")
    s = Session()
    line = s.query(SalesInvoiceLine).first()
    assert Decimal(line.discount_pct) == Decimal("10.00")
    assert Decimal(line.line_total) == Decimal("270.00")
    s.close()


def test_line_discount_then_invoice_discount_compound(client, inv_world, login):
    admin = login("admin")
    prod = client.post("/api/v1/items", headers=admin, json={
        "name": "Tee", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100", "default_discount_pct": "10"}).json()
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"])
    _seed(client, admin, prod["id"], inv_world["custody_a"], "5")

    rep = login("rep_a")
    # Line discount 25 (10 fixed + 15 variable) → line 3×100×0.75 = 225.
    # Then invoice-total discount 10% → net 202.50.
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "10", "cash_amount": "202.5", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "3", "discount_pct": "25"}]})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert Decimal(body["gross"]) == Decimal("225.00")   # after the line discount
    assert Decimal(body["net"]) == Decimal("202.50")     # after the invoice discount


def test_line_discount_rejected_when_out_of_range(client, inv_world, login):
    admin = login("admin")
    prod = client.post("/api/v1/items", headers=admin, json={
        "name": "Pipe", "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"])
    _seed(client, admin, prod["id"], inv_world["custody_a"], "5")

    rep = login("rep_a")
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "3", "discount_pct": "150"}]})
    assert resp.status_code == 422
