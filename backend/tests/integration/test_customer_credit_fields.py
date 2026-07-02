"""T005: customer credit_limit + max_due_term_days round-trip and clear. FR-001; SC-001."""


def test_set_and_clear_credit_fields(client, inv_world, login):
    h = login("admin")
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"], "credit_limit": "5000.00",
        "max_due_term_days": 30}).json()
    assert cust["credit_limit"] == "5000.00"
    assert cust["max_due_term_days"] == 30

    got = client.get(f"/api/v1/customers/{cust['id']}", headers=h).json()
    assert got["credit_limit"] == "5000.00"
    assert got["max_due_term_days"] == 30

    # Clearing to null restores "unlimited".
    upd = client.patch(f"/api/v1/customers/{cust['id']}", headers=h, json={
        "credit_limit": None, "max_due_term_days": None}).json()
    assert upd["credit_limit"] is None
    assert upd["max_due_term_days"] is None
