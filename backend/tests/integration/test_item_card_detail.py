"""كارت الصنف — the party, the document and the money on every row — 031-a5-restructure.

Their card carries twenty-six columns; ours carried eight. None of the missing ones were missing
DATA: a sale line has always known its price, its customer and its invoice number. They were one
join away and the card did not make it, so «منصرف ٥» meant opening the sales screen to find out who
took them and for how much.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal


def _product(client, h, name, **kw):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50", **kw}).json()


def _customer(client, h, inv_world, name):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _card(client, h, item_id, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    res = client.get(f"/api/v1/items/{item_id}/card?{q}", headers=h)
    assert res.status_code == 200, res.text
    return res.json()


def test_a_purchase_row_names_the_supplier_and_its_price(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "خامة الكارت", "kind": "raw_material", "unit_of_measure": "piece",
        "purchase_price": "10"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد الكارت"}).json()
    bought = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "lines": [{"item_id": item["id"], "quantity": "20", "unit_price": "12"}],
        "cash_amount": "0", "credit_amount": "240"})
    assert bought.status_code == 201, bought.text

    row = _card(client, h, item["id"])["rows"][0]
    assert row["party"] == "مورد الكارت"
    assert row["document_number"], "the row must name the document, not just its id"
    assert Decimal(row["unit_price"]) == Decimal("12.00")
    assert Decimal(row["line_total"]) == Decimal("240.00")


def test_a_sale_row_names_the_customer_and_what_was_billed(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج الكارت")
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item["id"], "quantity": "10",
        "location": {"location_kind": "warehouse", "location_id": wh}})
    cust = _customer(client, h, inv_world, "عميل الكارت")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "150", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "3", "unit_price": "50"}]})
    assert sale.status_code == 201, sale.text

    rows = _card(client, h, item["id"])["rows"]
    sold = next(r for r in rows if r["source_doc_type"] == "sale")
    assert sold["party"] == "عميل الكارت"
    assert sold["document_number"] == sale.json()["document_number"]
    assert Decimal(sold["unit_price"]) == Decimal("50.00")
    assert Decimal(sold["line_total"]) == Decimal("150.00")


def test_a_row_with_no_document_behind_it_stays_empty(client, inv_world, login):
    """An opening balance or a manual production has no party and must not invent one."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج بلا مستند")
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item["id"], "quantity": "4",
        "location": {"location_kind": "warehouse", "location_id": wh}})

    row = _card(client, h, item["id"])["rows"][0]
    assert row["party"] is None
    assert row["unit_price"] is None
    assert row["line_total"] is None


def test_a_perishable_sale_carries_the_lot_it_drew_from(client, inv_world, login):
    """Their «انتهاء» column. FEFO's choice is on the batch trail; the card reads it back."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف كارت بصلاحية", is_perishable=True)
    soon = date.today() + timedelta(days=12)
    client.post("/api/v1/stock/batches", headers=h, json={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh,
        "expiry_date": str(soon), "quantity": "10"})
    cust = _customer(client, h, inv_world, "عميل الصلاحية بالكارت")
    client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "50"}]})

    rows = _card(client, h, item["id"])["rows"]
    sold = next(r for r in rows if r["source_doc_type"] == "sale")
    assert sold["expiry_date"] == str(soon)


def test_the_running_balance_is_untouched_by_the_new_columns(client, inv_world, login):
    """The card's whole point is before/after. Enriching rows must not disturb it."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج التوازن")
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item["id"], "quantity": "10",
        "location": {"location_kind": "warehouse", "location_id": wh}})
    cust = _customer(client, h, inv_world, "عميل التوازن")
    client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "50"}]})

    card = _card(client, h, item["id"])
    rows = card["rows"]
    assert Decimal(rows[0]["balance_before"]) == Decimal("0.000")
    assert Decimal(rows[0]["balance_after"]) == Decimal("10.000")
    assert Decimal(rows[1]["balance_before"]) == Decimal("10.000")
    assert Decimal(rows[1]["balance_after"]) == Decimal("8.000")
    assert Decimal(card["closing_balance"]) == Decimal("8.000")
