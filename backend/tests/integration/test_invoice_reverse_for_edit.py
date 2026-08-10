"""«تعديل الفاتورة» لازم يشتغل على أي فاتورة — مش على السهلة بس.

Editing a posted invoice reverses it and reopens the form. The reversal was calling `return_sale`
directly, which is the CUSTOMER-return path — and a customer return has to ask questions a
reversal has no business asking:

* **صنف له صلاحية** — a real return must be told which expiry lot the goods belong to, because the
  customer is handing over goods whose history nobody watched. So «تعديل» died on «المرتجع لصنف له
  صلاحية لازم تكتب تاريخ صلاحية البضاعة الراجعة» — a question the edit screen could not answer and
  the database already had.
* **صنف بسيريال** — same shape: «عدد السيريالات لازم يساوي الكمية المرتجعة», with nothing on screen
  to type them into.
* **فاتورة اترجّع جزء منها** — reversing the full quantity exceeded what was left and was refused
  outright, instead of reversing the remainder.

A reversal knows all three: FEFO wrote down which lots it drew from, the serials carry the invoice
that sold them, and prior returns are on the record. `reverse_sale` reads them and hands the
answers to the one posting path.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal


def _customer(client, h, inv_world, name):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()


def _on_hand(client, h, item_id, wh):
    rows = client.get("/api/v1/stock/by-location", headers=h, params={
        "location_kind": "warehouse", "location_id": wh}).json()
    row = next((r for r in rows if r["item_id"] == item_id), None)
    return Decimal(row["on_hand"]) if row else Decimal("0")


def test_editing_an_invoice_with_a_perishable_item(client, inv_world, login):
    """The reported failure, end to end."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "لبن طازة", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "20", "is_perishable": True}).json()
    expiry = str(date.today() + timedelta(days=30))
    res = client.post("/api/v1/stock/batches", headers=h, json={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh,
        "quantity": "10", "expiry_date": expiry})
    assert res.status_code == 201, res.text

    cust = _customer(client, h, inv_world, "عميل اللبن")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "60", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "3", "unit_price": "20"}]})
    assert sale.status_code == 201, sale.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("7")

    rev = client.post(f"/api/v1/sales/{sale.json()['id']}/reverse",
                      headers=h, json={"reason": "edit"})
    assert rev.status_code == 201, rev.text
    # Back on the shelf, and back in the lot it came out of.
    assert _on_hand(client, h, item["id"], wh) == Decimal("10")


def test_the_goods_go_back_into_the_lot_they_came_from(client, inv_world, login):
    """Not just onto the shelf — into the right lot.

    Putting them into a new or arbitrary lot would keep the on-hand right and the batch sums
    wrong, which is the invariant the whole perishable feature rests on.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "زبادي", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "is_perishable": True}).json()
    soon = str(date.today() + timedelta(days=5))
    later = str(date.today() + timedelta(days=90))
    for exp, q in ((soon, "4"), (later, "6")):
        client.post("/api/v1/stock/batches", headers=h, json={
            "item_id": item["id"], "location_kind": "warehouse", "location_id": wh,
            "quantity": q, "expiry_date": exp})

    cust = _customer(client, h, inv_world, "عميل الزبادي")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "30", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "3", "unit_price": "10"}]})
    assert sale.status_code == 201, sale.text

    rev = client.post(f"/api/v1/sales/{sale.json()['id']}/reverse",
                      headers=h, json={"reason": "edit"})
    assert rev.status_code == 201, rev.text

    # FEFO took 3 off the earliest lot; the reversal puts 3 back on it, so both lots read as
    # they did before the sale.
    lots = client.get("/api/v1/stock/batches/expiring", headers=h,
                      params={"before": str(date.today() + timedelta(days=365)),
                              "item_id": item["id"]}).json()
    by_expiry = {r["expiry_date"]: Decimal(r["quantity"]) for r in lots}
    assert by_expiry.get(soon) == Decimal("4"), by_expiry
    assert by_expiry.get(later) == Decimal("6"), by_expiry


def test_editing_an_invoice_with_a_serialized_item(client, inv_world, login):
    """The same failure wearing a different hat: «عدد السيريالات لازم يساوي الكمية المرتجعة»."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "جهاز بسيريال", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "500", "is_serialized": True}).json()
    res = client.post(f"/api/v1/items/{item['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh, "serials": ["SN-A1", "SN-A2"]})
    assert res.status_code in (200, 201), res.text

    cust = _customer(client, h, inv_world, "عميل السيريال")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "500",
                   "serials": ["SN-A1"]}]})
    assert sale.status_code == 201, sale.text

    rev = client.post(f"/api/v1/sales/{sale.json()['id']}/reverse",
                      headers=h, json={"reason": "edit"})
    assert rev.status_code == 201, rev.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("2")


def test_editing_an_invoice_that_was_partly_returned(client, inv_world, login):
    """Reverse what is LEFT, rather than refusing because the full quantity no longer fits."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف نص مرتجع", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد النص"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "50", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "5"}]})

    cust = _customer(client, h, inv_world, "عميل النص")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "40", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "4", "unit_price": "10"}]})
    sale_id = sale.json()["id"]

    # A genuine partial customer return first.
    part = client.post(f"/api/v1/sales/{sale_id}/returns", headers=h,
                       json={"lines": [{"item_id": item["id"], "quantity": "1"}]})
    assert part.status_code == 201, part.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("7")

    rev = client.post(f"/api/v1/sales/{sale_id}/reverse", headers=h, json={"reason": "edit"})
    assert rev.status_code == 201, rev.text
    # The remaining 3 came back — not 4, which would have put 11 on a shelf that held 10.
    assert _on_hand(client, h, item["id"], wh) == Decimal("10")


def test_an_invoice_already_returned_in_full_says_so(client, inv_world, login):
    """There is genuinely nothing to reverse — and it says that rather than an arithmetic
    complaint about cumulative quantities."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف كامل المرتجع", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد الكامل"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "50", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "5"}]})

    cust = _customer(client, h, inv_world, "عميل الكامل")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "20", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "10"}]})
    sale_id = sale.json()["id"]

    first = client.post(f"/api/v1/sales/{sale_id}/reverse", headers=h, json={"reason": "edit"})
    assert first.status_code == 201, first.text

    second = client.post(f"/api/v1/sales/{sale_id}/reverse", headers=h, json={"reason": "edit"})
    assert second.status_code == 409, second.text
    assert "اترجّعت بالكامل" in second.json()["detail"]["message"]
