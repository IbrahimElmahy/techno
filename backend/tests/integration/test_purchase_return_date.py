"""مردود الشراء ياخد تاريخه — 031-a5-restructure.

The fourth and last trade document found without a day of its own. `created_at` is when the row was
typed; goods sent back on Thursday and entered on Sunday land in the wrong week on every report
that groups by day — and «رجعنا للمورد ده كام ومتى؟» is the question this register exists for.
"""
from __future__ import annotations

from datetime import date, timedelta


def _world(client, h, wh, name):
    item = client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "raw_material", "unit_of_measure": "piece",
        "purchase_price": "10"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": f"مورد {name}"}).json()
    inv = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "10"}],
        "cash_amount": "0", "credit_amount": "100"})
    assert inv.status_code == 201, inv.text
    return item, sup, inv.json()


def _row(client, h, ret_id):
    rows = client.get("/api/v1/purchases/returns", headers=h).json()
    return next(r for r in rows if r["id"] == ret_id)


def test_the_return_carries_the_day_the_goods_went_back(client, inv_world, login):
    h = login("admin")
    item, _sup, inv = _world(client, h, inv_world["central_wh"], "خامة رجعت")
    thursday = date.today() - timedelta(days=3)

    res = client.post(f"/api/v1/purchases/{inv['id']}/returns", headers=h, json={
        "lines": [{"item_id": item["id"], "quantity": "2"}],
        "return_date": str(thursday), "notes": "رجعت مكسورة"})
    assert res.status_code == 201, res.text

    row = _row(client, h, res.json()["id"])
    assert row["return_date"] == str(thursday), "the day given must come back, not be swallowed"
    assert row["notes"] == "رجعت مكسورة"


def test_a_return_with_no_date_given_is_dated_today(client, inv_world, login):
    """Defaulted in the service, not the column — returns recorded before this have no day, and a
    column default would have invented one for them."""
    h = login("admin")
    item, _sup, inv = _world(client, h, inv_world["central_wh"], "خامة اليوم")

    res = client.post(f"/api/v1/purchases/{inv['id']}/returns", headers=h, json={
        "lines": [{"item_id": item["id"], "quantity": "1"}]})
    assert res.status_code == 201, res.text
    assert _row(client, h, res.json()["id"])["return_date"] == str(date.today())


def test_the_date_does_not_loosen_the_quantity_rule(client, inv_world, login):
    """A date is an addition. The cumulative-return ceiling must be exactly where it was."""
    h = login("admin")
    item, _sup, inv = _world(client, h, inv_world["central_wh"], "خامة السقف")

    ok = client.post(f"/api/v1/purchases/{inv['id']}/returns", headers=h, json={
        "lines": [{"item_id": item["id"], "quantity": "6"}], "return_date": str(date.today())})
    assert ok.status_code == 201, ok.text

    over = client.post(f"/api/v1/purchases/{inv['id']}/returns", headers=h, json={
        "lines": [{"item_id": item["id"], "quantity": "5"}]})
    assert over.status_code == 409, "10 bought, 6 back — 5 more must be refused"
