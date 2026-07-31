"""تقارير مندوبين — 031-a5-restructure.

Nothing new is recorded for these: a receipt has always carried who took it and from whom, and an
invoice has always carried its rep. What was missing was reading it that way round.
"""
from __future__ import annotations

from decimal import Decimal


def _rep_customer(client, h, inv_world, name):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _stock(client, h, item_id, wh, qty):
    res = client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "quantity": str(qty),
        "location": {"location_kind": "warehouse", "location_id": wh}})
    assert res.status_code == 201, res.text


def test_collections_group_by_rep(client, inv_world, login):
    """تحصيلات المندوبين: what each rep brought in, and how many receipts it took."""
    h = login("admin")
    cust = _rep_customer(client, h, inv_world, "عميل التحصيل")

    rep = login("rep_a")
    for amount in ("300", "200"):
        res = client.post("/api/v1/vouchers/receipts", headers=rep, json={
            "amount": amount, "customer_id": cust["id"]})
        assert res.status_code == 201, res.text

    rows = client.get("/api/v1/rep-reports/collections", headers=h).json()
    mine = next(r for r in rows if r["rep_user_id"] == inv_world["rep_a"])
    assert mine["receipts"] == 2
    assert Decimal(mine["collected"]) == Decimal("500.00")
    assert mine["rep_name"]


def test_collections_break_down_by_customer_without_losing_money(client, inv_world, login):
    """The by-customer total must equal the by-rep total, or one of the two screens is lying."""
    h = login("admin")
    a = _rep_customer(client, h, inv_world, "عميل أ")
    b = _rep_customer(client, h, inv_world, "عميل ب")
    rep = login("rep_a")

    for cust, amount in ((a, "400"), (b, "100"), (a, "50")):
        client.post("/api/v1/vouchers/receipts", headers=rep, json={
            "amount": amount, "customer_id": cust["id"]})

    by_rep = client.get("/api/v1/rep-reports/collections", headers=h).json()
    by_cust = client.get("/api/v1/rep-reports/collections-by-customer", headers=h).json()

    rep_total = sum(Decimal(r["collected"]) for r in by_rep)
    cust_total = sum(Decimal(r["collected"]) for r in by_cust)
    assert rep_total == cust_total == Decimal("550.00")

    a_row = next(r for r in by_cust if r["customer_id"] == a["id"])
    assert Decimal(a_row["collected"]) == Decimal("450.00")
    assert a_row["receipts"] == 2
    assert a_row["customer_name"] == "عميل أ"


def test_a_rep_sees_only_their_own(client, inv_world, login):
    """Same rule the commission report already applies: a rep's figures are their own."""
    h = login("admin")
    cust = _rep_customer(client, h, inv_world, "عميل النطاق")
    client.post("/api/v1/vouchers/receipts", headers=login("rep_a"), json={
        "amount": "100", "customer_id": cust["id"]})

    as_rep_b = client.get("/api/v1/rep-reports/collections", headers=login("rep_b")).json()
    assert all(r["rep_user_id"] == inv_world["rep_b"] for r in as_rep_b)
    # rep_b collected nothing, so rep_a's money must not be visible to them at all.
    assert as_rep_b == []


def test_rep_items_follow_the_salesman_and_the_discount(client, inv_world, login):
    """مبيعات اصناف مندوبين — per item, valued net so it can be compared with the invoices."""
    h = login("admin")
    wh = inv_world["central_wh"]
    cust = _rep_customer(client, h, inv_world, "عميل الأصناف")
    p1, p2 = _product(client, h, "منتج أ"), _product(client, h, "منتج ب", "50")
    _stock(client, h, p1["id"], wh, 20)
    _stock(client, h, p2["id"], wh, 20)

    # 10% off the whole document: the item figures must reflect what was billed, not the gross.
    res = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "10",
        "cash_amount": "0", "credit_amount": "225",
        "lines": [{"item_id": p1["id"], "quantity": "2", "unit_price": "100"},
                  {"item_id": p2["id"], "quantity": "1", "unit_price": "50"}]})
    assert res.status_code == 201, res.text

    rows = client.get("/api/v1/rep-reports/items", headers=h).json()
    mine = {r["item_id"]: r for r in rows if r["rep_user_id"] == inv_world["rep_a"]}
    assert Decimal(mine[p1["id"]]["quantity"]) == Decimal("2.000")
    assert Decimal(mine[p1["id"]]["net"]) == Decimal("180.00")   # 200 less 10%
    assert Decimal(mine[p2["id"]]["net"]) == Decimal("45.00")    # 50 less 10%
    # And the parts add up to the invoice, which is the only way the two screens can be read together.
    assert sum(Decimal(r["net"]) for r in mine.values()) == Decimal("225.00")


def test_windows_exclude_what_is_outside_them(client, inv_world, login):
    h = login("admin")
    cust = _rep_customer(client, h, inv_world, "عميل الفترة")
    client.post("/api/v1/vouchers/receipts", headers=login("rep_a"), json={
        "amount": "700", "customer_id": cust["id"]})

    past = client.get(
        "/api/v1/rep-reports/collections?date_from=2020-01-01&date_to=2020-12-31", headers=h)
    assert past.json() == []
