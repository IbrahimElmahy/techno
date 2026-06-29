"""T037: branch-scoped reads/writes isolated. US2 scenarios 1-3; SC-002."""


def test_branch_lists_are_isolated(client, world, login):
    bm_a = login("bm_a")
    branches = client.get("/api/v1/branches", headers=bm_a).json()
    assert [b["id"] for b in branches] == [world["branch_a"]]


def test_cross_branch_user_get_denied(client, world, login):
    bm_a = login("bm_a")
    assert client.get(f"/api/v1/users/{world['bm_b']}", headers=bm_a).status_code == 403


def test_purchasing_manager_same_as_branch_manager(client, world, login, Session):
    # Add a purchasing manager in branch A and confirm branch-scoped access.
    from src.models.role import RoleName
    from src.models.user import User
    from src.core.security import hash_password

    s = Session()
    role = s.query  # noqa
    from src.models.role import Role

    pm_role = s.query(Role).filter(Role.name == RoleName.purchasing_manager).one_or_none()
    if pm_role is None:
        pm_role = Role(name=RoleName.purchasing_manager)
        s.add(pm_role)
        s.flush()
    pm = User(
        username="pm_a", password_hash=hash_password("pw"), role_id=pm_role.id,
        full_name="pm_a", branch_id=world["branch_a"],
    )
    s.add(pm)
    s.commit()
    s.close()

    h = login("pm_a")
    branches = client.get("/api/v1/branches", headers=h).json()
    assert [b["id"] for b in branches] == [world["branch_a"]]
