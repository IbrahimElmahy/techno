"""كارت الصنف — the movement history of one item with a running balance (B3).

A movement list without a running balance answers "what happened" but not "what did I have".
The whole point of a stock card is that every row carries the balance before it and the balance
after it, so a storekeeper can put a finger on any line and see the quantity as it stood that
day — and can reconcile a disputed count back to the movement that caused it.

Because a balance is only meaningful somewhere, the card is per-location by default; asking for
all locations gives the item's total position instead.
"""
from decimal import Decimal


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _supplier(client, h, name="S"):
    return client.post("/api/v1/suppliers", headers=h, json={"name": name}).json()


def _customer(client, h, inv_world, name="C"):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _buy(client, h, supplier_id, item_id, wh, qty, price="60"):
    resp = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier_id,
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": str(Decimal(qty) * Decimal(price)), "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": qty, "unit_price": price}]})
    assert resp.status_code == 201, resp.text
    return resp


def _sell(client, h, cust_id, wh, item_id, qty, total):
    resp = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust_id,
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": str(total), "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": qty, "discount_pct": "0"}]})
    assert resp.status_code == 201, resp.text
    return resp


def _card(client, h, item_id, **params):
    resp = client.get(f"/api/v1/items/{item_id}/card", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_each_row_carries_the_balance_before_and_after_it(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "كارت")
    sup = _supplier(client, admin)
    cust = _customer(client, admin, inv_world)

    _buy(client, admin, sup["id"], item["id"], wh, "10")
    _sell(client, admin, cust["id"], wh, item["id"], "4", 400)
    _buy(client, admin, sup["id"], item["id"], wh, "5")

    card = _card(client, admin, item["id"], location_kind="warehouse", location_id=wh)
    rows = card["rows"]
    assert len(rows) == 3

    # Oldest first — a card is read downwards, like a bank statement.
    assert Decimal(rows[0]["balance_before"]) == Decimal("0.000")
    assert Decimal(rows[0]["quantity_in"]) == Decimal("10.000")
    assert Decimal(rows[0]["balance_after"]) == Decimal("10.000")

    assert Decimal(rows[1]["quantity_out"]) == Decimal("4.000")
    assert Decimal(rows[1]["balance_before"]) == Decimal("10.000")
    assert Decimal(rows[1]["balance_after"]) == Decimal("6.000")

    assert Decimal(rows[2]["balance_before"]) == Decimal("6.000")
    assert Decimal(rows[2]["balance_after"]) == Decimal("11.000")


def test_every_row_chains_to_the_next(client, inv_world, login):
    """The card is only trustworthy if there is no gap: each row starts where the last ended."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "متسلسل")
    sup = _supplier(client, admin)
    cust = _customer(client, admin, inv_world)
    _buy(client, admin, sup["id"], item["id"], wh, "20")
    for _ in range(3):
        _sell(client, admin, cust["id"], wh, item["id"], "2", 200)
    _buy(client, admin, sup["id"], item["id"], wh, "7")

    card = _card(client, admin, item["id"], location_kind="warehouse", location_id=wh)
    rows = card["rows"]
    for previous, row in zip(rows, rows[1:]):
        assert row["balance_before"] == previous["balance_after"]
    assert card["closing_balance"] == rows[-1]["balance_after"]


def test_closing_balance_equals_the_stock_on_hand(client, inv_world, login):
    """If the card and the on-hand figure could disagree, one of them would be a lie."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "مطابق")
    sup = _supplier(client, admin)
    cust = _customer(client, admin, inv_world)
    _buy(client, admin, sup["id"], item["id"], wh, "12")
    _sell(client, admin, cust["id"], wh, item["id"], "5", 500)

    card = _card(client, admin, item["id"], location_kind="warehouse", location_id=wh)
    on_hand = client.get("/api/v1/stock/on-hand", headers=admin, params={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh}).json()
    assert Decimal(card["closing_balance"]) == Decimal(on_hand["on_hand"])


def test_a_date_window_opens_with_the_balance_carried_forward(client, inv_world, login):
    """Filtering a period must not restart the balance at zero — that would misstate every row."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "مرحّل")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "9")

    # A window that starts tomorrow holds no movements, but the stock still exists.
    card = _card(client, admin, item["id"], location_kind="warehouse", location_id=wh,
                 date_from="2099-01-01")
    assert card["rows"] == []
    assert Decimal(card["opening_balance"]) == Decimal("9.000")
    assert Decimal(card["closing_balance"]) == Decimal("9.000")


def test_the_card_is_per_location(client, inv_world, login):
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    item = _product(client, admin, "بمخزنين")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], central, "10")
    _buy(client, admin, sup["id"], item["id"], branch, "4")

    only_branch = _card(client, admin, item["id"],
                        location_kind="warehouse", location_id=branch)
    assert len(only_branch["rows"]) == 1
    assert Decimal(only_branch["closing_balance"]) == Decimal("4.000")

    # No location asked for → the item's whole position, across every warehouse and custody.
    everywhere = _card(client, admin, item["id"])
    assert len(everywhere["rows"]) == 2
    assert Decimal(everywhere["closing_balance"]) == Decimal("14.000")


def test_filtering_by_movement_type_keeps_the_balance_honest(client, inv_world, login):
    """Showing only sales must not pretend the purchases never happened."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "مفلتر")
    sup = _supplier(client, admin)
    cust = _customer(client, admin, inv_world)
    _buy(client, admin, sup["id"], item["id"], wh, "10")
    _sell(client, admin, cust["id"], wh, item["id"], "3", 300)

    card = _card(client, admin, item["id"], location_kind="warehouse", location_id=wh,
                 movement_type="sale_out")
    assert len(card["rows"]) == 1
    row = card["rows"][0]
    # The purchase is hidden, but it is still under the balance this sale drew from.
    assert Decimal(row["balance_before"]) == Decimal("10.000")
    assert Decimal(row["balance_after"]) == Decimal("7.000")
    assert Decimal(card["closing_balance"]) == Decimal("7.000")


def test_the_card_names_the_document_behind_each_row(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "بمستند")
    sup = _supplier(client, admin)
    purchase = _buy(client, admin, sup["id"], item["id"], wh, "6").json()

    card = _card(client, admin, item["id"], location_kind="warehouse", location_id=wh)
    row = card["rows"][0]
    assert row["movement_type"] == "purchase_in"
    assert row["source_doc_type"] == "purchase"
    assert row["source_doc_id"] == purchase["id"]
    assert row["location"]  # a readable warehouse name, not a bare id


def test_totals_report_what_went_in_and_out(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "إجماليات")
    sup = _supplier(client, admin)
    cust = _customer(client, admin, inv_world)
    _buy(client, admin, sup["id"], item["id"], wh, "10")
    _buy(client, admin, sup["id"], item["id"], wh, "5")
    _sell(client, admin, cust["id"], wh, item["id"], "6", 600)

    card = _card(client, admin, item["id"], location_kind="warehouse", location_id=wh)
    assert Decimal(card["total_in"]) == Decimal("15.000")
    assert Decimal(card["total_out"]) == Decimal("6.000")
    assert Decimal(card["closing_balance"]) == Decimal("9.000")
