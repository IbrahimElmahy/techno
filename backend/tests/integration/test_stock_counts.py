"""جرد المخازن — the counting cycle — 031-a5-restructure."""
from __future__ import annotations

from decimal import Decimal


def _product(client, h, name, **kw):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50", **kw}).json()


def _stock(client, h, item_id, wh, qty):
    res = client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "quantity": str(qty),
        "location": {"location_kind": "warehouse", "location_id": wh}})
    assert res.status_code == 201, res.text


def _on_hand(client, h, item_id, wh):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": wh}).json()["on_hand"])


def _open(client, h, wh=None, **kw):
    body = {**kw}
    if wh is not None:
        body["warehouse_id"] = wh
    res = client.post("/api/v1/stock-counts", headers=h, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _line_for(sheet, item_id):
    return next(ln for ln in sheet["lines"] if ln["item_id"] == item_id)


def test_the_sheet_opens_with_the_books_and_settles_to_the_count(client, inv_world, login):
    """The cycle end to end: book 10, counted 7, on-hand ends at 7."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف الجرد")
    _stock(client, h, item["id"], wh, 10)

    sheet = _open(client, h, wh)
    line = _line_for(sheet, item["id"])
    assert Decimal(line["book_quantity"]) == Decimal("10.000")
    assert line["counted_quantity"] is None, "an unopened line is not zero"
    assert line["difference"] is None

    entered = client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": line["id"], "counted_quantity": "7"}]})
    assert entered.status_code == 200, entered.text
    assert Decimal(_line_for(entered.json(), item["id"])["difference"]) == Decimal("-3.000")

    posted = client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h)
    assert posted.status_code == 200, posted.text
    assert posted.json()["status"] == "posted"
    assert _on_hand(client, h, item["id"], wh) == Decimal("7.000")
    assert _line_for(posted.json(), item["id"])["stock_movement_id"] is not None


def test_a_count_that_finds_more_puts_it_in(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف زيادة")
    _stock(client, h, item["id"], wh, 4)

    sheet = _open(client, h, wh)
    line = _line_for(sheet, item["id"])
    client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": line["id"], "counted_quantity": "9"}]})
    client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h)
    assert _on_hand(client, h, item["id"], wh) == Decimal("9.000")


def test_stock_that_moved_during_the_count_is_not_applied_twice(client, inv_world, login):
    """The whole reason the snapshot and the adjustment use different numbers.

    Book 20 when the sheet opened, a real sale of 5 during the count, counter finds 12. Adjusting
    by the sheet's difference (12 − 20 = −8) would leave 7. Adjusting against current stock leaves
    exactly the 12 that were counted.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف اتحرك")
    _stock(client, h, item["id"], wh, 20)

    sheet = _open(client, h, wh)
    line = _line_for(sheet, item["id"])
    assert Decimal(line["book_quantity"]) == Decimal("20.000")

    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل أثناء الجرد", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "250", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "5", "unit_price": "50"}]})
    assert sale.status_code == 201, sale.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("15.000")

    client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": line["id"], "counted_quantity": "12"}]})
    client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h)

    assert _on_hand(client, h, item["id"], wh) == Decimal("12.000")


def test_uncounted_lines_are_left_alone(client, inv_world, login):
    """A blank is «nobody reached this shelf», not «the shelf is empty»."""
    h = login("admin")
    wh = inv_world["central_wh"]
    counted = _product(client, h, "صنف متعدود")
    skipped = _product(client, h, "صنف مش متعدود")
    _stock(client, h, counted["id"], wh, 6)
    _stock(client, h, skipped["id"], wh, 6)

    sheet = _open(client, h, wh)
    client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": _line_for(sheet, counted["id"])["id"], "counted_quantity": "2"}]})
    client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h)

    assert _on_hand(client, h, counted["id"], wh) == Decimal("2.000")
    assert _on_hand(client, h, skipped["id"], wh) == Decimal("6.000")


def test_zero_is_a_real_count(client, inv_world, login):
    """«The shelf is empty» has to be sayable, or an empty shelf can never be recorded."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف خلص")
    _stock(client, h, item["id"], wh, 5)

    sheet = _open(client, h, wh)
    client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": _line_for(sheet, item["id"])["id"], "counted_quantity": "0"}]})
    client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h)
    assert _on_hand(client, h, item["id"], wh) == Decimal("0.000")


def test_serialized_and_perishable_differences_are_refused_as_a_whole(client, inv_world, login):
    """A bare quantity adjustment would move on-hand and leave the serials and lots behind."""
    h = login("admin")
    wh = inv_world["central_wh"]
    plain = _product(client, h, "صنف عادي")
    tracked = _product(client, h, "صنف بسرايل", is_serialized=True)
    _stock(client, h, plain["id"], wh, 5)
    client.post(f"/api/v1/items/{tracked['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh, "serials": ["CNT-1", "CNT-2"]})

    sheet = _open(client, h, wh)
    res = client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [
            {"line_id": _line_for(sheet, plain["id"])["id"], "counted_quantity": "3"},
            {"line_id": _line_for(sheet, tracked["id"])["id"], "counted_quantity": "1"},
        ]})
    assert res.status_code == 200, res.text

    posted = client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h)
    assert posted.status_code == 409
    assert "سرايل" in posted.json()["detail"]["message"]
    # Refused as a whole: the plain item must not have been adjusted on the way to the failure.
    assert _on_hand(client, h, plain["id"], wh) == Decimal("5.000")


def test_a_posted_sheet_is_closed(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف مقفول")
    _stock(client, h, item["id"], wh, 3)
    sheet = _open(client, h, wh)
    line = _line_for(sheet, item["id"])
    client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": line["id"], "counted_quantity": "3"}]})
    client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h)

    again = client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": line["id"], "counted_quantity": "99"}]})
    assert again.status_code == 409
    assert client.post(f"/api/v1/stock-counts/{sheet['id']}/post", headers=h).status_code == 409
    # Cancelling a posted sheet would suggest its movements went away. They did not.
    assert client.post(f"/api/v1/stock-counts/{sheet['id']}/cancel", headers=h).status_code == 409


def test_a_general_count_covers_every_warehouse(client, inv_world, login):
    """جرد عام المخازن — the same document with no warehouse named."""
    h = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    item = _product(client, h, "صنف في مخزنين")
    _stock(client, h, item["id"], central, 5)
    _stock(client, h, item["id"], branch, 8)

    sheet = _open(client, h)          # no warehouse_id
    assert sheet["warehouse_id"] is None
    places = {ln["warehouse_id"] for ln in sheet["lines"] if ln["item_id"] == item["id"]}
    assert places == {central, branch}
