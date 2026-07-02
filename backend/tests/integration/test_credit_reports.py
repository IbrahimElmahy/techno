"""T013: credit-exposure + overdue reports. FR-007/008; SC-004."""
from datetime import date, timedelta


def _product(client, h, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _customer(client, h, rep_id, terr_id, name, **extra):
    body = {"name": name, "customer_type": "trader", "rep_id": rep_id, "territory_id": terr_id}
    body.update(extra)
    return client.post("/api/v1/customers", headers=h, json=body).json()


def _seed(client, h, item_id, custody_id, qty):
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def test_credit_exposure_report(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin)
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"], "Owing",
                     credit_limit="1000.00")
    _seed(client, admin, prod["id"], inv_world["custody_a"], "20")
    rep = login("rep_a")
    client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "cash_amount": "0", "credit_amount": "600", "lines": [{"item_id": prod["id"], "quantity": "6"}]})

    rows = client.get("/api/v1/reports/credit-exposure", headers=admin).json()
    row = next(r for r in rows if r["customer_id"] == cust["id"])
    assert row["credit_limit"] == "1000.00"
    assert row["outstanding"] == "600.00"      # derived from the ledger
    assert row["available"] == "400.00"
    assert row["over_limit"] is False


def test_overdue_report(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin)
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"], "Late",
                     max_due_term_days=30)
    _seed(client, admin, prod["id"], inv_world["custody_a"], "20")
    rep = login("rep_a")
    sale = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "due_term_days": 30, "cash_amount": "0", "credit_amount": "500",
        "lines": [{"item_id": prod["id"], "quantity": "5"}]}).json()

    # as_of far past the due_date (today+30) → the invoice is overdue and unsettled.
    future = (date.today() + timedelta(days=100)).isoformat()
    rows = client.get("/api/v1/reports/overdue", headers=admin, params={"as_of": future}).json()
    row = next(r for r in rows if r["invoice_id"] == sale["id"])
    assert row["customer_id"] == cust["id"]
    assert row["outstanding"] == "500.00"

    # as_of before the due_date → not overdue yet.
    early = date.today().isoformat()
    rows2 = client.get("/api/v1/reports/overdue", headers=admin, params={"as_of": early}).json()
    assert all(r["invoice_id"] != sale["id"] for r in rows2)
