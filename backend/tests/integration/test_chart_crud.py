"""T009: chart CRUD via API — tree, system accounts present, deactivate-not-delete, RBAC."""


def test_seeded_system_accounts_present_as_postable_leaves(chart, client, login):
    h = login("acct")
    resp = client.get("/api/v1/accounts?postable_only=true", headers=h)
    assert resp.status_code == 200, resp.text
    codes = {a["code"] for a in resp.json() if a["code"]}
    # the five seeded singleton leaves
    for code in ("1.01.001", "3.001", "4.001", "5.001", "5.002"):
        assert code in codes
    # system leaves are flagged is_system + postable
    treasury = next(a for a in resp.json() if a["code"] == "1.01.001")
    assert treasury["is_system"] and treasury["is_postable"]


def test_build_tree_and_nesting(chart, client, login):
    h = login("acct")
    # create a group + a child leaf
    grp = client.post("/api/v1/accounts", headers=h, json={
        "code": "5.20", "name": "تسويق", "parent_id": chart["groups"]["5"],
        "nature": "expense", "is_postable": False,
    })
    assert grp.status_code == 201, grp.text
    leaf = client.post("/api/v1/accounts", headers=h, json={
        "code": "5.20.001", "name": "إعلانات", "parent_id": grp.json()["id"],
        "nature": "expense", "is_postable": True,
    })
    assert leaf.status_code == 201, leaf.text
    assert leaf.json()["parent_id"] == grp.json()["id"]

    tree = client.get("/api/v1/accounts?tree=true", headers=h)
    assert tree.status_code == 200
    roots = {a["code"]: a for a in tree.json()}
    assert "5" in roots and roots["5"]["children"] is not None


def test_duplicate_code_conflict(chart, client, login):
    h = login("acct")
    resp = client.post("/api/v1/accounts", headers=h, json={
        "code": "5.10.001", "name": "مكرر", "parent_id": chart["expense_group"],
        "nature": "expense", "is_postable": True,
    })
    assert resp.status_code == 409


def test_deactivate_not_delete_and_system_protected(chart, client, login):
    h = login("acct")
    # user leaf can be deactivated
    resp = client.delete(f"/api/v1/accounts/{chart['salaries']}", headers=h)
    assert resp.status_code == 204
    # system account cannot be deactivated
    resp = client.delete(f"/api/v1/accounts/{chart['treasury']}", headers=h)
    assert resp.status_code == 409
    # system account can be renamed (patch name)
    resp = client.patch(f"/api/v1/accounts/{chart['treasury']}", headers=h,
                        json={"name": "الخزينة الرئيسية"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "الخزينة الرئيسية"


def test_rbac_non_accountant_denied(chart, client, login):
    h = login("sm_a")  # sales manager — no accounting caps
    assert client.get("/api/v1/accounts", headers=h).status_code == 403
    assert client.post("/api/v1/accounts", headers=h, json={
        "code": "7", "name": "x", "nature": "asset", "is_postable": False,
    }).status_code == 403
