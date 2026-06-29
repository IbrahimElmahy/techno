"""T036: admin stands up org end-to-end. US1 scenario 1; SC-001."""


def test_admin_creates_head_office_and_branches(client, world, login):
    admin = login("admin")
    # Two more branches via API on existing governorates.
    g = client.get("/api/v1/governorates", headers=admin).json()
    assert g
    gid = g[0]["id"]
    b1 = client.post("/api/v1/branches", headers=admin, json={"name": "New A", "governorate_id": gid})
    b2 = client.post(
        "/api/v1/branches", headers=admin, json={"name": "New B", "governorate_id": gid}
    )
    assert b1.status_code == 201 and b2.status_code == 201
    # Territory under a branch.
    t = client.post(
        "/api/v1/territories", headers=admin, json={"name": "T", "branch_id": b1.json()["id"]}
    )
    assert t.status_code == 201
    assert t.json()["branch_id"] == b1.json()["id"]
    # Admin sees all branches.
    all_branches = client.get("/api/v1/branches", headers=admin).json()
    assert len(all_branches) >= 4
