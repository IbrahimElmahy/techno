"""T060: each audited action produces a record with actor + before/after. SC-007; FR-031."""


def _actions(client, headers):
    rows = client.get("/api/v1/audit", headers=headers).json()
    return {r["action"] for r in rows}


def test_login_success_and_failure_audited(client, world, login):
    # Failed login.
    client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong"})
    admin = login("admin")  # success
    actions = _actions(client, admin)
    assert "login.success" in actions
    assert "login.fail" in actions


def test_user_create_and_deactivate_audited(client, world, login):
    admin = login("admin")
    client.post(
        "/api/v1/users",
        headers=admin,
        json={"username": "newbie", "password": "pw", "role": "after_sales_staff",
              "full_name": "Newbie"},
    )
    client.post(f"/api/v1/users/{world['sm_a']}/deactivate", headers=admin)
    actions = _actions(client, admin)
    assert "user.create" in actions
    assert "user.deactivate" in actions


def test_reassign_and_ledger_audited(client, world, login):
    admin = login("admin")
    c = client.post(
        "/api/v1/customers", headers=admin,
        json={"name": "X", "customer_type": "trader",
              "rep_id": world["rep_a"], "territory_id": world["terr_a"]},
    ).json()
    client.post(
        f"/api/v1/customers/{c['id']}/reassign", headers=admin,
        json={"new_rep_id": world["rep_b"], "new_territory_id": world["terr_b"]},
    )
    treasury_acc = client.get("/api/v1/treasury/balance", headers=admin).json()["account_id"]
    cust_acc = client.get(f"/api/v1/customers/{c['id']}/account", headers=admin).json()["account_id"]
    entry = client.post(
        "/api/v1/ledger/entries", headers=admin,
        json={"entry_type": "credit_sale",
              "lines": [
                  {"account_id": cust_acc, "direction": "debit", "amount": "20.00"},
                  {"account_id": treasury_acc, "direction": "credit", "amount": "20.00"},
              ]},
    ).json()
    client.post(f"/api/v1/ledger/entries/{entry['id']}/reverse", headers=admin)

    actions = _actions(client, admin)
    assert {"customer.reassign", "ledger.post", "ledger.reverse"} <= actions

    # Reassignment record carries before/after attribution.
    rows = client.get("/api/v1/audit?action=customer.reassign", headers=admin).json()
    assert rows[0]["before"]["rep_id"] == world["rep_a"]
    assert rows[0]["after"]["rep_id"] == world["rep_b"]
