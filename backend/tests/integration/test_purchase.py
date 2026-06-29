"""T025: purchase split cash/credit → stock + payable; price snapshot; raw-only. FR-010–012."""
from decimal import Decimal

from src.models.purchasing import PurchaseInvoiceLine


def _raw(client, h):
    return client.post("/api/v1/items", headers=h,
                       json={"name": "Steel", "kind": "raw_material", "unit_of_measure": "kg",
                             "purchase_price": "10"}).json()


def _supplier(client, h):
    return client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()


def test_split_purchase_updates_stock_and_payable(client, inv_world, login, Session):
    h = login("admin")
    item = _raw(client, h)
    sup = _supplier(client, h)
    central = inv_world["central_wh"]
    resp = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": central},
        "cash_amount": "400", "credit_amount": "600",
        "lines": [{"item_id": item["id"], "quantity": "100", "unit_price": "10"}],
    })
    assert resp.status_code == 201, resp.text

    oh = client.get("/api/v1/stock/on-hand", headers=h,
                    params={"item_id": item["id"], "location_kind": "warehouse",
                            "location_id": central}).json()
    assert Decimal(oh["on_hand"]) == Decimal("100.000")
    acc = client.get(f"/api/v1/suppliers/{sup['id']}/account", headers=h).json()
    assert Decimal(acc["balance"]) == Decimal("600.00")

    # Price snapshot immutability: edit reference price; posted line stays at 10.
    client.patch(f"/api/v1/items/{item['id']}", headers=h, json={"purchase_price": "99"})
    s = Session()
    line = s.query(PurchaseInvoiceLine).first()
    assert Decimal(line.unit_price) == Decimal("10.00")
    s.close()


def test_product_cannot_be_purchased(client, inv_world, login):
    h = login("admin")
    prod = client.post("/api/v1/items", headers=h,
                       json={"name": "G", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": "50"}).json()
    sup = _supplier(client, h)
    resp = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "cash_amount": "50", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "1", "unit_price": "50"}],
    })
    assert resp.status_code == 409
