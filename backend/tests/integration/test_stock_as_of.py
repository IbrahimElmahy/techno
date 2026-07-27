"""جرد حق تاريخ — the stock as it stood on a past date, and the costing method (B5).

An auditor asking "what did you have on the 31st" cannot be answered by today's balance. This is
the same derivation the on-hand figure uses, cut off at a date: every movement up to and including
that day, nothing after it. Which means a document entered late still lands on the day it happened,
and the answer for a closed month does not drift as the month after it trades.
"""
from datetime import date, timedelta
from decimal import Decimal


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _supplier(client, h, name="S"):
    return client.post("/api/v1/suppliers", headers=h, json={"name": name}).json()


def _buy(client, h, supplier_id, item_id, wh, qty, price="60"):
    resp = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier_id,
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": str(Decimal(qty) * Decimal(price)), "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": qty, "unit_price": price}]})
    assert resp.status_code == 201, resp.text
    return resp


def _as_of(client, h, **params):
    resp = client.get("/api/v1/reports/stock-as-of", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_today_matches_the_live_balance(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "جرد اليوم")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "14")

    out = _as_of(client, admin, as_of=str(date.today()), warehouse_id=wh)
    row = next(r for r in out["rows"] if r["item_id"] == item["id"])
    assert Decimal(row["quantity"]) == Decimal("14.000")


def test_a_date_before_the_movement_shows_nothing(client, inv_world, login):
    """Stock bought today did not exist yesterday — a stocktake must not back-date it."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "قبل الشراء")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "9")

    yesterday = str(date.today() - timedelta(days=1))
    out = _as_of(client, admin, as_of=yesterday, warehouse_id=wh)
    assert all(r["item_id"] != item["id"] for r in out["rows"])


def test_the_stocktake_is_valued_at_cost(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "مقيّم")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "10", "60")

    out = _as_of(client, admin, as_of=str(date.today()), warehouse_id=wh)
    row = next(r for r in out["rows"] if r["item_id"] == item["id"])
    assert Decimal(row["unit_cost"]) == Decimal("60.00")
    assert Decimal(row["value"]) == Decimal("600.00")
    assert Decimal(out["totals"]["value"]) >= Decimal("600.00")


def test_each_warehouse_is_counted_separately(client, inv_world, login):
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    item = _product(client, admin, "بمخزنين")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], central, "10")
    _buy(client, admin, sup["id"], item["id"], branch, "4")

    only_branch = _as_of(client, admin, as_of=str(date.today()), warehouse_id=branch)
    row = next(r for r in only_branch["rows"] if r["item_id"] == item["id"])
    assert Decimal(row["quantity"]) == Decimal("4.000")

    everywhere = _as_of(client, admin, as_of=str(date.today()))
    total = sum(Decimal(r["quantity"]) for r in everywhere["rows"] if r["item_id"] == item["id"])
    assert total == Decimal("14.000")


def test_items_with_nothing_left_are_not_listed(client, inv_world, login):
    """A stocktake lists what is there; a zero line is noise on a count sheet."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "صفر")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "3")
    resp = client.post("/api/v1/stock/permits", headers=admin, json={
        "kind": "issue", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "3"}]})
    assert resp.status_code == 201, resp.text

    out = _as_of(client, admin, as_of=str(date.today()), warehouse_id=wh)
    assert all(r["item_id"] != item["id"] for r in out["rows"])


def test_the_costing_method_is_a_setting(client, inv_world, login):
    """Weighted average is the shipped default; last-purchase is the alternative they asked about."""
    admin = login("admin")
    current = client.get("/api/v1/settings/stock", headers=admin)
    assert current.status_code == 200, current.text
    assert current.json()["costing_method"] == "average"

    saved = client.put("/api/v1/settings/stock", headers=admin,
                       json={"costing_method": "last_purchase"})
    assert saved.status_code == 200, saved.text
    assert client.get("/api/v1/settings/stock",
                      headers=admin).json()["costing_method"] == "last_purchase"

    bad = client.put("/api/v1/settings/stock", headers=admin, json={"costing_method": "fifo"})
    assert bad.status_code == 422


def test_last_purchase_costing_uses_the_newest_price(client, inv_world, login):
    """Two buys at different prices: the average says 70, the last purchase says 80."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "طريقتين")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "10", "60")
    _buy(client, admin, sup["id"], item["id"], wh, "10", "80")

    on_average = _as_of(client, admin, as_of=str(date.today()), warehouse_id=wh)
    row = next(r for r in on_average["rows"] if r["item_id"] == item["id"])
    assert Decimal(row["unit_cost"]) == Decimal("70.00")

    client.put("/api/v1/settings/stock", headers=admin, json={"costing_method": "last_purchase"})
    on_last = _as_of(client, admin, as_of=str(date.today()), warehouse_id=wh)
    row = next(r for r in on_last["rows"] if r["item_id"] == item["id"])
    assert Decimal(row["unit_cost"]) == Decimal("80.00")
