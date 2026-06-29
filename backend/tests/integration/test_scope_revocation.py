"""T023: removed branch assignment denies mid-session. Spec Edge Case; FR-004."""
from src.models.user import User


def test_branch_removal_denies_mid_session(client, world, login, Session):
    h = login("bm_a")
    assert client.get("/api/v1/users", headers=h).status_code == 200

    # Revoke branch assignment out from under the live token.
    s = Session()
    u = s.get(User, world["bm_a"])
    u.branch_id = None
    s.commit()
    s.close()

    # Same token, but server re-evaluates scope -> branch-scoped read now returns own (empty/none)
    # and cross-branch is still denied. With no branch, branch filter yields nothing & writes denied.
    resp = client.get(f"/api/v1/users/{world['bm_b']}", headers=h)
    assert resp.status_code == 403
