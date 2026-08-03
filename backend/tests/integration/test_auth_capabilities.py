"""‏`/auth/me` بيقول المستخدم يقدر يعمل إيه — 031-a5-restructure.

Every screen decided what to show by listing role names: `['system_admin', 'purchasing_manager']`
and so on, hand-copied from `rbac.py`. Copies drift, and one already had — the catalogue's
`canManageItems` listed system_admin and purchasing_manager, while creating and editing items
requires `catalog.write`, which **branch_manager also holds**. He saw no «إضافة صنف» button and no
edit icon on a screen whose endpoints would have accepted him, and nothing anywhere said so.

The server now reports the user's own capabilities and screens ask `can('product_points.write')`,
quoting the same string the endpoint enforces.

**This is disclosure, not enforcement.** A client that ignored the list would still be refused by
the endpoint. The tests below check both halves of that: the list is truthful, and lying about it
buys nothing.
"""
from __future__ import annotations

import pytest

from src.auth.rbac import (
    CAP_CATALOG_WRITE,
    CAP_PRODUCT_POINTS_WRITE,
    ROLE_CAPABILITIES,
    RoleName,
)


@pytest.fixture()
def buyer(db, world, login):
    from tests.conftest import _user

    _user(db, "pm_caps", RoleName.purchasing_manager)
    db.commit()
    return login("pm_caps")


def test_me_reports_the_users_capabilities(client, login, world):
    me = client.get("/api/v1/auth/me", headers=login("admin")).json()
    assert "capabilities" in me, "screens have nothing to ask without this"
    assert CAP_CATALOG_WRITE in me["capabilities"]


def test_the_list_is_exactly_the_servers_own_map(client, login, world):
    """Not a second list that happens to agree — a reading of the one `rbac.py` holds. If they
    could differ, this whole change would just move the hand-copy one layer down."""
    me = client.get("/api/v1/auth/me", headers=login("admin")).json()
    assert set(me["capabilities"]) == set(ROLE_CAPABILITIES[RoleName.system_admin])

    bm = client.get("/api/v1/auth/me", headers=login("bm_a")).json()
    assert set(bm["capabilities"]) == set(ROLE_CAPABILITIES[RoleName.branch_manager])


def test_it_reports_the_absence_too(client, buyer):
    """The case that was wrong on screen: a purchasing manager may write the catalogue and may
    NOT price loyalty, and the answer has to distinguish them."""
    me = client.get("/api/v1/auth/me", headers=buyer).json()
    assert CAP_CATALOG_WRITE in me["capabilities"]
    assert CAP_PRODUCT_POINTS_WRITE not in me["capabilities"]


def test_the_branch_manager_case_the_screen_had_wrong(client, login, world):
    """The drift that was actually there: `canManageItems` omitted branch_manager, who holds
    `catalog.write`. The button and the edit icon were hidden from someone entitled to both."""
    me = client.get("/api/v1/auth/me", headers=login("bm_a")).json()
    assert CAP_CATALOG_WRITE in me["capabilities"]
    # And the same role genuinely does NOT price loyalty — the two lists differ, which is exactly
    # why one string per question beats one list of roles per screen.
    assert CAP_PRODUCT_POINTS_WRITE not in me["capabilities"]


def test_the_endpoint_still_refuses_regardless_of_what_the_client_believes(client, buyer):
    """The list hides buttons. It is not the gate — the gate is on the endpoint, and it does not
    consult anything the client sends."""
    item = client.post("/api/v1/items", headers=buyer, json={
        "name": "صنف اختبار الصلاحية", "kind": "product",
        "unit_of_measure": "piece", "sale_price": "10"}).json()

    res = client.put(f"/api/v1/products/{item['id']}/point-value", headers=buyer,
                     json={"point_value": 1})
    assert res.status_code == 403, res.text


def test_it_needs_a_session_at_all(client):
    """The capability list is the user's own, so it is behind the same token everything else is."""
    assert client.get("/api/v1/auth/me").status_code in (401, 403)
