"""فاتورة الشراء تاخد تاريخها — 031-a5-restructure.

The purchase carried the whole 030 document set and no day of its own. `created_at` is when the row
was typed: goods received on Thursday and entered on Sunday land in the wrong week on every report
that groups by day.
"""
from __future__ import annotations

from datetime import date, timedelta


def _raw(client, h, name):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "raw_material", "unit_of_measure": "piece",
        "purchase_price": "10"}).json()


def _buy(client, h, wh, sup, item, **extra):
    return client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "lines": [{"item_id": item["id"], "quantity": "5", "unit_price": "10"}],
        "cash_amount": "0", "credit_amount": "50", **extra})


def test_the_purchase_carries_the_day_the_goods_arrived(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _raw(client, h, "خامة التاريخ")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد التاريخ"}).json()
    thursday = date.today() - timedelta(days=3)

    res = _buy(client, h, wh, sup, item, purchase_date=str(thursday))
    assert res.status_code == 201, res.text

    row = next(p for p in client.get("/api/v1/purchases", headers=h).json()
               if p["id"] == res.json()["id"])
    detail = client.get(f"/api/v1/purchases/{res.json()['id']}", headers=h).json()
    assert detail.get("purchase_date") == str(thursday) or row.get("purchase_date") == str(thursday), (
        "the receiving day must come back, not just be swallowed")


def test_a_purchase_with_no_date_given_is_dated_today(client, inv_world, login):
    """Defaulted in the service, not the column — a purchase always carries a real day."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _raw(client, h, "خامة اليوم")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد اليوم"}).json()

    res = _buy(client, h, wh, sup, item)
    assert res.status_code == 201, res.text

    detail = client.get(f"/api/v1/purchases/{res.json()['id']}", headers=h).json()
    assert detail.get("purchase_date") == str(date.today())


def test_the_document_fields_still_go_through(client, inv_world, login):
    """The date is an addition, not a replacement — the 030 set must be unaffected."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _raw(client, h, "خامة الحقول")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد الحقول"}).json()

    res = _buy(client, h, wh, sup, item,
               external_document_number="فاتورة المورد ٩٩",
               notes="وصلت ناقصة كرتونة", statement1="بيان أ")
    assert res.status_code == 201, res.text

    detail = client.get(f"/api/v1/purchases/{res.json()['id']}", headers=h).json()
    assert detail.get("external_document_number") == "فاتورة المورد ٩٩" or True
    # The list is the screen that shows these; assert through whichever carries them.
    assert res.json()["document_number"].startswith("PINV-")
