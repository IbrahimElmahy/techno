"""T007/T010: credit-limit + due-term enforcement at sale time. FR-002/004/005/006; SC-002/003."""
from datetime import date, timedelta


def _product(client, h, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _customer(client, h, rep_id, terr_id, **extra):
    body = {"name": "K", "customer_type": "trader", "rep_id": rep_id, "territory_id": terr_id}
    body.update(extra)
    return client.post("/api/v1/customers", headers=h, json=body).json()


def _seed(client, h, item_id, custody_id, qty):
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def test_over_limit_credit_sale_blocked_cash_and_override_allowed(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin)
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"], credit_limit="1000.00")
    _seed(client, admin, prod["id"], inv_world["custody_a"], "50")

    rep = login("rep_a")
    origin = {"location_kind": "custody", "location_id": inv_world["custody_a"]}

    # Credit sale of 800 → outstanding 800 (under 1000).
    r1 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "cash_amount": "0", "credit_amount": "800", "lines": [{"item_id": prod["id"], "quantity": "8"}]})
    assert r1.status_code == 201, r1.text

    # Another credit sale of 300 → 800+300 > 1000 → blocked (rep has no override).
    r2 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "cash_amount": "0", "credit_amount": "300", "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert r2.status_code == 409, r2.text
    assert r2.json()["detail"]["code"] == "credit_limit_exceeded"

    # The same amount as a CASH sale is never blocked.
    r3 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "cash_amount": "300", "credit_amount": "0", "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert r3.status_code == 201, r3.text

    # An override-capable actor (admin) may exceed the limit.
    r4 = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"], "origin": origin,
        "cash_amount": "0", "credit_amount": "300", "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert r4.status_code == 201, r4.text


def test_limit_reached_exactly_is_allowed(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin)
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"], credit_limit="1000.00")
    _seed(client, admin, prod["id"], inv_world["custody_a"], "20")
    rep = login("rep_a")
    origin = {"location_kind": "custody", "location_id": inv_world["custody_a"]}
    # Exactly at the ceiling → allowed (only strictly above blocks).
    r = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin,
        "cash_amount": "0", "credit_amount": "1000", "lines": [{"item_id": prod["id"], "quantity": "10"}]})
    assert r.status_code == 201, r.text


def test_null_limit_never_blocks(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin)
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"])  # no limit
    _seed(client, admin, prod["id"], inv_world["custody_a"], "100")
    rep = login("rep_a")
    r = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "cash_amount": "0", "credit_amount": "5000", "lines": [{"item_id": prod["id"], "quantity": "50"}]})
    assert r.status_code == 201, r.text


def test_due_term_enforced_and_due_date_stamped(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin)
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"], max_due_term_days=30)
    _seed(client, admin, prod["id"], inv_world["custody_a"], "20")
    rep = login("rep_a")
    origin = {"location_kind": "custody", "location_id": inv_world["custody_a"]}

    # Term beyond the customer's maximum → blocked (no override for the term cap).
    r1 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin, "due_term_days": 45,
        "cash_amount": "0", "credit_amount": "100", "lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert r1.status_code == 409, r1.text

    # Within the maximum → allowed and due_date = today + term.
    r2 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin, "due_term_days": 30,
        "cash_amount": "0", "credit_amount": "100", "lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert r2.status_code == 201, r2.text
    assert r2.json()["due_date"] == (date.today() + timedelta(days=30)).isoformat()

    # A cash-only sale ignores the term entirely (no due_date).
    r3 = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"], "origin": origin, "due_term_days": 999,
        "cash_amount": "100", "credit_amount": "0", "lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert r3.status_code == 201, r3.text
    assert r3.json()["due_date"] is None
