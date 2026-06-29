"""T053: rep sees only own customers. US4 scenario 2; FR-009."""


def _make_customer(client, admin, name, rep_id, terr_id):
    return client.post(
        "/api/v1/customers",
        headers=admin,
        json={"name": name, "customer_type": "trader", "rep_id": rep_id, "territory_id": terr_id},
    ).json()


def test_rep_sees_only_own_customers(client, world, login):
    admin = login("admin")
    _make_customer(client, admin, "A-owned", world["rep_a"], world["terr_a"])
    b = _make_customer(client, admin, "B-owned", world["rep_b"], world["terr_b"])

    rep_a = login("rep_a")
    mine = client.get("/api/v1/customers", headers=rep_a).json()
    assert mine and all(c["rep_id"] == world["rep_a"] for c in mine)

    # Direct access to another rep's customer is denied.
    assert client.get(f"/api/v1/customers/{b['id']}", headers=rep_a).status_code == 403
