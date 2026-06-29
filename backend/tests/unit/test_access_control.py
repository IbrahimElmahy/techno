"""T020–T022: deny-by-default + branch/rep/sales-manager scope.

FR-002/007/008a/009/011; SC-002/003/006. US2/US4/US5.
"""


def test_deny_by_default_capability_missing(client, world, login):
    # After-Sales Staff has no user.read capability -> 403 (deny-by-default).
    h = login("asales")
    assert client.get("/api/v1/users", headers=h).status_code == 403


def test_unauthenticated_is_401(client, world):
    assert client.get("/api/v1/users").status_code == 401


def test_branch_manager_sees_only_own_branch(client, world, login):
    h = login("bm_a")
    users = client.get("/api/v1/users", headers=h).json()
    assert users  # non-empty
    assert all(u["branch_id"] == world["branch_a"] for u in users)


def test_branch_manager_cross_branch_get_denied(client, world, login):
    h = login("bm_a")
    # bm_b belongs to branch B -> out-of-branch -> 403.
    assert client.get(f"/api/v1/users/{world['bm_b']}", headers=h).status_code == 403


def test_rep_scope_back_office_denied(client, world, login):
    # T021: a rep cannot perform back-office actions (no user.read capability).
    h = login("rep_a")
    assert client.get("/api/v1/users", headers=h).status_code == 403
    # And cannot create a branch (no branch.write).
    body = {"name": "X", "governorate_id": 1}
    assert client.post("/api/v1/branches", json=body, headers=h).status_code == 403


def test_rep_scope_other_rep_customer_denied(client, world, login):
    # Admin creates a customer owned by rep_b.
    admin = login("admin")
    created = client.post(
        "/api/v1/customers",
        headers=admin,
        json={
            "name": "C-B",
            "customer_type": "trader",
            "rep_id": world["rep_b"],
            "territory_id": world["terr_b"],
        },
    )
    assert created.status_code == 201, created.text
    cid = created.json()["id"]
    # rep_a may not read rep_b's customer.
    h = login("rep_a")
    assert client.get(f"/api/v1/customers/{cid}", headers=h).status_code == 403


def test_sales_manager_scope(client, world, login):
    # T022: Sales Manager — own-branch customer reads allowed.
    admin = login("admin")
    client.post(
        "/api/v1/customers",
        headers=admin,
        json={
            "name": "C-A",
            "customer_type": "plumber",
            "rep_id": world["rep_a"],
            "territory_id": world["terr_a"],
        },
    )
    sm = login("sm_a")
    own = client.get("/api/v1/customers", headers=sm)
    assert own.status_code == 200
    assert all(c["territory_id"] == world["terr_a"] for c in own.json())
    # Cross-branch / admin actions denied: no user.read, no branch.write, no treasury.read.
    assert client.get("/api/v1/users", headers=sm).status_code == 403
    assert client.post(
        "/api/v1/branches", headers=sm, json={"name": "Z", "governorate_id": 1}
    ).status_code == 403
    assert client.get("/api/v1/treasury/balance", headers=sm).status_code == 403
