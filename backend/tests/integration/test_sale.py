"""T038: rep sale end-to-end + scope + price snapshot. FR-017–020, FR-011; US4; SC-004/005."""
from decimal import Decimal

from src.models.sales import SalesInvoiceLine


def _product(client, h, price="100"):
    return client.post("/api/v1/items", headers=h,
                       json={"name": "Gadget", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": price}).json()


def _customer(client, h, rep_id, terr_id, name="K"):
    return client.post("/api/v1/customers", headers=h,
                       json={"name": name, "customer_type": "trader", "rep_id": rep_id,
                             "territory_id": terr_id}).json()


def _seed_custody_stock(client, h, item_id, custody_id, qty):
    # Produce product directly into the rep custody to seed sellable stock.
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def test_rep_sells_from_own_custody(client, inv_world, login, Session):
    admin = login("admin")
    prod = _product(client, admin)
    cust = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"])
    _seed_custody_stock(client, admin, prod["id"], inv_world["custody_a"], "5")

    rep = login("rep_a")
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "10", "cash_amount": "0", "credit_amount": "270",
        "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert Decimal(body["net"]) == Decimal("270.00")  # 300 − 10% (fixed default 0)
    assert body["cash_account_id"] == inv_world["custody_a_account"]

    oh = client.get("/api/v1/stock/on-hand", headers=rep, params={
        "item_id": prod["id"], "location_kind": "custody", "location_id": inv_world["custody_a"]}).json()
    assert Decimal(oh["on_hand"]) == Decimal("2.000")

    # Price snapshot: changing the product price doesn't alter the posted line.
    client.patch(f"/api/v1/items/{prod['id']}", headers=admin, json={"sale_price": "999"})
    s = Session()
    line = s.query(SalesInvoiceLine).first()
    assert Decimal(line.unit_price) == Decimal("100.00")
    s.close()


def test_no_negative_and_cross_rep_denied(client, inv_world, login):
    admin = login("admin")
    prod = _product(client, admin)
    cust_b = _customer(client, admin, inv_world["rep_b"], inv_world["terr_b"], "KB")
    _seed_custody_stock(client, admin, prod["id"], inv_world["custody_a"], "2")

    rep = login("rep_a")
    # Selling another rep's customer → 403.
    assert client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust_b["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "1"}]}).status_code == 403

    own = _customer(client, admin, inv_world["rep_a"], inv_world["terr_a"], "KA")
    # Selling more than on-hand → 409.
    assert client.post("/api/v1/sales", headers=rep, json={
        "customer_id": own["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": "1000", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "10"}]}).status_code == 409
