"""ملخّص إذن التحويل لازم يقول اللي بيتحرّك فعلاً.

A transfer used to move ONE item, recorded as `item_id` + `quantity` on the document. Lines came
later, and approval reads them: it moves the LINES when a document has any and falls back to the
header only when it has none.

The output kept reporting the header regardless. That was invisible while the two always agreed —
and they stop agreeing the moment anybody edits a permit that predates the lines table, which is
exactly what «تعديل الكميات قبل الاعتماد» does. The list then prints one number beside a document
showing another, and the number the list prints is the one that will NOT move.
"""
from __future__ import annotations

from decimal import Decimal


def _transfer(client, h, inv_world, item_id, qty="2"):
    res = client.post("/api/v1/transfers", headers=h, json={
        "item_id": item_id, "quantity": qty, "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "dest": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]}})
    assert res.status_code == 201, res.text
    return res.json()


def _stocked(client, h, wh, name, qty="20"):
    item = client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "10"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": f"مورد {name}"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": qty, "unit_price": "5"}]})
    return item


def test_the_summary_follows_the_line_that_was_edited(client, inv_world, login):
    """The bug, exactly: change the line and the document's headline number must change with it."""
    h = login("admin")
    item = _stocked(client, h, inv_world["central_wh"], "صنف الملخّص")
    doc = _transfer(client, h, inv_world, item["id"], "2")

    # Give it the line a legacy permit is missing, then correct the quantity — the screen's flow.
    res = client.post(f"/api/v1/transfers/{doc['id']}/lines", headers=h,
                      json={"item_id": item["id"], "quantity": "2"})
    assert res.status_code == 201, res.text
    line_id = res.json()["lines"][0]["id"]
    res = client.patch(f"/api/v1/transfers/lines/{line_id}", headers=h, json={"quantity": "1"})
    assert res.status_code == 200, res.text

    row = next(t for t in client.get("/api/v1/transfers", headers=h).json()
               if t["id"] == doc["id"])
    assert Decimal(row["quantity"]) == Decimal("1"), "القايمة لسه بتقول الرقم القديم"
    assert Decimal(row["lines"][0]["quantity"]) == Decimal("1")


def test_a_permit_with_no_lines_still_answers_from_its_own_row(client, inv_world, login):
    """Nothing already posted has to be migrated: an untouched legacy document reads as before."""
    h = login("admin")
    item = _stocked(client, h, inv_world["central_wh"], "صنف قديم")
    doc = _transfer(client, h, inv_world, item["id"], "3")

    row = next(t for t in client.get("/api/v1/transfers", headers=h).json()
               if t["id"] == doc["id"])
    assert row["item_id"] == item["id"]
    assert Decimal(row["quantity"]) == Decimal("3")
    assert row["lines"] == []


def test_a_multi_line_permit_totals_its_lines(client, inv_world, login):
    """«الكمية» on a document holding several items is the sum, and the single item is dropped —
    naming one of three would be naming an arbitrary one."""
    h = login("admin")
    wh = inv_world["central_wh"]
    a = _stocked(client, h, wh, "صنف أ")
    b = _stocked(client, h, wh, "صنف ب")
    doc = _transfer(client, h, inv_world, a["id"], "2")
    client.post(f"/api/v1/transfers/{doc['id']}/lines", headers=h,
                json={"item_id": a["id"], "quantity": "2"})
    client.post(f"/api/v1/transfers/{doc['id']}/lines", headers=h,
                json={"item_id": b["id"], "quantity": "5"})

    row = next(t for t in client.get("/api/v1/transfers", headers=h).json()
               if t["id"] == doc["id"])
    assert Decimal(row["quantity"]) == Decimal("7")
    assert row["item_id"] is None, "مستند فيه صنفين مايتسمّاش باسم واحد فيهم"


def test_what_approval_moves_is_what_the_summary_said(client, inv_world, login):
    """The claim that makes the whole thing safe: after the edit, approval moves the corrected
    quantity — not the one the document was created with."""
    from src.models.stock import LocationKind, StockDirection, StockMovement
    from sqlalchemy import select

    h = login("admin")
    wh, dest = inv_world["central_wh"], inv_world["branch_wh"]
    item = _stocked(client, h, wh, "صنف الاعتماد")
    doc = _transfer(client, h, inv_world, item["id"], "2")

    res = client.post(f"/api/v1/transfers/{doc['id']}/lines", headers=h,
                      json={"item_id": item["id"], "quantity": "2"})
    line_id = res.json()["lines"][0]["id"]
    client.patch(f"/api/v1/transfers/lines/{line_id}", headers=h, json={"quantity": "1"})

    ok = client.post(f"/api/v1/transfers/{doc['id']}/approve", headers=h)
    assert ok.status_code == 200, ok.text

    rows = client.get("/api/v1/stock/by-location", headers=h, params={
        "location_kind": "warehouse", "location_id": dest}).json()
    moved = next((r for r in rows if r["item_id"] == item["id"]), None)
    assert moved is not None and Decimal(moved["on_hand"]) == Decimal("1"), \
        "اتحركت الكمية القديمة مش المعدّلة"
