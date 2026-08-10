"""عكس فاتورة شراء — «تعديل» على مستند مرحّل.

A posted purchase cannot be altered in place: the goods are on the shelf and the ledger is
append-only. So «تعديل الفاتورة» means what it means on a sale here — reverse it in full, reopen
the form on what it held, post again — and that needs a door of its own.

It is deliberately NOT `/returns`. A supplier return is a real business event that belongs in
مرتجعات المشتريات; an edit is a correction that happens to be implemented as one. Sending both
through the same endpoint made the returns register count the company's own typing mistakes as
goods sent back to a supplier — the exact reason the sale grew a separate `/reverse` first.
"""
from __future__ import annotations

from decimal import Decimal


def _buy(client, h, wh, *, qty="10", price="60"):
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الشراء", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد العكس"}).json()
    res = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": str(Decimal(qty) * Decimal(price)), "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": qty, "unit_price": price}]})
    assert res.status_code == 201, res.text
    return item, res.json()


def _on_hand(client, h, item_id, wh):
    rows = client.get("/api/v1/stock/by-location", headers=h, params={
        "location_kind": "warehouse", "location_id": wh}).json()
    row = next((r for r in rows if r["item_id"] == item_id), None)
    return Decimal(row["on_hand"]) if row else Decimal("0")


def test_reversing_takes_the_goods_back_off_the_shelf(client, inv_world, login):
    """The whole point: after the reversal the stock is where it was before the invoice."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item, inv = _buy(client, h, wh)
    assert _on_hand(client, h, item["id"], wh) == Decimal("10")

    res = client.post(f"/api/v1/purchases/{inv['id']}/reverse", headers=h, json={"reason": "edit"})
    assert res.status_code == 201, res.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("0")


def test_it_reverses_every_line_without_being_told_which(client, inv_world, login):
    """«تعديل» is not a partial return — the document goes away whole and is rewritten whole.

    Asking the caller to list the lines would let a correction reverse SOME of an invoice and
    reopen ALL of it, which is how a quantity gets counted twice.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    item, inv = _buy(client, h, wh, qty="7")

    # Note: no `lines` in the body at all.
    res = client.post(f"/api/v1/purchases/{inv['id']}/reverse", headers=h, json={"reason": "edit"})
    assert res.status_code == 201, res.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("0")


def test_the_reversal_says_it_is_one(client, inv_world, login):
    """A correction that looks exactly like a supplier return is a correction nobody can find
    again. The note names the invoice it undoes and why."""
    h = login("admin")
    wh = inv_world["central_wh"]
    _item, inv = _buy(client, h, wh)

    ret = client.post(f"/api/v1/purchases/{inv['id']}/reverse",
                      headers=h, json={"reason": "edit"}).json()
    detail = client.get(f"/api/v1/purchases/returns/{ret['id']}", headers=h).json()
    assert inv["document_number"] in (detail.get("notes") or "")
    assert "edit" in (detail.get("notes") or "")


def test_it_still_needs_the_purchase_capability(client, inv_world, login):
    """Unmaking a posted purchase is not something a salesman does by finding the URL."""
    h = login("admin")
    wh = inv_world["central_wh"]
    _item, inv = _buy(client, h, wh)

    res = client.post(f"/api/v1/purchases/{inv['id']}/reverse",
                      headers=login("rep_a"), json={"reason": "edit"})
    assert res.status_code == 403, res.text


def test_an_invoice_that_is_not_there(client, inv_world, login):
    res = client.post("/api/v1/purchases/999999/reverse",
                      headers=login("admin"), json={"reason": "edit"})
    assert res.status_code == 404, res.text


def test_reversing_twice_is_refused_rather_than_doubled(client, inv_world, login):
    """The realistic accident — somebody presses it again. The second pass has nothing left to
    return, and taking the goods off the shelf twice would drive the balance negative."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item, inv = _buy(client, h, wh)

    url = f"/api/v1/purchases/{inv['id']}/reverse"
    first = client.post(url, headers=h, json={"reason": "edit"})
    assert first.status_code == 201, first.text
    second = client.post(url, headers=h, json={"reason": "edit"})
    assert second.status_code == 409, second.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("0")


def test_reversing_an_invoice_that_was_partly_returned(client, inv_world, login):
    """Reverse what is LEFT, not the original quantity.

    Sending the full amount on an invoice that already had a partial supplier return exceeded what
    remained and was refused — so «تعديل» stopped working on exactly the invoices most likely to
    need it. Same defect the sale had, fixed the same way.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    item, inv = _buy(client, h, wh, qty="10")

    part = client.post(f"/api/v1/purchases/{inv['id']}/returns", headers=h,
                       json={"lines": [{"item_id": item["id"], "quantity": "4"}]})
    assert part.status_code == 201, part.text
    assert _on_hand(client, h, item["id"], wh) == Decimal("6")

    rev = client.post(f"/api/v1/purchases/{inv['id']}/reverse",
                      headers=h, json={"reason": "edit"})
    assert rev.status_code == 201, rev.text
    # The remaining 6 went back to the supplier — not 10, which the shelf never held.
    assert _on_hand(client, h, item["id"], wh) == Decimal("0")
