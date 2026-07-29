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


def test_a_recipe_component_can_be_written_in_a_larger_unit(client, inv_world, login):
    """نسب انتاج: كل خامة لها وحدة.

    A recipe used to be base units only, so «٢ كرتونة» had to be converted by hand into 24 pieces
    before it could be typed — the arithmetic 008 exists to remove, done in the place where getting
    it wrong silently over-consumes stock on every order ever made from that recipe.

    The unit is stored, not folded in on the way to the database: the recipe reads back the way it
    was written, and if the carton factor is ever corrected the recipe follows the correction.
    """
    h = login("admin")
    central = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": central}

    bolt = _mk(client, h, name="مسمار", kind="raw_material", unit_of_measure="pcs",
               purchase_price="1")
    widget = _mk(client, h, name="وحدة مجمّعة", kind="product", unit_of_measure="piece",
                 sale_price="100")
    # A carton of the bolt holds 12.
    units = client.put(f"/api/v1/items/{bolt['id']}/units", headers=h,
                       json={"units": [{"name": "carton", "factor": "12"}]})
    assert units.status_code == 200, units.text

    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": loc, "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": bolt["id"], "quantity": "100", "unit_price": "1"}]})

    bom = client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": widget["id"], "name": "وصفة بالكرتونة", "output_quantity": "1",
        "components": [{"item_id": bolt["id"], "quantity": "2", "unit": "carton"}]})
    assert bom.status_code == 201, bom.text
    comp = bom.json()["components"][0]
    assert comp["unit"] == "carton"
    assert Decimal(comp["unit_factor"]) == Decimal("12.000")
    # Read back as written — «٢ كرتونة», not «٢٤ قطعة».
    assert Decimal(comp["quantity"]) == Decimal("2.000")

    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": widget["id"], "quantity": "1", "location": loc})
    assert order.status_code == 201, order.text
    # 2 cartons × 12 = 24 pieces off a stock of 100.
    assert _on_hand(client, h, bolt["id"], "warehouse", central) == Decimal("76.000")
    assert Decimal(order.json()["total_cost"]) == Decimal("24.00")

    # And the reversal returns cartons, not pieces-that-were-cartons.
    rev = client.post(f"/api/v1/manufacturing/orders/{order.json()['id']}/reverse", headers=h)
    assert rev.status_code == 201, rev.text
    assert _on_hand(client, h, bolt["id"], "warehouse", central) == Decimal("100.000")


def test_a_recipe_cannot_be_saved_with_a_unit_the_item_does_not_have(client, inv_world, login):
    """Caught at save time — a bad unit stored now would fail every order made from the recipe later."""
    h = login("admin")
    bolt = _mk(client, h, name="مسمار ٢", kind="raw_material", unit_of_measure="pcs",
               purchase_price="1")
    widget = _mk(client, h, name="وحدة ٢", kind="product", unit_of_measure="piece",
                 sale_price="100")
    resp = client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": widget["id"], "name": "وصفة بوحدة غلط", "output_quantity": "1",
        "components": [{"item_id": bolt["id"], "quantity": "2", "unit": "pallet"}]})
    assert resp.status_code == 409, resp.text


def test_a_recipe_without_units_still_consumes_base_units(client, inv_world, login):
    """Every recipe written before the column existed keeps meaning exactly what it meant."""
    h = login("admin")
    central = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": central}
    raw = _mk(client, h, name="خام بسيط", kind="raw_material", unit_of_measure="kg",
              purchase_price="5")
    prod = _mk(client, h, name="منتج بسيط", kind="product", unit_of_measure="piece",
               sale_price="50")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد ب"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": loc, "cash_amount": "50", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "10", "unit_price": "5"}]})
    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": prod["id"], "name": "وصفة بدون وحدة", "output_quantity": "1",
        "components": [{"item_id": raw["id"], "quantity": "3"}]})
    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "1", "location": loc})
    assert order.status_code == 201, order.text
    assert _on_hand(client, h, raw["id"], "warehouse", central) == Decimal("7.000")


def test_a_production_order_carries_its_own_date_branch_work_order_and_notes(
    client, inv_world, login
):
    """حقول مستند الإنتاج، من شاشة «انتاج حسب النسب» عندهم.

    The date matters most: a workshop closes a batch in the evening and the office types it the next
    morning. Dating the document by entry would put the output in the wrong day on every production
    report, and nobody notices until a closed month is reconciled.
    """
    from datetime import date, timedelta

    h = login("admin")
    central = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": central}
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    raw = _mk(client, h, name="خام المستند", kind="raw_material", unit_of_measure="kg",
              purchase_price="4")
    prod = _mk(client, h, name="منتج المستند", kind="product", unit_of_measure="piece",
               sale_price="40")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد المستند"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": loc, "cash_amount": "40", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "10", "unit_price": "4"}]})
    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": prod["id"], "name": "وصفة المستند", "output_quantity": "1",
        "components": [{"item_id": raw["id"], "quantity": "2"}]})

    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "1", "location": loc,
        "production_date": yesterday, "branch_id": inv_world["branch_a"],
        "work_order_ref": "WO-2026-114", "notes": "ورد الوردية الليلية"})
    assert order.status_code == 201, order.text
    body = order.json()
    assert body["production_date"] == yesterday
    assert body["branch_id"] == inv_world["branch_a"]
    assert body["work_order_ref"] == "WO-2026-114"
    assert body["notes"] == "ورد الوردية الليلية"

    # And they survive the round trip through the list, which is where they get read.
    listed = next(o for o in client.get("/api/v1/manufacturing/orders", headers=h).json()
                  if o["id"] == body["id"])
    assert listed["work_order_ref"] == "WO-2026-114"
    assert listed["production_date"] == yesterday


def test_a_production_order_without_a_date_is_dated_today(client, inv_world, login):
    """Never NULL: a report that groups by day would otherwise have to guess."""
    from datetime import date

    h = login("admin")
    central = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": central}
    raw = _mk(client, h, name="خام اليوم", kind="raw_material", unit_of_measure="kg",
              purchase_price="4")
    prod = _mk(client, h, name="منتج اليوم", kind="product", unit_of_measure="piece",
               sale_price="40")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد اليوم"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": loc, "cash_amount": "40", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "10", "unit_price": "4"}]})
    client.post("/api/v1/manufacturing/boms", headers=h, json={
        "product_id": prod["id"], "name": "وصفة اليوم", "output_quantity": "1",
        "components": [{"item_id": raw["id"], "quantity": "2"}]})
    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "1", "location": loc})
    assert order.status_code == 201, order.text
    assert order.json()["production_date"] == date.today().isoformat()
