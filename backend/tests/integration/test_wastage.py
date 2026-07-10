"""014: standalone wastage document — deducts stock, costed, reverse-once, no-negative."""
from decimal import Decimal


def _on_hand(client, h, item_id, loc):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": loc}).json()["on_hand"])


def test_wastage_document_deducts_stock_and_reverses(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    raw = client.post("/api/v1/items", headers=h, json={
        "name": "Cloth", "kind": "raw_material", "unit_of_measure": "m", "purchase_price": "5"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "S"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"], "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": raw["id"], "quantity": "20", "unit_price": "5"}]})

    doc = client.post("/api/v1/wastage", headers=h, json={
        "item_id": raw["id"], "warehouse_id": wh, "quantity": "3", "reason": "تلف"})
    assert doc.status_code == 201, doc.text
    body = doc.json()
    assert Decimal(body["total_cost"]) == Decimal("15.00")  # 3 × 5
    assert _on_hand(client, h, raw["id"], wh) == Decimal("17.000")

    # Cannot waste more than on-hand.
    assert client.post("/api/v1/wastage", headers=h, json={
        "item_id": raw["id"], "warehouse_id": wh, "quantity": "999"}).status_code == 409

    # Reverse restores stock; reverse-once.
    assert client.post(f"/api/v1/wastage/{body['id']}/reverse", headers=h).status_code == 201
    assert _on_hand(client, h, raw["id"], wh) == Decimal("20.000")
    assert client.post(f"/api/v1/wastage/{body['id']}/reverse", headers=h).status_code == 409
