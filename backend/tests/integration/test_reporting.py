"""014: reporting engine accuracy — production, inventory, wastage, stagnant, sales."""
from decimal import Decimal


def _item(client, h, **kw):
    return client.post("/api/v1/items", headers=h, json=kw).json()


def _stock_raw(client, h, item_id, wh, qty, price="10"):
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": f"S{item_id}"}).json()
    total = str(Decimal(qty) * Decimal(price))
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": total, "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": qty, "unit_price": price}]})


def test_inventory_report_balances(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    raw = _item(client, h, name="R", kind="raw_material", unit_of_measure="kg",
                purchase_price="10", default_warehouse_id=wh)
    _stock_raw(client, h, raw["id"], wh, "50")
    rep = client.get("/api/v1/reports/inventory", headers=h, params={"warehouse_id": wh}).json()
    row = next(r for r in rep["rows"] if r["item_id"] == raw["id"])
    assert row["on_hand"] == "50.000" and row["value"] == "500.00"


def test_production_report(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    raw = _item(client, h, name="R2", kind="raw_material", unit_of_measure="kg",
                purchase_price="10", default_warehouse_id=wh)
    prod = _item(client, h, name="P2", kind="product", unit_of_measure="pc",
                 sale_price="100", default_warehouse_id=wh)
    _stock_raw(client, h, raw["id"], wh, "50")
    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": prod["id"], "name": "r", "output_quantity": "1",
        "components": [{"item_id": raw["id"], "quantity": "2"}],
        "resources": [{"kind": "labor", "name": "l", "quantity": "1", "rate": "5"}]})
    client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "3",
        "location": {"location_kind": "warehouse", "location_id": wh}})
    rep = client.get("/api/v1/reports/production", headers=h).json()
    row = next(r for r in rep["rows"] if r["product_id"] == prod["id"])
    assert row["produced_quantity"] == "3.000"
    assert row["consumed_quantity"] == "6.000"   # 2 × 3
    assert row["material_cost"] == "60.00" and row["resource_cost"] == "15.00"


def test_wastage_report_combines_order_and_document(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    raw = _item(client, h, name="R3", kind="raw_material", unit_of_measure="kg",
                purchase_price="10", default_warehouse_id=wh)
    prod = _item(client, h, name="P3", kind="product", unit_of_measure="pc",
                 sale_price="100", default_warehouse_id=wh)
    _stock_raw(client, h, raw["id"], wh, "100")
    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": prod["id"], "name": "r", "output_quantity": "1",
        "components": [{"item_id": raw["id"], "quantity": "10"}]})
    # order with 2 kg waste
    client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "1",
        "location": {"location_kind": "warehouse", "location_id": wh},
        "wastes": [{"item_id": raw["id"], "quantity": "2"}]})
    # standalone wastage doc: 3 kg
    client.post("/api/v1/wastage", headers=h, json={
        "item_id": raw["id"], "warehouse_id": wh, "quantity": "3"})
    rep = client.get("/api/v1/reports/wastage", headers=h, params={"item_id": raw["id"]}).json()
    assert rep["total_quantity"] == "5.000"      # 2 (order) + 3 (doc)
    assert rep["total_cost"] == "50.00"          # 5 × 10
    assert {r["source"] for r in rep["rows"]} == {"manufacturing", "document"}


def test_stagnant_flags_unmoved_stock_only(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    stagnant = _item(client, h, name="OLD", kind="raw_material", unit_of_measure="kg",
                     purchase_price="10", default_warehouse_id=wh)
    moving = _item(client, h, name="NEW", kind="raw_material", unit_of_measure="kg",
                   purchase_price="10", default_warehouse_id=wh)
    _stock_raw(client, h, stagnant["id"], wh, "20")   # purchased, never moved out
    _stock_raw(client, h, moving["id"], wh, "20")
    client.post("/api/v1/wastage", headers=h, json={   # a recent OUT movement for `moving`
        "item_id": moving["id"], "warehouse_id": wh, "quantity": "1"})
    rep = client.get("/api/v1/reports/stagnant", headers=h, params={"days": 30}).json()
    ids = {r["item_id"] for r in rep["rows"]}
    assert stagnant["id"] in ids       # no out movement -> stagnant
    assert moving["id"] not in ids     # moved out recently -> not stagnant


def test_sales_report_reflects_a_sale(client, inv_world, login, db):
    from tests.conftest import make_customer_with_account
    h = login("admin")
    wh = inv_world["central_wh"]
    prod = _item(client, h, name="SP", kind="product", unit_of_measure="pc", sale_price="50")
    # Products are purchasable now — stock the product, then sell it.
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "SS"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "2", "unit_price": "50"}]})
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"])
    db.commit()
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust.id, "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "50", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "1", "unit_price": "50"}]})
    assert sale.status_code == 201, sale.text
    rep = client.get("/api/v1/reports/sales", headers=h).json()
    assert Decimal(rep["gross_total"]) == Decimal("50.00")
    assert len(rep["by_period"]) == 1
