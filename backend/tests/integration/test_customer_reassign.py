"""T052: reassignment keeps account/balance; history stays with original rep.

US3 scenario 4; FR-020a.
"""


def test_reassign_preserves_account_and_history(client, world, login):
    admin = login("admin")
    created = client.post(
        "/api/v1/customers",
        headers=admin,
        json={
            "name": "Reassign Me",
            "customer_type": "trader",
            "rep_id": world["rep_a"],
            "territory_id": world["terr_a"],
        },
    ).json()
    cid = created["id"]
    acct_before = client.get(f"/api/v1/customers/{cid}/account", headers=admin).json()

    # Post a receivable movement attributed to rep_a (the original rep).
    treasury_acc = client.get("/api/v1/treasury/balance", headers=admin).json()["account_id"]
    client.post(
        "/api/v1/ledger/entries",
        headers=admin,
        json={
            "entry_type": "credit_sale",
            "rep_id": world["rep_a"],
            "lines": [
                {"account_id": acct_before["account_id"], "direction": "debit", "amount": "300.00"},
                {"account_id": treasury_acc, "direction": "credit", "amount": "300.00"},
            ],
        },
    )

    # Reassign to rep_b / territory_b.
    resp = client.post(
        f"/api/v1/customers/{cid}/reassign",
        headers=admin,
        json={"new_rep_id": world["rep_b"], "new_territory_id": world["terr_b"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["rep_id"] == world["rep_b"]

    # Same account id and same (continuous) balance.
    acct_after = client.get(f"/api/v1/customers/{cid}/account", headers=admin).json()
    assert acct_after["account_id"] == acct_before["account_id"]
    assert acct_after["balance"] == "300.00"

    # Prior ledger entry remains attributed to the original rep (rep_a).
    entries = client.get("/api/v1/ledger/entries", headers=admin).json()
    sale = [e for e in entries if e["entry_type"] == "credit_sale"][0]
    assert sale["rep_id"] == world["rep_a"]
