"""Document-level fields on a sale: rep, posting account, paper number, notes — 030 (US3).

These are what let the invoice match the paper trail and feed rep reports. The posting account
matters most: choosing it must actually change where revenue lands, and a group account must be
refused rather than quietly corrupting the trial balance.
"""
from decimal import Decimal

from src.models.ledger import Account, LedgerLine


def _product(client, h, name="Doc"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()


def _customer(client, h, inv_world):
    return client.post("/api/v1/customers", headers=h, json={
        "name": "C", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _seed(client, h, item_id, wh, qty):
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": "warehouse", "location_id": wh},
        "quantity": qty})


def _sale_body(cust_id, wh, item_id, **extra):
    body = {
        "customer_id": cust_id,
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": "2", "discount_pct": "0"}],
    }
    body.update(extra)
    return body


def test_document_fields_persist_and_are_returned(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin)
    _seed(client, admin, item["id"], wh, "10")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json=_sale_body(
        cust["id"], wh, item["id"],
        rep_id=inv_world["rep_a"], external_document_number="PAPER-77",
        notes="تسليم بالسيارة", statement1="بيان١", statement2="بيان٢", statement3="بيان٣"))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["rep_id"] == inv_world["rep_a"]
    assert body["external_document_number"] == "PAPER-77"
    assert body["notes"] == "تسليم بالسيارة"


def test_filter_invoices_by_rep_and_external_document_number(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Filterable")
    _seed(client, admin, item["id"], wh, "20")
    cust = _customer(client, admin, inv_world)

    client.post("/api/v1/sales", headers=admin, json=_sale_body(
        cust["id"], wh, item["id"], rep_id=inv_world["rep_a"], external_document_number="AAA-1"))
    client.post("/api/v1/sales", headers=admin, json=_sale_body(
        cust["id"], wh, item["id"], rep_id=inv_world["rep_b"], external_document_number="BBB-2"))

    by_rep = client.get("/api/v1/sales", headers=admin,
                        params={"rep_id": inv_world["rep_a"]}).json()
    assert len(by_rep) == 1 and by_rep[0]["external_document_number"] == "AAA-1"

    by_doc = client.get("/api/v1/sales", headers=admin,
                        params={"external_document_number": "BBB"}).json()
    assert len(by_doc) == 1 and by_doc[0]["rep_id"] == inv_world["rep_b"]


def test_chosen_revenue_account_receives_the_credit(client, inv_world, login, Session):
    """Naming a revenue account must actually move where the money posts."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Routed")
    _seed(client, admin, item["id"], wh, "10")
    cust = _customer(client, admin, inv_world)

    alt = client.post("/api/v1/accounts", headers=admin, json={
        "code": "4100", "name": "مبيعات فرع أ", "nature": "income", "is_postable": True}).json()

    resp = client.post("/api/v1/sales", headers=admin, json=_sale_body(
        cust["id"], wh, item["id"], revenue_account_id=alt["id"]))
    assert resp.status_code == 201, resp.text

    s = Session()
    try:
        credited = [
            ln.account_id for ln in
            s.query(LedgerLine).filter(LedgerLine.entry_id == resp.json()["ledger_entry_id"]).all()
            if str(getattr(ln.direction, "value", ln.direction)) == "credit"
        ]
    finally:
        s.close()
    assert alt["id"] in credited, "revenue must land on the account named on the document"


def test_group_revenue_account_is_refused(client, inv_world, login):
    """A non-postable (group) account would corrupt the trial balance — refuse it up front."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Grouped")
    _seed(client, admin, item["id"], wh, "10")
    cust = _customer(client, admin, inv_world)

    group = client.post("/api/v1/accounts", headers=admin, json={
        "code": "4200", "name": "مجموعة الإيرادات", "nature": "income",
        "is_postable": False}).json()

    resp = client.post("/api/v1/sales", headers=admin, json=_sale_body(
        cust["id"], wh, item["id"], revenue_account_id=group["id"]))
    assert resp.status_code == 422, resp.text
