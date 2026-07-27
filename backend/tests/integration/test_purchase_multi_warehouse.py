"""A purchase receives each line into its own warehouse — 030 (US4).

The mirror of the sale: goods arriving in one delivery may belong in different places, and a
purchase return has to take them back out of exactly where they were put, not out of whichever
warehouse happened to be on the document header.
"""
from decimal import Decimal

from src.models.stock import LocationKind
from src.services import stock_service


def _product(client, h, name):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()


def _supplier(client, h):
    return client.post("/api/v1/suppliers", headers=h, json={"name": "S"}).json()


def _on_hand(Session, item_id, loc_id):
    s = Session()
    try:
        return stock_service.on_hand(s, item_id=item_id,
                                     location_kind=LocationKind.warehouse, location_id=loc_id)
    finally:
        s.close()


def test_purchase_receives_each_line_into_its_own_warehouse(client, inv_world, login, Session):
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    a = _product(client, admin, "BuyA")
    b = _product(client, admin, "BuyB")
    sup = _supplier(client, admin)

    resp = client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": central},
        "cash_amount": "800", "credit_amount": "0",
        "lines": [
            {"item_id": a["id"], "quantity": "5", "unit_price": "100", "warehouse_id": central},
            {"item_id": b["id"], "quantity": "3", "unit_price": "100", "warehouse_id": branch},
        ],
        "external_document_number": "SUP-INV-9", "notes": "توريد جزئي"})
    assert resp.status_code == 201, resp.text

    assert _on_hand(Session, a["id"], central) == Decimal("5.000")
    assert _on_hand(Session, b["id"], branch) == Decimal("3.000")
    assert _on_hand(Session, b["id"], central) == Decimal("0.000")


def test_purchase_return_takes_goods_out_of_the_receiving_warehouse(
    client, inv_world, login, Session):
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    item = _product(client, admin, "BuyBack")
    sup = _supplier(client, admin)

    # Received into the BRANCH even though the document header says central.
    inv = client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": central},
        "cash_amount": "400", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "4", "unit_price": "100",
                   "warehouse_id": branch}]})
    assert inv.status_code == 201, inv.text
    assert _on_hand(Session, item["id"], branch) == Decimal("4.000")

    ret = client.post(f"/api/v1/purchases/{inv.json()['id']}/returns", headers=admin, json={
        "lines": [{"item_id": item["id"], "quantity": "3"}]})
    assert ret.status_code == 201, ret.text

    # Out of the branch (where it actually sat), not out of the header's central warehouse.
    assert _on_hand(Session, item["id"], branch) == Decimal("1.000")
    assert _on_hand(Session, item["id"], central) == Decimal("0.000")


def test_purchase_line_without_warehouse_uses_the_document(client, inv_world, login, Session):
    """Pre-030 callers that send no line warehouse keep their old behaviour."""
    admin = login("admin")
    central = inv_world["central_wh"]
    item = _product(client, admin, "BuyLegacy")
    sup = _supplier(client, admin)

    resp = client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": central},
        "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "100"}]})
    assert resp.status_code == 201, resp.text
    assert _on_hand(Session, item["id"], central) == Decimal("2.000")
