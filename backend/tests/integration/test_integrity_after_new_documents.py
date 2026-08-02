"""The new 031 documents must leave the books internally consistent.

Four new documents post or withhold stock movements — the free production order, the purchase
return register, the stock count, and the reservation. The serial-count and batch-sum invariants
are the ones a bare quantity adjustment breaks quietly, so each is exercised and the integrity
check is asked afterwards.

Run against the dev database this same check reports pre-existing drift from serials that were
registered without their paired movement. That is the check working; these pin that the new
documents do not add to it.
"""
from __future__ import annotations

from datetime import date, timedelta


def _clean(client, h):
    res = client.get("/api/v1/admin/integrity", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    return body["clean"], body["findings"]


def _product(client, h, name, **kw):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50", **kw}).json()


def _stock(client, h, item_id, wh, qty):
    assert client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "quantity": str(qty),
        "location": {"location_kind": "warehouse", "location_id": wh}}).status_code == 201


def test_a_posted_stock_count_leaves_the_books_consistent(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف جرد سليم")
    _stock(client, h, item["id"], wh, 10)

    sheet = client.post("/api/v1/stock-counts", headers=h,
                        json={"warehouse_id": wh}).json()
    line = next(ln for ln in sheet["lines"] if ln["item_id"] == item["id"])
    client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": line["id"], "counted_quantity": "6"}]})
    assert client.post(f"/api/v1/stock-counts/{sheet['id']}/post",
                       headers=h).status_code == 200

    clean, findings = _clean(client, h)
    assert clean, findings


def test_a_count_never_breaks_the_serial_invariant(client, inv_world, login):
    """The refusal exists for this: adjusting by quantity would leave the serials behind."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف جرد بسرايل", is_serialized=True)
    assert client.post(f"/api/v1/items/{item['id']}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh,
        "serials": ["INT-1", "INT-2", "INT-3"]}).status_code == 201

    sheet = client.post("/api/v1/stock-counts", headers=h, json={"warehouse_id": wh}).json()
    line = next(ln for ln in sheet["lines"] if ln["item_id"] == item["id"])
    client.put(f"/api/v1/stock-counts/{sheet['id']}/counts", headers=h, json={
        "counts": [{"line_id": line["id"], "counted_quantity": "1"}]})
    assert client.post(f"/api/v1/stock-counts/{sheet['id']}/post",
                       headers=h).status_code == 409

    clean, findings = _clean(client, h)
    assert clean, findings


def test_free_production_and_a_purchase_return_leave_it_consistent(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    raw = client.post("/api/v1/items", headers=h, json={
        "name": "خامة السلامة", "kind": "raw_material", "unit_of_measure": "piece",
        "purchase_price": "10"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد السلامة"}).json()
    assert client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "lines": [{"item_id": raw["id"], "quantity": "40", "unit_price": "10"}],
        "cash_amount": "0", "credit_amount": "400"}).status_code == 201
    purchase = client.get("/api/v1/purchases", headers=h).json()[0]

    assert client.post(f"/api/v1/purchases/{purchase['id']}/returns", headers=h, json={
        "lines": [{"item_id": raw["id"], "quantity": "5"}]}).status_code == 201

    prod = _product(client, h, "منتج السلامة")
    assert client.post("/api/v1/manufacturing/orders", headers=h, json={
        "product_id": prod["id"], "quantity": "3",
        "location": {"location_kind": "warehouse", "location_id": wh},
        "components": [{"item_id": raw["id"], "quantity": "9"}]}).status_code == 201

    clean, findings = _clean(client, h)
    assert clean, findings


def test_a_reservation_moves_nothing_so_it_changes_nothing(client, inv_world, login):
    """A hold is a promise, not a movement — the books must not notice it at all."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, h, "صنف محجوز سليم")
    _stock(client, h, item["id"], wh, 8)
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل السلامة", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()

    before = client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh}).json()["on_hand"]

    assert client.post("/api/v1/reservations", headers=h, json={
        "customer_id": cust["id"], "item_id": item["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "quantity": "5", "expires_on": str(date.today() + timedelta(days=3))}
    ).status_code == 201

    after = client.get("/api/v1/stock/on-hand", headers=h, params={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh}).json()["on_hand"]
    assert before == after

    clean, findings = _clean(client, h)
    assert clean, findings
