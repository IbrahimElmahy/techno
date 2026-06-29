"""T014: tier-aware sale via API — default pre-fill, per-line override, below-price, 002 unchanged."""
from decimal import Decimal

FIVE = [
    {"tier": "commercial", "price": "100.00"},
    {"tier": "wholesale", "price": "90.00"},
    {"tier": "consumer", "price": "130.00"},
]


def _product(client, h, price="100"):
    p = client.post("/api/v1/items", headers=h, json={
        "name": "Gadget", "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()
    client.put(f"/api/v1/items/{p['id']}/prices", headers=h, json={"tiers": FIVE})
    return p


def _customer(client, h, rep, terr, tier=None):
    return client.post("/api/v1/customers", headers=h, json={
        "name": "K", "customer_type": "trader", "rep_id": rep, "territory_id": terr,
        "default_price_tier": tier}).json()


def _seed_custody(client, h, item_id, custody_id, qty):
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def test_default_tier_prefills_line_price(client, inv_world, login):
    h = login("admin")
    prod = _product(client, h)
    cust = _customer(client, h, inv_world["rep_a"], inv_world["terr_a"], tier="wholesale")
    _seed_custody(client, h, prod["id"], inv_world["custody_a"], "5")

    rep = login("rep_a")
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "cash_amount": "0", "credit_amount": "90",
        "lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["net"]) == Decimal("90.00")  # wholesale, not base 100
    detail = client.get(f"/api/v1/sales/{resp.json()['id']}", headers=rep).json()
    assert detail["lines"][0]["price_tier"] == "wholesale"
    assert detail["lines"][0]["unit_price"] == "90.00"


def test_explicit_tier_override(client, inv_world, login):
    h = login("admin")
    prod = _product(client, h)
    cust = _customer(client, h, inv_world["rep_a"], inv_world["terr_a"], tier="wholesale")
    _seed_custody(client, h, prod["id"], inv_world["custody_a"], "5")

    rep = login("rep_a")
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "cash_amount": "0", "credit_amount": "130",
        "lines": [{"item_id": prod["id"], "quantity": "1", "tier": "consumer"}]})
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["net"]) == Decimal("130.00")


def test_rep_below_price_rejected_manager_allowed(client, inv_world, login):
    h = login("admin")
    prod = _product(client, h)
    cust = _customer(client, h, inv_world["rep_a"], inv_world["terr_a"], tier="wholesale")
    _seed_custody(client, h, prod["id"], inv_world["custody_a"], "5")

    # Rep (no sell.below_price) tries to sell below wholesale 90 → rejected.
    rep = login("rep_a")
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "cash_amount": "0", "credit_amount": "80",
        "lines": [{"item_id": prod["id"], "quantity": "1", "unit_price": "80"}]})
    assert resp.status_code == 422

    # Manager has the capability → allowed (sells from a branch warehouse).
    # seed branch warehouse stock first
    client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": prod["id"], "location": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "quantity": "5"})
    bm = login("bm_a")
    resp = client.post("/api/v1/sales", headers=bm, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "cash_amount": "80", "credit_amount": "0",
        "lines": [{"item_id": prod["id"], "quantity": "1", "unit_price": "80"}]})
    assert resp.status_code == 201, resp.text
    assert Decimal(resp.json()["net"]) == Decimal("80.00")


def test_002_math_unchanged_with_tiers(client, inv_world, login):
    # A sale priced by tier behaves exactly like 002: gross→discount→net→cash/credit, one ledger entry.
    h = login("admin")
    prod = _product(client, h)
    cust = _customer(client, h, inv_world["rep_a"], inv_world["terr_a"], tier="commercial")  # 100
    _seed_custody(client, h, prod["id"], inv_world["custody_a"], "5")

    rep = login("rep_a")
    resp = client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "10", "cash_amount": "0", "credit_amount": "270",
        "lines": [{"item_id": prod["id"], "quantity": "3"}]})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert Decimal(body["gross"]) == Decimal("300.00")   # 3 × commercial 100
    assert Decimal(body["net"]) == Decimal("270.00")     # − 10%
    assert body["ledger_entry_id"] > 0
