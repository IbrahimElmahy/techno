"""دور «قارئ» — يشوف كل حاجة، ما يغيّرش حاجة.

Their المستخدمين screen has exactly two user types: **مدخل بيانات** and **قارئ**. Every role we had
was a working role — a rep sells, an accountant posts — and none of them was «watch, do not touch».

That gap has a predictable ending. The owner who wants to see the numbers, the auditor given a login
for a week, the new hire being shown around: each of them gets handed a manager's account «for now»,
and «for now» is how a system arrives at five people able to reverse an invoice.

The capability set is **derived by rule** — every capability ending in `.read`, nothing else — rather
than hand-listed. The asymmetry decides it: forgetting to add a read makes a viewer blind on one
screen, while forgetting that some new capability is a write would hand them the ability to use it.
The rule cannot grant a write, because no write capability ends in `.read`.
"""
import pytest

from src.auth.rbac import ALL_CAPABILITIES, ROLE_CAPABILITIES
from src.models.role import RoleName


def test_the_viewer_holds_every_read_and_no_write():
    caps = ROLE_CAPABILITIES[RoleName.viewer]
    assert caps, "دور القارئ لازم يكون له صلاحيات قراءة"
    # Every read in the system, so a viewer is never mysteriously blind on one screen.
    assert caps == {c for c in ALL_CAPABILITIES if c.endswith(".read")}
    # And not one write, checked positively rather than trusting the rule that built the set.
    assert not [c for c in caps if not c.endswith(".read")]


def test_the_rule_covers_capabilities_added_by_any_module():
    """The set is built after every module has registered, so a later feature is included for free."""
    # Capabilities from modules that register late in rbac.py — proof the placement is right.
    assert "voucher.read" in ROLE_CAPABILITIES[RoleName.viewer]
    assert "inspection.read" in ROLE_CAPABILITIES[RoleName.viewer]
    assert "voucher.write" not in ROLE_CAPABILITIES[RoleName.viewer]


@pytest.fixture()
def viewer(client, world, login, db):
    """A viewer account, created through the API the way an admin would create one."""
    admin = login("admin")
    created = client.post("/api/v1/users", headers=admin, json={
        "username": "watcher", "password": "pw", "full_name": "مراقب", "role": "viewer"})
    assert created.status_code == 201, created.text
    return login("watcher")


def test_a_viewer_can_read_the_lists_they_are_given_a_login_for(client, world, login, viewer):
    for path in ("/api/v1/customers", "/api/v1/items", "/api/v1/warehouses", "/api/v1/branches"):
        resp = client.get(path, headers=viewer)
        assert resp.status_code == 200, f"{path}: {resp.text}"


def test_a_viewer_cannot_create_a_customer(client, world, login, viewer, inv_world):
    resp = client.post("/api/v1/customers", headers=viewer, json={
        "name": "عميل ممنوع", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]})
    assert resp.status_code == 403, resp.text


def test_a_viewer_cannot_sell(client, world, login, viewer, inv_world):
    """The one that matters most: a login for looking must not be able to move stock or money."""
    resp = client.post("/api/v1/sales", headers=viewer, json={
        "customer_id": 1,
        "origin": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "0",
        "lines": [{"item_id": 1, "quantity": "1", "discount_pct": "0"}]})
    assert resp.status_code == 403, resp.text


def test_a_viewer_cannot_reverse_a_document(client, world, login, viewer):
    resp = client.post("/api/v1/journal-entries/1/reverse", headers=viewer)
    assert resp.status_code == 403, resp.text


def test_a_viewer_cannot_change_settings(client, world, login, viewer):
    resp = client.put("/api/v1/settings/sales", headers=viewer, json={
        "fixed_discount_pct": "5", "vat_rate_pct": "0"})
    assert resp.status_code == 403, resp.text


def test_the_viewer_cannot_see_anybody_salary():
    """`salary.view` مسمّاها مكسورة عن قصد — ودي أهم حاجة في الملف ده.

    Every other capability in the system names its read `<x>.read`, and the viewer set is derived
    from exactly that suffix. Following the convention here would have handed every viewer in the
    company every colleague's salary — and the owner who wanted a look-but-not-touch login for a
    visiting auditor would have been handing over the payroll without knowing it.

    So the naming convention loses to the thing the convention exists to protect. This test is here
    because `salary.view` reads like an oversight, and the next person to tidy the file will want
    to rename it.
    """
    caps = ROLE_CAPABILITIES[RoleName.viewer]
    assert "salary.view" in ALL_CAPABILITIES, "الصلاحية نفسها اتشالت"
    assert "salary.view" not in caps, (
        "القارئ بقى بيشوف مرتبات الناس — يغلب الظن إن الاسم اتغيّر لـ salary.read"
    )


def test_hr_reads_are_derived_like_everything_else():
    """The exception is ONE capability, not the module. Attendance and leave follow the rule."""
    caps = ROLE_CAPABILITIES[RoleName.viewer]
    assert "hr.read" in caps
    assert "payroll.read" in caps
    assert "hr.write" not in caps
    assert "payroll.post" not in caps
