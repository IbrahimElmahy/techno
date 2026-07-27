"""The cost of goods is frozen at the moment of sale — 030 (US5).

Profit reports (أرباح فواتير · أرباح أصناف · هامش مبيعات) are only trustworthy if a past invoice's
profit stops moving. If cost were looked up at report time, buying the same item cheaper next month
would silently rewrite last month's margin. So each sold line stores the cost as it stood when it
was sold, and nothing later touches it.
"""
from decimal import Decimal

from src.models.sales import SalesInvoiceLine


def _product(client, h, name, purchase_price=None):
    body = {"name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}
    if purchase_price is not None:
        body["purchase_price"] = purchase_price
    return client.post("/api/v1/items", headers=h, json=body).json()


def _customer(client, h, inv_world):
    return client.post("/api/v1/customers", headers=h, json={
        "name": "C", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _buy(client, h, supplier_id, item_id, warehouse_id, qty, unit_price):
    """A real purchase — this is what moves the weighted-average cost."""
    return client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier_id,
        "location": {"location_kind": "warehouse", "location_id": warehouse_id},
        "cash_amount": str(Decimal(qty) * Decimal(unit_price)), "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": qty, "unit_price": unit_price}]})


def _supplier(client, h):
    return client.post("/api/v1/suppliers", headers=h, json={"name": "S"}).json()


def _line_costs(Session, invoice_id):
    s = Session()
    try:
        return [ln.unit_cost for ln in
                s.query(SalesInvoiceLine).filter(SalesInvoiceLine.invoice_id == invoice_id).all()]
    finally:
        s.close()


def test_cost_is_frozen_when_purchase_price_changes_later(client, inv_world, login, Session):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Frozen")
    sup = _supplier(client, admin)
    # Bought 10 @ 60 → average cost 60.
    assert _buy(client, admin, sup["id"], item["id"], wh, "10", "60").status_code == 201
    cust = _customer(client, admin, inv_world)

    sale = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "discount_pct": "0"}]})
    assert sale.status_code == 201, sale.text
    invoice_id = sale.json()["id"]
    assert _line_costs(Session, invoice_id) == [Decimal("60.00")]

    # Buying more, dearer, moves the average for FUTURE sales only.
    assert _buy(client, admin, sup["id"], item["id"], wh, "10", "90").status_code == 201
    assert _line_costs(Session, invoice_id) == [Decimal("60.00")], "past profit must not move"

    later = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "discount_pct": "0"}]})
    assert later.status_code == 201, later.text
    # 18 units bought for 60×10 + 90×10 = 1500 over 20 → 75 average at that moment.
    assert _line_costs(Session, later.json()["id"]) == [Decimal("75.00")]


def test_item_without_purchases_stores_zero_cost_explicitly(client, inv_world, login, Session):
    """A never-purchased item costs 0 — recorded as 0, not left unknown."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "NeverBought")
    # Stock exists without a purchase (produced in-house).
    client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": item["id"], "location": {"location_kind": "warehouse", "location_id": wh},
        "quantity": "5"})
    cust = _customer(client, admin, inv_world)

    sale = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "discount_pct": "0"}]})
    assert sale.status_code == 201, sale.text
    costs = _line_costs(Session, sale.json()["id"])
    assert costs == [Decimal("0.00")], "cost must be an explicit 0, never NULL, for new sales"


def test_return_mirrors_the_sale_unit_cost(client, inv_world, login, Session):
    """A return must reverse exactly the cost the sale booked, not today's average."""
    from src.models.sales import SalesReturnLine

    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Mirrored")
    sup = _supplier(client, admin)
    assert _buy(client, admin, sup["id"], item["id"], wh, "10", "40").status_code == 201
    cust = _customer(client, admin, inv_world)

    sale = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "400", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "4", "discount_pct": "0"}]})
    assert sale.status_code == 201, sale.text

    # Cost moves after the sale...
    assert _buy(client, admin, sup["id"], item["id"], wh, "10", "80").status_code == 201
    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=admin, json={
        "lines": [{"item_id": item["id"], "quantity": "2"}]})
    assert ret.status_code == 201, ret.text

    s = Session()
    try:
        costs = [ln.unit_cost for ln in
                 s.query(SalesReturnLine).filter(SalesReturnLine.return_id == ret.json()["id"]).all()]
    finally:
        s.close()
    assert costs == [Decimal("40.00")], "the return must carry the SALE's cost, not the new average"
