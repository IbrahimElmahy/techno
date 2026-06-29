"""T009: cost-center CRUD via API — tree, deactivate-not-delete, RBAC (reuses 005 accounting caps)."""


def test_crud_and_tree(cost_centers, client, login):
    h = login("acct")
    # create a child under an existing root
    resp = client.post("/api/v1/cost-centers", headers=h, json={
        "code": "1.03", "name": "معرض الهرم", "parent_id": cost_centers["cc_root"],
    })
    assert resp.status_code == 201, resp.text
    new_id = resp.json()["id"]

    # tree shows the root with children
    tree = client.get("/api/v1/cost-centers?tree=true", headers=h).json()
    root = next(c for c in tree if c["id"] == cost_centers["cc_root"])
    assert root["children"] is not None and len(root["children"]) >= 3

    # rename
    resp = client.patch(f"/api/v1/cost-centers/{new_id}", headers=h, json={"name": "معرض الهرم الكبير"})
    assert resp.status_code == 200 and resp.json()["name"] == "معرض الهرم الكبير"


def test_duplicate_code_conflict(cost_centers, client, login):
    h = login("acct")
    resp = client.post("/api/v1/cost-centers", headers=h, json={"code": "1.01", "name": "مكرر"})
    assert resp.status_code == 409


def test_delete_deactivates(cost_centers, client, login):
    h = login("acct")
    resp = client.delete(f"/api/v1/cost-centers/{cost_centers['cc_maadi']}", headers=h)
    assert resp.status_code == 204
    # still retrievable but inactive
    got = client.get(f"/api/v1/cost-centers/{cost_centers['cc_maadi']}", headers=h).json()
    assert got["active"] is False


def test_rbac_non_accountant_denied(cost_centers, client, login):
    h = login("sm_a")  # sales manager — no accounting caps
    assert client.get("/api/v1/cost-centers", headers=h).status_code == 403
    assert client.post("/api/v1/cost-centers", headers=h,
                       json={"code": "9", "name": "x"}).status_code == 403


def test_active_filter(cost_centers, client, login):
    h = login("acct")
    client.delete(f"/api/v1/cost-centers/{cost_centers['cc_maadi']}", headers=h)
    active = client.get("/api/v1/cost-centers?active=true", headers=h).json()
    ids = {c["id"] for c in active}
    assert cost_centers["cc_maadi"] not in ids
    assert cost_centers["cc_nasr"] in ids
