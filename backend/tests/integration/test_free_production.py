"""انتاج حر — production without a stored recipe, as one document — 031-a5-restructure.

Their `/productions/free` is a screen of its own. Ours had the two halves in the API (`consume`
and `produce`) and no way to do them as one act, which is the difference between a production order
and two unrelated stock movements that happen to be near each other.
"""
from __future__ import annotations

from decimal import Decimal


def _raw(client, h, name, price="10"):
    return client.post("/api/v1/items", headers=h,
                       json={"name": name, "kind": "raw_material", "unit_of_measure": "piece",
                             "purchase_price": price}).json()


def _product(client, h, name="Widget"):
    return client.post("/api/v1/items", headers=h,
                       json={"name": name, "kind": "product", "unit_of_measure": "piece",
                             "sale_price": "500"}).json()


def _stock(client, h, item_id, wh, qty, price="10"):
    """Raw materials arrive by purchase — `produce` only accepts products."""
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": f"S{item_id}"}).json()
    total = str(int(qty) * float(price))
    res = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "lines": [{"item_id": item_id, "quantity": str(qty), "unit_price": price}],
        "cash_amount": "0", "credit_amount": total})
    assert res.status_code == 201, res.text


def _on_hand(client, h, item_id, wh):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": wh}).json()["on_hand"])


def test_free_order_consumes_what_was_stated_and_produces_the_product(client, inv_world, login):
    """One document: the stated materials leave stock and the product arrives, or neither happens."""
    h = login("admin")
    wh = inv_world["central_wh"]
    a, b = _raw(client, h, "A", "10"), _raw(client, h, "B", "5")
    prod = _product(client, h)
    _stock(client, h, a["id"], wh, 100)
    _stock(client, h, b["id"], wh, 100, "5")

    res = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "4",
        "location": {"location_kind": "warehouse", "location_id": wh},
        "components": [{"item_id": a["id"], "quantity": "12"},
                       {"item_id": b["id"], "quantity": "6"}],
    })
    assert res.status_code == 201, res.text
    order = res.json()

    assert order["bom_id"] is None, "a free order must not claim a recipe nobody wrote"
    assert _on_hand(client, h, a["id"], wh) == Decimal("88.000")
    assert _on_hand(client, h, b["id"], wh) == Decimal("94.000")
    assert _on_hand(client, h, prod["id"], wh) == Decimal("4.000")
    # Materials only: 12×10 + 6×5 = 150, with no recipe to borrow labour figures from.
    assert Decimal(order["total_cost"]) == Decimal("150.00")
    assert Decimal(order["unit_cost"]) == Decimal("37.50")


def test_stated_quantities_are_not_scaled(client, inv_world, login):
    """What somebody measured going in is what gets consumed — no factor applied to it."""
    h = login("admin")
    wh = inv_world["central_wh"]
    a = _raw(client, h, "A2", "10")
    prod = _product(client, h, "Widget2")
    _stock(client, h, a["id"], wh, 50)

    client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "10",   # ten produced …
        "location": {"location_kind": "warehouse", "location_id": wh},
        "components": [{"item_id": a["id"], "quantity": "7"}],   # … off seven consumed
    })
    assert _on_hand(client, h, a["id"], wh) == Decimal("43.000")


def test_free_order_reverses_like_any_other(client, inv_world, login):
    """Reversal reads the stored consumptions, so it never needed the recipe to begin with."""
    h = login("admin")
    wh = inv_world["central_wh"]
    a = _raw(client, h, "A3", "10")
    prod = _product(client, h, "Widget3")
    _stock(client, h, a["id"], wh, 30)

    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "2",
        "location": {"location_kind": "warehouse", "location_id": wh},
        "components": [{"item_id": a["id"], "quantity": "9"}],
    }).json()

    rev = client.post(f"/api/v1/manufacturing/orders/{order['id']}/reverse", headers=h)
    assert rev.status_code == 201, rev.text
    assert _on_hand(client, h, a["id"], wh) == Decimal("30.000")
    assert _on_hand(client, h, prod["id"], wh) == Decimal("0.000")


def test_free_order_refuses_the_shapes_that_would_read_wrong(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    a = _raw(client, h, "A4", "10")
    prod = _product(client, h, "Widget4")
    _stock(client, h, a["id"], wh, 50)
    base = {"product_id": prod["id"], "quantity": "1",
            "location": {"location_kind": "warehouse", "location_id": wh}}

    empty = client.post("/api/v1/manufacturing/orders", headers=h, json={**base, "components": []})
    assert empty.status_code == 409, "production out of nothing is not production"

    zero = client.post("/api/v1/manufacturing/orders", headers=h,
                       json={**base, "components": [{"item_id": a["id"], "quantity": "0"}]})
    assert zero.status_code == 409

    twice = client.post("/api/v1/manufacturing/orders", headers=h, json={
        **base, "components": [{"item_id": a["id"], "quantity": "1"},
                               {"item_id": a["id"], "quantity": "2"}]})
    assert twice.status_code == 409, "one item twice makes every per-line reading wrong"


def test_free_order_will_not_drive_stock_negative(client, inv_world, login):
    """Short on a component: nothing is consumed and nothing is produced."""
    h = login("admin")
    wh = inv_world["central_wh"]
    a = _raw(client, h, "A5", "10")
    prod = _product(client, h, "Widget5")
    _stock(client, h, a["id"], wh, 3)

    res = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "1",
        "location": {"location_kind": "warehouse", "location_id": wh},
        "components": [{"item_id": a["id"], "quantity": "10"}],
    })
    assert res.status_code == 409
    assert _on_hand(client, h, a["id"], wh) == Decimal("3.000")
    assert _on_hand(client, h, prod["id"], wh) == Decimal("0.000")


def test_recipe_orders_are_untouched(client, inv_world, login):
    """The recipe path must behave exactly as before — components is an addition, not a change."""
    h = login("admin")
    wh = inv_world["central_wh"]
    a = _raw(client, h, "A6", "10")
    prod = _product(client, h, "Widget6")
    _stock(client, h, a["id"], wh, 100)

    bom = client.post("/api/v1/manufacturing/boms", headers=h, json={
        "name": "وصفة Widget6", "product_id": prod["id"], "output_quantity": "1",
        "components": [{"item_id": a["id"], "quantity": "3"}]})
    assert bom.status_code == 201, bom.text

    order = client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "5",
        "location": {"location_kind": "warehouse", "location_id": wh}}).json()

    assert order["bom_id"] is not None
    assert _on_hand(client, h, a["id"], wh) == Decimal("85.000"), "5 × 3 scaled off the recipe"
