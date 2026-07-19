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


def test_inspection_lookups_seeded(client, world, login):
    h = login("admin")
    r = client.get("/api/v1/settings/lookups?category=inspection_description", headers=h)
    assert r.status_code == 200, r.text
    values = [o["value"] for o in r.json()]
    assert "حمام و مطبخ" in values and "2 حمام" in values
    r2 = client.get("/api/v1/settings/lookups?category=inspection_type", headers=h)
    assert {"تغذية و صرف", "تغذية فقط", "صرف فقط"} <= {o["value"] for o in r2.json()}
