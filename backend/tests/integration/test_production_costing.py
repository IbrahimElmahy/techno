"""014: manufacturing order with resource costing, inventory routing, and waste."""
from decimal import Decimal


def _on_hand(client, h, item_id, loc):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": loc}).json()["on_hand"])


def _item(client, h, **kw):
    return client.post("/api/v1/items", headers=h, json=kw).json()


def test_order_routes_per_item_and_costs_materials_plus_resources(client, inv_world, login):
    h = login("admin")
    wh_raw = inv_world["central_wh"]
    wh_prod = inv_world["branch_wh"]

    # Steel is stored in the raw warehouse; the widget is produced into the product warehouse.
    steel = _item(client, h, name="Steel", kind="raw_material", unit_of_measure="kg",
                  purchase_price="10", default_warehouse_id=wh_raw)
    widget = _item(client, h, name="Widget", kind="product", unit_of_measure="pc",
                   sale_price="100", default_warehouse_id=wh_prod)

    # Stock steel in its warehouse.
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": {"location_kind": "warehouse", "location_id": wh_raw},
        "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": steel["id"], "quantity": "50", "unit_price": "10"}]})

    # Recipe: 1 batch → 5 widgets, using 2 kg steel + 3 labor hours @ 20.
    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": widget["id"], "name": "r", "output_quantity": "5",
        "components": [{"item_id": steel["id"], "quantity": "2"}],
        "resources": [{"kind": "labor", "name": "تشغيل", "quantity": "3", "rate": "20"}]})

    # Produce 10 → scale 2 → consume 4 kg steel; labor 6h × 20 = 120; material 4×10 = 40.
    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": widget["id"], "quantity": "10",
        "location": {"location_kind": "warehouse", "location_id": wh_raw}}).json()

    assert Decimal(order["material_cost"]) == Decimal("40.00")
    assert Decimal(order["resource_cost"]) == Decimal("120.00")
    assert Decimal(order["total_cost"]) == Decimal("160.00")
    assert Decimal(order["unit_cost"]) == Decimal("16.00")
    # Routing: steel left the RAW warehouse; widget landed in the PRODUCT warehouse — not the order loc.
    assert _on_hand(client, h, steel["id"], wh_raw) == Decimal("46.000")
    assert _on_hand(client, h, widget["id"], wh_prod) == Decimal("10.000")
    assert _on_hand(client, h, widget["id"], wh_raw) == Decimal("0.000")
    assert order["consumptions"][0]["warehouse_id"] == wh_raw


def test_order_resource_override_and_waste(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    steel = _item(client, h, name="Steel2", kind="raw_material", unit_of_measure="kg",
                  purchase_price="10", default_warehouse_id=wh)
    widget = _item(client, h, name="Widget2", kind="product", unit_of_measure="pc",
                   sale_price="100", default_warehouse_id=wh)
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Acme2"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": steel["id"], "quantity": "50", "unit_price": "10"}]})
    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": widget["id"], "name": "r", "output_quantity": "1",
        "components": [{"item_id": steel["id"], "quantity": "5"}],
        "resources": [{"kind": "machine", "name": "مكنة", "quantity": "1", "rate": "10"}]})

    # Override resources (actual labor higher) + record 1 kg waste of the 5 consumed.
    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": widget["id"], "quantity": "1",
        "location": {"location_kind": "warehouse", "location_id": wh},
        "resources": [{"kind": "machine", "name": "مكنة", "quantity": "2", "rate": "10"}],
        "wastes": [{"item_id": steel["id"], "quantity": "1"}]}).json()
    assert Decimal(order["resource_cost"]) == Decimal("20.00")   # 2 × 10 (override, not recipe's 1×10)
    assert Decimal(order["consumptions"][0]["waste_quantity"]) == Decimal("1.000")
