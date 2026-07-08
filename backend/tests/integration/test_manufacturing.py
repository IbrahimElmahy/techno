"""T031: decoupled consume/produce + reversal. FR-013–016; SC-003; US3."""
from decimal import Decimal


def _on_hand(client, h, item_id, kind, loc):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h,
                   params={"item_id": item_id, "location_kind": kind, "location_id": loc}).json()["on_hand"])


def test_consume_and_produce_independent_and_reversible(client, inv_world, login):
    h = login("admin")
    central = inv_world["central_wh"]
    raw = client.post("/api/v1/items", headers=h,
                      json={"name": "Steel", "kind": "raw_material", "unit_of_measure": "kg",
                            "purchase_price": "10"}).json()
    prod = client.post("/api/v1/items", headers=h,
                       json={"name": "Gadget", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": {"location_kind": "warehouse", "location_id": central},
        "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "50", "unit_price": "10"}]})

    # Consume 30 raw — independent of any production.
    cons = client.post("/api/v1/manufacturing/consume", headers=h, json={
        "item_id": raw["id"], "location": {"location_kind": "warehouse", "location_id": central},
        "quantity": "30"})
    assert cons.status_code == 201
    assert _on_hand(client, h, raw["id"], "warehouse", central) == Decimal("20.000")

    # Produce 10 product — independent, no linkage.
    prodop = client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": prod["id"], "location": {"location_kind": "warehouse", "location_id": central},
        "quantity": "10"})
    assert prodop.status_code == 201
    assert _on_hand(client, h, prod["id"], "warehouse", central) == Decimal("10.000")

    # No-negative on consume.
    assert client.post("/api/v1/manufacturing/consume", headers=h, json={
        "item_id": raw["id"], "location": {"location_kind": "warehouse", "location_id": central},
        "quantity": "60"}).status_code == 409

    # Reverse the consumption → raw back to 50.
    rev = client.post(f"/api/v1/manufacturing/{cons.json()['id']}/reverse", headers=h)
    assert rev.status_code == 201
    assert _on_hand(client, h, raw["id"], "warehouse", central) == Decimal("50.000")
    # Reverse the production → product back to 0.
    client.post(f"/api/v1/manufacturing/{prodop.json()['id']}/reverse", headers=h)
    assert _on_hand(client, h, prod["id"], "warehouse", central) == Decimal("0.000")
    # Reverse-once.
    assert client.post(f"/api/v1/manufacturing/{cons.json()['id']}/reverse", headers=h).status_code == 409


def _mk(client, h, **kw):
    return client.post("/api/v1/items", headers=h, json=kw).json()


def test_bom_manufacturing_order_cost_stock_and_reverse(client, inv_world, login):
    """012: a recipe-driven order consumes components (scaled) + produces the product, with cost."""
    h = login("admin")
    central = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": central}

    steel = _mk(client, h, name="Steel", kind="raw_material", unit_of_measure="kg", purchase_price="10")
    bolt = _mk(client, h, name="Bolt", kind="raw_material", unit_of_measure="pcs", purchase_price="2")
    widget = _mk(client, h, name="Widget", kind="product", unit_of_measure="piece", sale_price="100")

    # Stock the raw materials.
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": loc, "cash_amount": "700", "credit_amount": "0",
        "lines": [{"item_id": steel["id"], "quantity": "50", "unit_price": "10"},
                  {"item_id": bolt["id"], "quantity": "100", "unit_price": "2"}]})

    # Recipe: 1 batch yields 5 widgets, consuming 2 kg steel + 8 bolts.
    bom = client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": widget["id"], "name": "Widget recipe", "output_quantity": "5",
        "components": [{"item_id": steel["id"], "quantity": "2"},
                       {"item_id": bolt["id"], "quantity": "8"}]})
    assert bom.status_code == 201, bom.text

    # Produce 10 widgets → scale 2× → consume 4 kg steel + 16 bolts.
    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": widget["id"], "quantity": "10", "location": loc})
    assert order.status_code == 201, order.text
    body = order.json()
    # Cost = 4×10 + 16×2 = 72; unit = 7.20.
    assert Decimal(body["total_cost"]) == Decimal("72.00")
    assert Decimal(body["unit_cost"]) == Decimal("7.20")
    assert _on_hand(client, h, steel["id"], "warehouse", central) == Decimal("46.000")
    assert _on_hand(client, h, bolt["id"], "warehouse", central) == Decimal("84.000")
    assert _on_hand(client, h, widget["id"], "warehouse", central) == Decimal("10.000")

    # It appears in the persistent list.
    assert any(o["id"] == body["id"] for o in
               client.get("/api/v1/manufacturing/orders", headers=h).json())

    # Reverse → components restored, product removed.
    rev = client.post(f"/api/v1/manufacturing/orders/{body['id']}/reverse", headers=h)
    assert rev.status_code == 201, rev.text
    assert _on_hand(client, h, steel["id"], "warehouse", central) == Decimal("50.000")
    assert _on_hand(client, h, bolt["id"], "warehouse", central) == Decimal("100.000")
    assert _on_hand(client, h, widget["id"], "warehouse", central) == Decimal("0.000")
    # Reverse-once.
    assert client.post(f"/api/v1/manufacturing/orders/{body['id']}/reverse",
                       headers=h).status_code == 409


def test_manufacturing_order_requires_recipe_and_enough_stock(client, inv_world, login):
    h = login("admin")
    central = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": central}
    steel = _mk(client, h, name="Steel2", kind="raw_material", unit_of_measure="kg", purchase_price="10")
    widget = _mk(client, h, name="Widget2", kind="product", unit_of_measure="piece", sale_price="100")

    # No recipe yet → 409.
    assert client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": widget["id"], "quantity": "1", "location": loc}).status_code == 409

    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": widget["id"], "name": "r", "output_quantity": "1",
        "components": [{"item_id": steel["id"], "quantity": "5"}]})
    # Recipe exists but no steel in stock → no-negative blocks the order.
    assert client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": widget["id"], "quantity": "1", "location": loc}).status_code == 409
