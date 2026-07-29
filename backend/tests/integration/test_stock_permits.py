"""إذن إضافة / إذن صرف — stock in and out without a purchase or a sale (B5).

Not every movement of goods is a trade. Stock is found in a count, comes back from a workshop,
goes out as a sample, or is written off — and until now the only way to record that was to invent
a purchase or a sale, which would have polluted the sales figures and the profit with movements
that were never traded. A permit is the honest document for those: it moves quantity, it carries a
cost for the stock reports, and it posts nothing to the sales ledger.

It obeys the same two rules every stock document obeys: it can never drive a balance negative
(Principle XI), and it is reversed rather than edited or deleted, once.
"""
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


def _permit(client, h, kind, wh, lines, **extra):
    return client.post("/api/v1/stock/permits", headers=h, json={
        "kind": kind, "warehouse_id": wh, "lines": lines, **extra})


def _on_hand(client, h, item_id, wh):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item_id, "location_kind": "warehouse", "location_id": wh}).json()["on_hand"])


def test_a_receipt_permit_adds_stock(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "إذن إضافة")

    resp = _permit(client, admin, "receipt", wh, [
        {"item_id": item["id"], "quantity": "8", "unit_cost": "55"}], reason="جرد افتتاحي")
    assert resp.status_code == 201, resp.text
    doc = resp.json()
    assert doc["document_number"].startswith("ADD-")
    assert _on_hand(client, admin, item["id"], wh) == Decimal("8.000")
    assert Decimal(doc["total_cost"]) == Decimal("440.00")  # 8 × 55


def test_an_issue_permit_takes_stock_out(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "إذن صرف")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "10")

    resp = _permit(client, admin, "issue", wh, [
        {"item_id": item["id"], "quantity": "3"}], reason="عينة معرض")
    assert resp.status_code == 201, resp.text
    assert resp.json()["document_number"].startswith("ISS-")
    assert _on_hand(client, admin, item["id"], wh) == Decimal("7.000")


def test_an_issue_cannot_drive_the_balance_negative(client, inv_world, login):
    """The whole point of Principle XI: no document, however administrative, may invent stock."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "ممنوع سالب")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "2")

    resp = _permit(client, admin, "issue", wh, [{"item_id": item["id"], "quantity": "5"}])
    assert resp.status_code == 409, resp.text
    assert _on_hand(client, admin, item["id"], wh) == Decimal("2.000")


def test_the_whole_permit_fails_if_one_line_is_short(client, inv_world, login):
    """A permit is one document, so it posts entirely or not at all."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    good = _product(client, admin, "متاح")
    short = _product(client, admin, "ناقص")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], good["id"], wh, "10")
    _buy(client, admin, sup["id"], short["id"], wh, "1")

    resp = _permit(client, admin, "issue", wh, [
        {"item_id": good["id"], "quantity": "4"},
        {"item_id": short["id"], "quantity": "9"}])
    assert resp.status_code == 409, resp.text
    # The available line must not have gone out on its own.
    assert _on_hand(client, admin, good["id"], wh) == Decimal("10.000")


def test_a_permit_is_reversed_not_deleted_and_only_once(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "عكس")

    doc = _permit(client, admin, "receipt", wh, [
        {"item_id": item["id"], "quantity": "6", "unit_cost": "50"}]).json()
    assert _on_hand(client, admin, item["id"], wh) == Decimal("6.000")

    first = client.post(f"/api/v1/stock/permits/{doc['id']}/reverse", headers=admin)
    assert first.status_code == 201, first.text
    assert _on_hand(client, admin, item["id"], wh) == Decimal("0.000")

    again = client.post(f"/api/v1/stock/permits/{doc['id']}/reverse", headers=admin)
    assert again.status_code == 409


def test_an_issue_costs_itself_from_the_costing_method(client, inv_world, login):
    """Nobody types a cost when stock goes out — it is what the stock actually cost us."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "مكلّف")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "10", "60")

    doc = _permit(client, admin, "issue", wh, [{"item_id": item["id"], "quantity": "2"}]).json()
    assert Decimal(doc["lines"][0]["unit_cost"]) == Decimal("60.00")
    assert Decimal(doc["total_cost"]) == Decimal("120.00")


def test_permits_are_listed_and_readable(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "مسرود")
    created = _permit(client, admin, "receipt", wh, [
        {"item_id": item["id"], "quantity": "4", "unit_cost": "10"}], reason="مرتجع من ورشة").json()

    rows = client.get("/api/v1/stock/permits", headers=admin, params={"kind": "receipt"}).json()
    assert any(r["id"] == created["id"] for r in rows)

    one = client.get(f"/api/v1/stock/permits/{created['id']}", headers=admin).json()
    assert one["reason"] == "مرتجع من ورشة"
    assert len(one["lines"]) == 1
    assert one["lines"][0]["item_name"]


def test_a_permit_shows_up_on_the_item_card(client, inv_world, login):
    """If a permit moved the stock, the card must say so — otherwise the balance has no cause."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "بالكارت")
    _permit(client, admin, "receipt", wh, [
        {"item_id": item["id"], "quantity": "5", "unit_cost": "20"}])

    card = client.get(f"/api/v1/items/{item['id']}/card", headers=admin, params={
        "location_kind": "warehouse", "location_id": wh}).json()
    assert card["rows"][0]["movement_type"] == "permit_in"
    assert card["rows"][0]["source_doc_type"] == "stock_permit"
    assert Decimal(card["closing_balance"]) == Decimal("5.000")


def test_opening_stock_is_its_own_kind_of_permit(client, inv_world, login):
    """بضاعة أول المدة — the stock the company already had on the day it started.

    Mechanically a receipt: same direction, same typed cost. Kept as a kind of its own because the
    label is the point — «إمتى بدأنا؟» has to be answerable, and a stock-as-of-date report for a day
    before go-live must not show goods the system was not yet keeping.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف أول المدة", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()

    permit = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "opening", "warehouse_id": wh, "permit_date": "2026-01-01",
        "reason": "رصيد أول المدة",
        "lines": [{"item_id": item["id"], "quantity": "40", "unit_cost": "25"}]})
    assert permit.status_code == 201, permit.text
    body = permit.json()
    assert body["kind"] == "opening"
    assert body["document_number"].startswith("OPEN")
    # The typed cost is kept — only the person loading the opening knows what the goods cost.
    assert Decimal(body["total_cost"]) == Decimal("1000.00")

    on_hand = client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh}).json()
    assert Decimal(on_hand["on_hand"]) == Decimal("40.000")

    # It is filterable on its own, which is what makes the label useful.
    openings = client.get("/api/v1/stock/permits", headers=h, params={"kind": "opening"}).json()
    assert any(p["id"] == body["id"] for p in openings)
    receipts = client.get("/api/v1/stock/permits", headers=h, params={"kind": "receipt"}).json()
    assert all(p["id"] != body["id"] for p in receipts)


def test_an_opening_reverses_as_an_issue(client, inv_world, login):
    """What went in has to come out — the reversal is a correction, not a second opening."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف أول المدة ٢", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    permit = client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "opening", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_cost": "5"}]}).json()

    rev = client.post(f"/api/v1/stock/permits/{permit['id']}/reverse", headers=h)
    assert rev.status_code == 201, rev.text
    assert rev.json()["kind"] == "issue"
    on_hand = client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh}).json()
    assert Decimal(on_hand["on_hand"]) == Decimal("0.000")
