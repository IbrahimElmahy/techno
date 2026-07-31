"""حركات انتهاء الصلاحية — where each lot went — 031-a5-restructure.

`stock_batch` holds what REMAINS. These pin that every draw is written at the moment it happens,
because it cannot be worked out later: a stock movement says how much moved, never which expiry lot
it came out of, and FEFO makes that choice at the moment of sale.
"""
from __future__ import annotations

from datetime import date, timedelta


def _perishable(client, h, name="صنف بصلاحية"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "20", "is_perishable": True}).json()


def _lot(client, h, item_id, wh, expiry, qty):
    res = client.post("/api/v1/stock/batches", headers=h, json={
        "item_id": item_id, "location_kind": "warehouse", "location_id": wh,
        "expiry_date": str(expiry), "quantity": str(qty)})
    assert res.status_code == 201, res.text
    return res.json()


def _moves(client, h, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    res = client.get(f"/api/v1/stock/batches/movements?{q}", headers=h)
    assert res.status_code == 200, res.text
    return list(reversed(res.json()))   # oldest first, the way a history is read


def _customer(client, h, inv_world, name):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def test_receiving_a_lot_is_the_first_step(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h)
    soon = date.today() + timedelta(days=20)
    _lot(client, h, item["id"], wh, soon, 100)

    moves = _moves(client, h, item_id=item["id"])
    assert [m["kind"] for m in moves] == ["received"]
    assert moves[0]["expiry_date"] == str(soon)
    assert float(moves[0]["quantity"]) == 100.0
    assert moves[0]["location_name"], "a lot in a warehouse must name the warehouse"


def test_a_sale_records_which_lot_it_took_from(client, inv_world, login):
    """The whole point: FEFO's choice is written down, so a recall can trace it to the invoice."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h, "صنف بصلاحية ٢")
    soon = date.today() + timedelta(days=10)
    later = date.today() + timedelta(days=90)
    _lot(client, h, item["id"], wh, soon, 5)
    _lot(client, h, item["id"], wh, later, 50)

    cust = _customer(client, h, inv_world, "عميل الصلاحية")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "160", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "8", "unit_price": "20"}]})
    assert sale.status_code == 201, sale.text
    invoice = sale.json()

    consumed = [m for m in _moves(client, h, item_id=item["id"]) if m["kind"] == "consumed"]
    # Earliest expiry emptied first, the rest off the later lot — two rows, not one lump.
    assert [(m["expiry_date"], float(m["quantity"])) for m in consumed] == [
        (str(soon), 5.0), (str(later), 3.0)]
    assert all(m["document_type"] == "sales_invoice" for m in consumed)
    assert all(m["document_id"] == invoice["id"] for m in consumed)


def test_a_return_puts_it_back_on_the_trail(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h, "صنف بصلاحية ٣")
    expiry = date.today() + timedelta(days=30)
    _lot(client, h, item["id"], wh, expiry, 10)

    cust = _customer(client, h, inv_world, "عميل مرتجع الصلاحية")
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "40", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "20"}]}).json()

    ret = client.post(f"/api/v1/sales/{sale['id']}/returns", headers=h, json={
        "lines": [{"item_id": item["id"], "quantity": "1", "expiry_date": str(expiry)}]})
    assert ret.status_code == 201, ret.text

    moves = _moves(client, h, item_id=item["id"])
    assert [m["kind"] for m in moves] == ["received", "consumed", "returned"]
    assert float(moves[-1]["quantity"]) == 1.0
    assert moves[-1]["expiry_date"] == str(expiry)


def test_a_transfer_is_two_rows_not_one(client, inv_world, login):
    """Out of the source and into the destination. One row with two ends reads ambiguously."""
    h = login("admin")
    src, dest = inv_world["central_wh"], inv_world["branch_wh"]
    item = _perishable(client, h, "صنف بصلاحية ٤")
    expiry = date.today() + timedelta(days=45)
    _lot(client, h, item["id"], src, expiry, 30)

    t = client.post("/api/v1/transfers", headers=h, json={
        "item_id": item["id"], "quantity": "12", "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": src},
        "dest": {"location_kind": "warehouse", "location_id": dest}})
    assert t.status_code == 201, t.text
    # Pending moves nothing, so the trail must not have gained a step yet.
    assert [m["kind"] for m in _moves(client, h, item_id=item["id"])] == ["received"]

    ok = client.post(f"/api/v1/transfers/{t.json()['id']}/approve", headers=h)
    assert ok.status_code == 200, ok.text

    moves = _moves(client, h, item_id=item["id"])
    assert [m["kind"] for m in moves] == ["received", "relocated_out", "relocated_in"]
    out_row, in_row = moves[1], moves[2]
    assert out_row["location_id"] == src and in_row["location_id"] == dest
    assert float(out_row["quantity"]) == float(in_row["quantity"]) == 12.0
    # A move is not a sale. Logging the source draw as «consumed» would say goods were sold.
    assert out_row["document_type"] == "transfer"


def test_the_trail_filters_the_ways_a_recall_asks(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, h, "صنف بصلاحية ٥")
    a = date.today() + timedelta(days=15)
    b = date.today() + timedelta(days=200)
    _lot(client, h, item["id"], wh, a, 4)
    _lot(client, h, item["id"], wh, b, 4)

    # «this exact lot, everywhere it went» — the question the table exists for.
    only_a = _moves(client, h, item_id=item["id"], expiry_date=str(a))
    assert [m["expiry_date"] for m in only_a] == [str(a)]

    assert all(m["kind"] == "received"
               for m in _moves(client, h, item_id=item["id"], kind="received"))
    assert _moves(client, h, item_id=item["id"], kind="consumed") == []
