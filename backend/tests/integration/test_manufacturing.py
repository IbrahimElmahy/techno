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
