"""Site inspections / معاينات (015-inspections-mobile) — API + sync idempotency + rep scoping."""
from __future__ import annotations


def _payload(**over):
    base = {
        "visit_kind": "technician",
        "inspection_date": "2026-07-20",
        "owner_name": "أحمد محمد",
        "owner_phone": "01001234567",
        "national_id": "29001011234567",
        "owner_address": "شارع التحرير، الدقي",
        "floor_number": "3",
        "description": "حمام و مطبخ",
        "inspection_type": "تغذية و صرف",
        "technician_name": "سيد الفني",
        "technician_phone": "01109876543",
        "purchase_shop": "محل النور",
        "visit_details": "معاينة كاملة للشقة",
        "items": [
            {"item_name": "خلاط مياه", "quantity": "2", "points": "1.5"},
            {"item_name": "محبس", "quantity": "3", "points": "0.5"},
        ],
    }
    base.update(over)
    return base


def test_admin_manages_item_types(client, world, login):
    admin, rep = login("admin"), login("rep_a")
    # Add a new item.
    c = client.post("/api/v1/inspections/item-types", headers=admin,
                    json={"name": "صنف جديد", "points": "3.5"})
    assert c.status_code == 201, c.text
    new_id = c.json()["id"]
    assert float(c.json()["points"]) == 3.5

    # Reps cannot manage the catalog.
    assert client.post("/api/v1/inspections/item-types", headers=rep,
                       json={"name": "x", "points": "1"}).status_code == 403

    # Edit the points of an existing item.
    rows = client.get("/api/v1/inspections/item-types", headers=admin).json()
    battery = next(t for t in rows if t["name"] == 'بطاريه50"*32"')
    u = client.patch(f"/api/v1/inspections/item-types/{battery['id']}", headers=admin,
                     json={"points": "15"})
    assert u.status_code == 200 and float(u.json()["points"]) == 15.0

    # Deactivate the new one — it leaves the app list but the row remains.
    d = client.delete(f"/api/v1/inspections/item-types/{new_id}", headers=admin)
    assert d.status_code == 200 and d.json()["active"] is False
    active_names = {t["name"] for t in
                    client.get("/api/v1/inspections/item-types", headers=admin).json()}
    assert "صنف جديد" not in active_names
    all_names = {t["name"] for t in client.get(
        "/api/v1/inspections/item-types?include_inactive=true", headers=admin).json()}
    assert "صنف جديد" in all_names  # not resurrected, not lost

    # Duplicate name is rejected.
    assert client.post("/api/v1/inspections/item-types", headers=admin,
                       json={"name": 'بطاريه50"*32"', "points": "1"}).status_code == 409


def test_item_types_are_the_points_catalog(client, world, login):
    h = login("rep_a")
    r = client.get("/api/v1/inspections/item-types", headers=h)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 32  # the «حساب نقاط» sheet
    names = {t["name"] for t in rows}
    assert 'بطاريه50"*32"' in names
    battery = next(t for t in rows if t["name"] == 'بطاريه50"*32"')
    assert float(battery["points"]) == 10.0
    # A fractional sixth is preserved at 4 decimals.
    sixth = next(t for t in rows if "صرف 1" in t["name"])
    assert abs(float(sixth["points"]) - (1 / 6)) < 0.0001


def test_fractional_points_total_cleanly(client, world, login):
    """Six 1/6-point pieces must total exactly 1.000 (no 0.167×6 drift)."""
    h = login("rep_a")
    r = client.post("/api/v1/inspections", json={
        "visit_kind": "technician", "inspection_date": "2026-07-20",
        "owner_name": "عميل النقاط",
        "items": [{"item_name": "قطعه صرف 1", "quantity": "6", "points": "0.1667"}],
    }, headers=h)
    assert r.status_code == 201, r.text
    assert float(r.json()["total_points"]) == 1.0


def test_regular_visit_takes_the_customer_name(client, world, login, db):
    from src.services import customer_service

    result = customer_service.create_customer(
        db, name="عميل الزيارة العادية", customer_type="trader", rep_id=world["rep_a"],
        territory_id=world["terr_a"], phone=None, actor_user_id=world["admin"])
    db.commit()
    h = login("rep_a")
    # No owner_name typed — the regular visit fills it from the customer.
    r = client.post("/api/v1/inspections", json={
        "visit_kind": "regular", "inspection_date": "2026-07-20",
        "customer_id": result.customer.id, "visit_details": "زيارة متابعة",
        "items": [{"item_name": "خرطوم", "quantity": "1", "points": "0"}],
    }, headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["customer_id"] == result.customer.id
    assert body["owner_name"] == "عميل الزيارة العادية"


def test_visit_without_owner_or_customer_is_rejected(client, world, login):
    h = login("rep_a")
    r = client.post("/api/v1/inspections", json={
        "visit_kind": "regular", "inspection_date": "2026-07-20", "items": []}, headers=h)
    assert r.status_code == 409


def test_rep_creates_inspection_with_totals(client, world, login):
    h = login("rep_a")
    r = client.post("/api/v1/inspections", json=_payload(), headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["document_number"].startswith("INSP-")
    assert body["rep_user_id"] == world["rep_a"]
    # 2×1.5 + 3×0.5 = 4.5
    assert float(body["total_points"]) == 4.5
    assert [float(ln["total"]) for ln in body["items"]] == [3.0, 1.5]


def test_sync_batch_is_idempotent_by_client_uuid(client, world, login):
    h = login("rep_a")
    batch = {"inspections": [
        _payload(client_uuid="uuid-aaa", owner_name="عميل 1"),
        _payload(client_uuid="uuid-bbb", owner_name="عميل 2", visit_kind="regular"),
    ]}
    r1 = client.post("/api/v1/inspections/sync", json=batch, headers=h)
    assert r1.status_code == 200, r1.text
    first = {x["client_uuid"]: x["document_number"] for x in r1.json()}
    assert set(first) == {"uuid-aaa", "uuid-bbb"}

    # Retrying the same batch (dropped connection) must not duplicate anything.
    r2 = client.post("/api/v1/inspections/sync", json=batch, headers=h)
    assert r2.status_code == 200
    assert {x["client_uuid"]: x["document_number"] for x in r2.json()} == first
    all_rows = client.get("/api/v1/inspections", headers=h).json()
    assert len(all_rows) == 2


def test_rep_sees_only_own_inspections_manager_sees_all(client, world, login):
    ha, hb = login("rep_a"), login("rep_b")
    client.post("/api/v1/inspections", json=_payload(owner_name="بتاع أ"), headers=ha)
    client.post("/api/v1/inspections", json=_payload(owner_name="بتاع ب"), headers=hb)

    mine = client.get("/api/v1/inspections", headers=ha).json()
    assert [i["owner_name"] for i in mine] == ["بتاع أ"]

    other_id = client.get("/api/v1/inspections", headers=hb).json()[0]["id"]
    assert client.get(f"/api/v1/inspections/{other_id}", headers=ha).status_code == 403

    admin_view = client.get("/api/v1/inspections", headers=login("admin")).json()
    assert len(admin_view) == 2


def test_date_and_kind_filters(client, world, login):
    h = login("rep_a")
    client.post("/api/v1/inspections",
                json=_payload(inspection_date="2026-07-01", owner_name="قديم"), headers=h)
    client.post("/api/v1/inspections",
                json=_payload(inspection_date="2026-07-20", owner_name="جديد",
                              visit_kind="regular"), headers=h)

    day = client.get("/api/v1/inspections?date_from=2026-07-20&date_to=2026-07-20",
                     headers=h).json()
    assert [i["owner_name"] for i in day] == ["جديد"]
    tech = client.get("/api/v1/inspections?visit_kind=technician", headers=h).json()
    assert [i["owner_name"] for i in tech] == ["قديم"]


def test_validation_rejects_bad_lines(client, world, login):
    h = login("rep_a")
    bad = _payload(items=[{"item_name": "خلاط", "quantity": "0", "points": "1"}])
    assert client.post("/api/v1/inspections", json=bad, headers=h).status_code == 409
    no_owner = _payload(owner_name="  ")
    r = client.post("/api/v1/inspections", json=no_owner, headers=h)
    assert r.status_code in (409, 422)


def test_accountant_cannot_write_inspections(client, world, login):
    r = client.post("/api/v1/inspections", json=_payload(), headers=login("acct"))
    assert r.status_code == 403


def test_only_admin_deletes_inspections(client, world, login):
    h = login("rep_a")
    created = client.post("/api/v1/inspections", json=_payload(), headers=h).json()
    iid = created["id"]
    # The recording rep cannot delete — admin only.
    assert client.delete(f"/api/v1/inspections/{iid}", headers=h).status_code == 403
    assert client.delete(f"/api/v1/inspections/{iid}", headers=login("admin")).status_code == 204
    assert client.get("/api/v1/inspections", headers=h).json() == []


def test_inspection_lookups_seeded(client, world, login):
    h = login("admin")
    r = client.get("/api/v1/settings/lookups?category=inspection_description", headers=h)
    assert r.status_code == 200, r.text
    values = [o["value"] for o in r.json()]
    assert "حمام و مطبخ" in values and "2 حمام" in values
    r2 = client.get("/api/v1/settings/lookups?category=inspection_type", headers=h)
    assert {"تغذية و صرف", "تغذية فقط", "صرف فقط"} <= {o["value"] for o in r2.json()}
