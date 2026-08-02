"""مردود مبيعات carries the same document fields as فاتورة بيع — 031-a5-restructure.

The client asked for the return to be an exact replica of the sale. It nearly was already:
`sales_return` has carried the whole 030 document set since that feature shipped — rep, posting
account, external number, notes, three statements — and **the payload dropped every one of them**.
The columns existed and nothing on earth could fill them, so every return ever written had them
blank while the screen offered no way to notice.
"""
from __future__ import annotations

from datetime import date, timedelta


def _product(client, h, name, price="50"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _stock(client, h, item_id, wh, qty):
    assert client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "quantity": str(qty),
        "location": {"location_kind": "warehouse", "location_id": wh}}).status_code == 201


def _customer(client, h, inv_world, name):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def test_a_return_takes_every_document_field_the_invoice_takes(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج مرتجع المستند")
    _stock(client, h, item["id"], wh, 10)
    cust = _customer(client, h, inv_world, "عميل مرتجع المستند")
    yesterday = date.today() - timedelta(days=1)

    res = client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "100", "credit_reduction": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "50"}],
        "rep_id": inv_world["rep_a"],
        "external_document_number": "ورقة العميل ٧٧",
        "notes": "البضاعة رجعت مقشّرة",
        "statement1": "بيان أول", "statement2": "بيان تاني", "statement3": "بيان تالت",
        "return_date": str(yesterday),
    })
    assert res.status_code == 201, res.text

    rows = client.get("/api/v1/sales/returns", headers=h).json()
    row = next(r for r in rows if r["id"] == res.json()["id"])
    assert row["rep_id"] == inv_world["rep_a"]
    assert row["external_document_number"] == "ورقة العميل ٧٧"
    assert row["notes"] == "البضاعة رجعت مقشّرة"
    assert row["statement1"] == "بيان أول"
    assert row["statement3"] == "بيان تالت"
    # The day the goods came back, not the day the row was typed.
    assert row["return_date"] == str(yesterday)


def test_a_return_with_no_date_given_is_dated_today(client, inv_world, login):
    """Defaulted in the service, not the column: a return always carries a real day."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج بتاريخ اليوم")
    _stock(client, h, item["id"], wh, 5)
    cust = _customer(client, h, inv_world, "عميل تاريخ اليوم")

    res = client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "50", "credit_reduction": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "50"}]})
    assert res.status_code == 201, res.text

    rows = client.get("/api/v1/sales/returns", headers=h).json()
    row = next(r for r in rows if r["id"] == res.json()["id"])
    assert row["return_date"] == str(date.today())


def test_the_fields_left_out_stay_empty(client, inv_world, login):
    """A return with no rep and no paper number must not borrow the customer's."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "منتج بلا حقول")
    _stock(client, h, item["id"], wh, 5)
    cust = _customer(client, h, inv_world, "عميل بلا حقول")

    res = client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "50", "credit_reduction": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "50"}]})

    rows = client.get("/api/v1/sales/returns", headers=h).json()
    row = next(r for r in rows if r["id"] == res.json()["id"])
    assert row["rep_id"] is None
    assert row["external_document_number"] is None
    assert row["notes"] is None
    assert row["statement1"] is None
