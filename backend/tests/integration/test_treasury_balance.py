"""T044: singleton treasury, derived zero balance at setup. FR-024; US1 scenario 4; SC-004."""


def test_treasury_balance_zero_and_derived(client, world, login):
    admin = login("admin")
    resp = client.get("/api/v1/treasury/balance", headers=admin)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["balance"] in ("0.00", "0", 0)
    # A second read returns the same singleton account id.
    again = client.get("/api/v1/treasury/balance", headers=admin).json()
    assert again["account_id"] == body["account_id"]


def test_posting_then_balance_is_derived(client, world, login):
    admin = login("admin")
    treasury_acc = client.get("/api/v1/treasury/balance", headers=admin).json()["account_id"]
    # Create a custody to get a second account to balance against.
    custody = client.post(
        "/api/v1/custodies", headers=admin, json={"holder_type": "rep", "rep_id": world["rep_a"]}
    ).json()
    custody_balance = client.get(
        f"/api/v1/custodies/{custody['id']}/balance", headers=admin
    ).json()
    custody_acc = custody_balance["account_id"]

    post = client.post(
        "/api/v1/ledger/entries",
        headers=admin,
        json={
            "entry_type": "cash_handover",
            "lines": [
                {"account_id": treasury_acc, "direction": "debit", "amount": "500.00"},
                {"account_id": custody_acc, "direction": "credit", "amount": "500.00"},
            ],
        },
    )
    assert post.status_code == 201, post.text
    bal = client.get("/api/v1/treasury/balance", headers=admin).json()
    assert bal["balance"] == "500.00"
