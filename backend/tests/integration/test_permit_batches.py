"""إذن المخزن لازم يحرّك الدفعات زي ما بيحرّك الرصيد.

The invariant the whole perishable feature rests on: at every location, Σ(batch quantity) equals
the derived on-hand. Receive, sale and transfer each move both halves together — and the stock
permit moved only one. It posted a stock movement and left the expiry lots exactly where they
were, so an إذن إضافة on a perishable item left the lots short and an إذن صرف left them long.

Nothing complained at the time. `check_batch_sums` catches it, but only when somebody runs the
integrity report — by which point the permit is weeks old and the lot it should have touched is a
guess. So the fix is on both sides of the document: creation moves the lot, and the reversal undoes
the lot the line wrote down rather than inventing a date.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal


def _perishable(client, h, name):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "is_perishable": True}).json()


def _lots(client, h, item_id):
    rows = client.get("/api/v1/stock/batches/expiring", headers=h, params={
        "before": str(date.today() + timedelta(days=3650)), "item_id": item_id}).json()
    return {r["expiry_date"]: Decimal(r["quantity"]) for r in rows}


def _on_hand(client, h, item_id, wh):
    rows = client.get("/api/v1/stock/by-location", headers=h, params={
        "location_kind": "warehouse", "location_id": wh}).json()
    row = next((r for r in rows if r["item_id"] == item_id), None)
    return Decimal(row["on_hand"]) if row else Decimal("0")


def _integrity_clean(client, h) -> bool:
    res = client.get("/api/v1/admin/integrity", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    bad = [f for f in body.get("findings", []) if f.get("check") == "batch_sums"]
    return not bad


def test_an_addition_fills_the_lot_it_names(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h, "عصير")
    expiry = str(date.today() + timedelta(days=60))

    res = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh, "reason": "استلام",
        "lines": [{"item_id": item["id"], "quantity": "12", "unit_cost": "3",
                   "expiry_date": expiry}]})
    assert res.status_code == 201, res.text

    assert _on_hand(client, h, item["id"], wh) == Decimal("12")
    assert _lots(client, h, item["id"]).get(expiry) == Decimal("12")
    assert _integrity_clean(client, h), "مجموع الدفعات مش مساوي الرصيد"


def test_an_addition_without_an_expiry_is_refused(client, inv_world, login):
    """Refused at the door rather than posted and reconciled later.

    Nobody can supply the lot afterwards: the goods are on the shelf, mixed with whatever was
    already there, and the date is gone.
    """
    h = login("admin")
    item = _perishable(client, h, "لبن بدون تاريخ")
    res = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": inv_world["central_wh"],
        "lines": [{"item_id": item["id"], "quantity": "5", "unit_cost": "2"}]})
    assert res.status_code == 422, res.text
    assert "صلاحية" in res.text


def test_an_issue_draws_the_earliest_lot_first(client, inv_world, login):
    """FEFO, the same rule a sale follows — and no expiry asked for, because nobody chooses."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h, "جبنة")
    soon = str(date.today() + timedelta(days=7))
    later = str(date.today() + timedelta(days=120))
    for exp, q in ((soon, "4"), (later, "10")):
        client.post("/api/v1/stock/batches", headers=h, json={
            "item_id": item["id"], "location_kind": "warehouse", "location_id": wh,
            "quantity": q, "expiry_date": exp})

    res = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "issue", "warehouse_id": wh, "reason": "عينة",
        "lines": [{"item_id": item["id"], "quantity": "6"}]})
    assert res.status_code == 201, res.text

    lots = _lots(client, h, item["id"])
    assert lots.get(soon, Decimal("0")) == Decimal("0"), lots
    assert lots.get(later) == Decimal("8"), lots
    assert _on_hand(client, h, item["id"], wh) == Decimal("8")
    assert _integrity_clean(client, h)


def test_reversing_an_addition_empties_the_lot_again(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h, "زبادي الإذن")
    expiry = str(date.today() + timedelta(days=45))
    created = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "9", "unit_cost": "2",
                   "expiry_date": expiry}]}).json()

    rev = client.post(f"/api/v1/stock/permits/{created['id']}/reverse", headers=h)
    assert rev.status_code == 201, rev.text

    assert _on_hand(client, h, item["id"], wh) == Decimal("0")
    assert _lots(client, h, item["id"]).get(expiry, Decimal("0")) == Decimal("0")
    assert _integrity_clean(client, h)


def test_reversing_an_issue_puts_it_back_in_the_lot_it_came_from(client, inv_world, login):
    """The reason the line records its lot at all.

    Restoring to a NEW lot would keep the on-hand right and the lots wrong — an item that expires
    in a week quietly becoming one that expires in a year.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h, "كريمة")
    soon = str(date.today() + timedelta(days=10))
    later = str(date.today() + timedelta(days=200))
    for exp, q in ((soon, "5"), (later, "5")):
        client.post("/api/v1/stock/batches", headers=h, json={
            "item_id": item["id"], "location_kind": "warehouse", "location_id": wh,
            "quantity": q, "expiry_date": exp})

    created = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "issue", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "3"}]}).json()
    assert _lots(client, h, item["id"]).get(soon) == Decimal("2")

    rev = client.post(f"/api/v1/stock/permits/{created['id']}/reverse", headers=h)
    assert rev.status_code == 201, rev.text

    lots = _lots(client, h, item["id"])
    assert lots.get(soon) == Decimal("5"), lots
    assert lots.get(later) == Decimal("5"), lots
    assert _integrity_clean(client, h)


def test_a_normal_item_is_untouched_by_any_of_this(client, inv_world, login):
    """Most items are not perishable, and none of the above may change how they behave."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف عادي", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    res = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "7", "unit_cost": "4"}]})
    assert res.status_code == 201, res.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("7")
