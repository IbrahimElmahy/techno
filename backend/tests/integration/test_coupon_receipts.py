"""استلام الكوبونات من العملاء.

A coupon handed back at the door is a piece of paper with a number on it, and on its own that
number proves nothing — anyone can write one. What makes it real is that it falls inside the
serial range issued on an actual invoice to an actual customer. These tests pin down the three
ways that check has to hold: a serial nobody issued is refused, a serial already handed in cannot
be handed in again, and a coupon issued to one customer cannot be credited to another.
"""
from datetime import date

import pytest


@pytest.fixture()
def sold(client, inv_world, login):
    """A customer holding coupons 1200–1249 from a real invoice, and a second customer."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف الكوبونات", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=admin, json={"name": "مورد"}).json()
    client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "1200", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "20", "unit_price": "60"}]})

    def _customer(name):
        return client.post("/api/v1/customers", headers=admin, json={
            "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
            "territory_id": inv_world["terr_a"]}).json()

    holder = _customer("صاحب الكوبونات")
    other = _customer("عميل تاني")
    invoice = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": holder["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "discount_pct": "0"}],
        "coupon_serial_from": "1200", "coupon_serial_to": "1249"}).json()
    return {"admin": admin, "customer_id": holder["id"], "other_id": other["id"],
            "invoice_id": invoice["id"], "invoice_no": invoice["document_number"]}


def _check(client, h, serial):
    resp = client.get("/api/v1/coupon-receipts/check", headers=h, params={"serial": serial})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_a_serial_traces_back_to_the_invoice_that_issued_it(client, sold):
    admin = sold["admin"]
    out = _check(client, admin, "1225")  # inside the range, not an endpoint
    assert out["status"] == "valid"
    assert out["sales_invoice_id"] == sold["invoice_id"]
    assert out["customer_id"] == sold["customer_id"]
    assert out["customer_name"]


def test_a_serial_nobody_issued_is_refused(client, sold):
    """The whole point: a number written on a scrap of paper is not a coupon."""
    admin = sold["admin"]
    assert _check(client, admin, "9999")["status"] == "unknown"

    resp = client.post("/api/v1/coupon-receipts", headers=admin, json={
        "serials": ["9999"], "customer_id": sold["customer_id"]})
    assert resp.status_code == 422
    assert "9999" in str(resp.json())


def test_coupons_are_received_and_counted(client, sold):
    admin = sold["admin"]
    resp = client.post("/api/v1/coupon-receipts", headers=admin, json={
        "serials": ["1200", "1201", "1202"], "customer_id": sold["customer_id"],
        "received_date": str(date.today())})
    assert resp.status_code == 201, resp.text
    receipt = resp.json()
    assert receipt["document_number"].startswith("CR-")
    assert receipt["coupon_count"] == 3
    assert {ln["serial"] for ln in receipt["lines"]} == {"1200", "1201", "1202"}
    # Every line names the invoice it came from — that is the trace the whole feature exists for.
    assert all(ln["sales_invoice_id"] == sold["invoice_id"] for ln in receipt["lines"])


def test_the_same_coupon_cannot_come_back_twice(client, sold):
    """A coupon is a bearer document. Taking it twice is taking money twice."""
    admin = sold["admin"]
    first = client.post("/api/v1/coupon-receipts", headers=admin, json={
        "serials": ["1210"], "customer_id": sold["customer_id"]})
    assert first.status_code == 201, first.text

    assert _check(client, admin, "1210")["status"] == "received"

    again = client.post("/api/v1/coupon-receipts", headers=admin, json={
        "serials": ["1210"], "customer_id": sold["customer_id"]})
    assert again.status_code == 422
    assert "1210" in str(again.json())


def test_a_coupon_cannot_be_credited_to_another_customer(client, sold):
    admin = sold["admin"]
    resp = client.post("/api/v1/coupon-receipts", headers=admin, json={
        "serials": ["1230"], "customer_id": sold["other_id"]})
    assert resp.status_code == 422
    assert "1230" in str(resp.json())


def test_one_bad_coupon_fails_the_whole_handover(client, sold):
    """A half-accepted handover is worse than a rejected one — the rep walks away believing
    all of it went through."""
    admin = sold["admin"]
    resp = client.post("/api/v1/coupon-receipts", headers=admin, json={
        "serials": ["1240", "9999"], "customer_id": sold["customer_id"]})
    assert resp.status_code == 422

    # The good one must not have been taken on its own.
    assert _check(client, admin, "1240")["status"] == "valid"


def test_a_range_can_be_handed_in_at_once(client, sold):
    admin = sold["admin"]
    resp = client.post("/api/v1/coupon-receipts", headers=admin, json={
        "serial_from": "1205", "serial_to": "1209", "customer_id": sold["customer_id"]})
    assert resp.status_code == 201, resp.text
    assert resp.json()["coupon_count"] == 5


def test_a_retried_receipt_lands_once(client, sold):
    """The app queues handovers offline; a retry after a dropped connection is the same document,
    not a second one."""
    admin = sold["admin"]
    body = {"serials": ["1245"], "customer_id": sold["customer_id"],
            "client_uuid": "abc-123-retry"}
    first = client.post("/api/v1/coupon-receipts", headers=admin, json=body)
    second = client.post("/api/v1/coupon-receipts", headers=admin, json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    listed = client.get("/api/v1/coupon-receipts", headers=admin,
                        params={"customer_id": sold["customer_id"]}).json()
    assert sum(1 for r in listed if r["id"] == first.json()["id"]) == 1


def test_a_rep_can_receive_coupons_on_his_round(client, sold, login):
    """The person at the door is the rep — receiving must not need the loyalty-admin role."""
    rep = login("rep_a")
    resp = client.post("/api/v1/coupon-receipts", headers=rep, json={
        "serials": ["1248"], "customer_id": sold["customer_id"]})
    assert resp.status_code == 201, resp.text
    assert resp.json()["rep_user_id"] is not None
