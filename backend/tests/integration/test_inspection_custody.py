"""Inspections × rep custody (015 follow-up): holdings endpoint, deduction, no-negative,
reversal on delete, and no effect for reps without a custody."""
from __future__ import annotations

import pytest


@pytest.fixture()
def loaded_rep(client, world, login, db):
    """rep_a with a custody holding 5 units of one product; returns ids + headers."""
    from src.models.catalog import Item, ItemKind
    from src.models.stock import LocationKind, StockDirection
    from src.models.warehouse import Custody, HolderType
    from src.services import stock_service

    item = Item(code="PR-900001", name="بطارية اختبار", kind=ItemKind.product,
                unit_of_measure="قطعة", sale_price=100)
    db.add(item)
    custody = Custody(holder_type=HolderType.rep, rep_id=world["rep_a"])
    db.add(custody)
    db.flush()
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.custody, location_id=custody.id,
        movement_type="transfer_in", direction=StockDirection.in_, quantity=5,
        actor_user_id=world["admin"], source_doc_type="test", source_doc_id=1)
    db.commit()
    return {"item_id": item.id, "custody_id": custody.id, "rep": login("rep_a"),
            "admin": login("admin")}


def _payload(item_id, qty):
    return {
        "visit_kind": "technician", "inspection_date": "2026-07-20",
        "owner_name": "عميل عهدة",
        "items": [{"item_id": item_id, "item_name": "x", "quantity": str(qty), "points": "1"}],
    }


def _my_stock(client, headers):
    r = client.get("/api/v1/inspections/my-stock", headers=headers)
    assert r.status_code == 200, r.text
    return {row["item_id"]: float(row["quantity"]) for row in r.json()}


def test_my_stock_reflects_custody(client, loaded_rep):
    assert _my_stock(client, loaded_rep["rep"]) == {loaded_rep["item_id"]: 5.0}
    # Admin holds no custody -> empty (app falls back to the full catalog).
    assert _my_stock(client, loaded_rep["admin"]) == {}


def test_inspection_deducts_from_custody(client, loaded_rep):
    r = client.post("/api/v1/inspections",
                    json=_payload(loaded_rep["item_id"], 2), headers=loaded_rep["rep"])
    assert r.status_code == 201, r.text
    assert _my_stock(client, loaded_rep["rep"]) == {loaded_rep["item_id"]: 3.0}


def test_no_negative_custody_stock_rejects_sync(client, loaded_rep):
    batch = {"inspections": [
        {**_payload(loaded_rep["item_id"], 9), "client_uuid": "uuid-over"}]}
    r = client.post("/api/v1/inspections/sync", json=batch, headers=loaded_rep["rep"])
    assert r.status_code == 409
    assert "غير كاف" in r.json()["detail"]["message"]
    # Nothing was recorded and stock is untouched.
    assert client.get("/api/v1/inspections", headers=loaded_rep["rep"]).json() == []
    assert _my_stock(client, loaded_rep["rep"]) == {loaded_rep["item_id"]: 5.0}


def test_admin_delete_returns_stock_to_custody(client, loaded_rep):
    r = client.post("/api/v1/inspections",
                    json=_payload(loaded_rep["item_id"], 4), headers=loaded_rep["rep"])
    assert r.status_code == 201
    assert _my_stock(client, loaded_rep["rep"]) == {loaded_rep["item_id"]: 1.0}
    iid = r.json()["id"]
    assert client.delete(f"/api/v1/inspections/{iid}",
                         headers=loaded_rep["admin"]).status_code == 204
    assert _my_stock(client, loaded_rep["rep"]) == {loaded_rep["item_id"]: 5.0}


def test_warehouse_linked_custody_deducts_from_that_warehouse(client, world, login, db):
    """Custody linked to a car warehouse -> holdings and deduction run against the warehouse."""
    from src.models.catalog import Item, ItemKind
    from src.models.stock import LocationKind, StockDirection
    from src.models.warehouse import Custody, HolderType, Warehouse, WarehouseType
    from src.services import stock_service

    wh = Warehouse(name="مخزن السياره ب", warehouse_type=WarehouseType.central)
    item = Item(code="PR-900003", name="صنف عربية", kind=ItemKind.product,
                unit_of_measure="قطعة", sale_price=50)
    db.add_all([wh, item])
    db.flush()
    db.add(Custody(holder_type=HolderType.rep, rep_id=world["rep_b"], warehouse_id=wh.id))
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse, location_id=wh.id,
        movement_type="transfer_in", direction=StockDirection.in_, quantity=10,
        actor_user_id=world["admin"], source_doc_type="test", source_doc_id=2)
    db.commit()

    h = login("rep_b")
    assert _my_stock(client, h) == {item.id: 10.0}
    r = client.post("/api/v1/inspections", json=_payload(item.id, 4), headers=h)
    assert r.status_code == 201, r.text
    assert _my_stock(client, h) == {item.id: 6.0}
    # The warehouse itself lost the stock (movements at warehouse location).
    on_hand = stock_service.on_hand(db, item.id, LocationKind.warehouse, wh.id)
    assert float(on_hand) == 6.0


def test_rep_without_custody_posts_no_movements(client, world, login, db):
    from src.models.catalog import Item, ItemKind

    item = Item(code="PR-900002", name="صنف بلا عهدة", kind=ItemKind.product,
                unit_of_measure="قطعة", sale_price=10)
    db.add(item)
    db.commit()
    h = login("rep_b")  # rep_b has no custody
    r = client.post("/api/v1/inspections", json=_payload(item.id, 3), headers=h)
    assert r.status_code == 201, r.text
    from sqlalchemy import select

    from src.models.stock import StockMovement
    assert db.scalars(select(StockMovement).where(
        StockMovement.movement_type == "inspection_out")).all() == []
