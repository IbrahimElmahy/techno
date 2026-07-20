"""Review-screen parity (015 follow-up): certificate sequence, reject-not-delete,
معاينة/مرمة reclassification, print tracking, and the legacy filters."""
from __future__ import annotations


def _payload(**over):
    base = {
        "visit_kind": "technician", "inspection_date": "2026-07-20",
        "owner_name": "مالك المراجعة", "technician_name": "فني محمد",
        "purchase_shop": "محمود ناصر",
        "items": [{"item_name": "خلاط", "quantity": "1", "points": "2"}],
    }
    base.update(over)
    return base


def test_certificate_sequence_continues_legacy_numbers(client, world, login):
    h = login("rep_a")
    r1 = client.post("/api/v1/inspections", json=_payload(), headers=h).json()
    r2 = client.post("/api/v1/inspections", json=_payload(owner_name="تاني"), headers=h).json()
    assert r1["certificate_number"] == 156205  # continues the client's paper sequence
    assert r2["certificate_number"] == 156206
    assert r1["status"] == "accepted" and r1["visit_type"] == "معاينة" and not r1["printed"]


def test_reviewer_reclassifies_visit_type_rep_cannot(client, world, login):
    rep = login("rep_a")
    iid = client.post("/api/v1/inspections", json=_payload(), headers=rep).json()["id"]
    assert client.patch(f"/api/v1/inspections/{iid}",
                        json={"visit_type": "مرمة"}, headers=rep).status_code == 403
    r = client.patch(f"/api/v1/inspections/{iid}",
                     json={"visit_type": "مرمة"}, headers=login("sm_a"))
    assert r.status_code == 200 and r.json()["visit_type"] == "مرمة"


def test_reject_marks_rejected_and_returns_rep_stock(client, world, login, db):
    from src.models.catalog import Item, ItemKind
    from src.models.stock import LocationKind, StockDirection
    from src.models.warehouse import Custody, HolderType
    from src.services import stock_service

    item = Item(code="PR-910001", name="صنف رفض", kind=ItemKind.product,
                unit_of_measure="قطعة", sale_price=10)
    custody = Custody(holder_type=HolderType.rep, rep_id=world["rep_a"])
    db.add_all([item, custody])
    db.flush()
    stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.custody, location_id=custody.id,
        movement_type="transfer_in", direction=StockDirection.in_, quantity=5,
        actor_user_id=world["admin"], source_doc_type="test", source_doc_id=9)
    db.commit()

    rep = login("rep_a")
    iid = client.post("/api/v1/inspections", json=_payload(
        items=[{"item_id": item.id, "item_name": "x", "quantity": "3", "points": "1"}]),
        headers=rep).json()["id"]
    stock = client.get("/api/v1/inspections/my-stock", headers=rep).json()
    assert stock[0]["quantity"] == "2.000"

    admin = login("admin")
    r = client.post(f"/api/v1/inspections/{iid}/reject", headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    stock = client.get("/api/v1/inspections/my-stock", headers=rep).json()
    assert stock[0]["quantity"] == "5.000"  # goods returned

    # Reject-once — a second reject must not double-return stock.
    assert client.post(f"/api/v1/inspections/{iid}/reject", headers=admin).status_code == 409
    # Deleting the rejected inspection must not return stock again either.
    assert client.delete(f"/api/v1/inspections/{iid}", headers=admin).status_code == 204
    stock = client.get("/api/v1/inspections/my-stock", headers=rep).json()
    assert stock[0]["quantity"] == "5.000"


def test_mark_printed_and_filters(client, world, login):
    rep, admin = login("rep_a"), login("admin")
    a = client.post("/api/v1/inspections", json=_payload(owner_name="أول عميل"),
                    headers=rep).json()
    client.post("/api/v1/inspections", json=_payload(
        owner_name="تاني عميل", technician_name="فني حسن", purchase_shop="شعبان هنداوى"),
        headers=rep)

    r = client.post(f"/api/v1/inspections/{a['id']}/mark-printed", headers=admin)
    assert r.status_code == 200 and r.json()["printed"] is True

    def names(query):
        return [i["owner_name"]
                for i in client.get(f"/api/v1/inspections?{query}", headers=admin).json()]

    assert names("printed=true") == ["أول عميل"]
    assert names("printed=false") == ["تاني عميل"]
    assert names("owner=تاني") == ["تاني عميل"]
    assert names("technician=حسن") == ["تاني عميل"]
    assert names("trader=شعبان") == ["تاني عميل"]
    assert names(f"certificate_number={a['certificate_number']}") == ["أول عميل"]
    assert names("status=accepted") == ["تاني عميل", "أول عميل"]

    client.post(f"/api/v1/inspections/{a['id']}/reject", headers=admin)
    assert names("status=rejected") == ["أول عميل"]


def test_visit_type_lookup_seeded(client, world, login):
    r = client.get("/api/v1/settings/lookups?category=visit_type", headers=login("admin"))
    assert r.status_code == 200
    assert {"معاينة", "مرمة"} <= {o["value"] for o in r.json()}
