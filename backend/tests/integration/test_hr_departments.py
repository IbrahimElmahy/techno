"""الأقسام ونهاية الخدمة — HR-1.

`Employee.department` was a free `String(120)`, and free text is how «المبيعات» and «مبيعات» and
«قسم المبيعات» become three departments in a report nobody can total. It also had nowhere to hold a
manager, a parent, or a cost centre — so «تكلفة أجور قسم المخازن» had no answer at all.

What this file defends:

* **The tree cannot become a ring.** A department pointed at its own descendant makes every walk
  over it — org chart, cost roll-up, report grouping — run forever. That is a hang, not an error
  message, and it is found in production rather than in review.
* **A department with people in it does not vanish.** Deactivating one under its staff drops them
  out of every grouped report at once, and nobody is told why.
* **The migration keeps every old name.** Nobody's department is lost turning the strings into rows.
* **Ending service and deactivating are one act.** Either alone leaves the books wrong: the date
  without the flag puts a leaver on next month's payroll; the flag without the date makes «مين مشي
  الشهر ده» unanswerable.
"""
from __future__ import annotations

from decimal import Decimal


def _dept(client, h, name="المخازن", **over):
    body = {"name": name}
    body.update(over)
    return client.post("/api/v1/hr/departments", headers=h, json=body)


def _emp(client, h, name="سيد", **over):
    body = {"name": name}
    body.update(over)
    return client.post("/api/v1/employees", headers=h, json=body)


def test_a_department_is_created_with_an_automatic_code(client, world, login):
    h = login("admin")
    res = _dept(client, h)
    assert res.status_code == 201, res.text
    assert res.json()["code"] == "DEP-001"
    assert res.json()["name"] == "المخازن"

    second = _dept(client, h, name="المبيعات")
    assert second.json()["code"] == "DEP-002", "الترقيم مش ماشي"


def test_two_departments_cannot_share_a_name(client, world, login):
    """The whole point of the table is that one department is one row. Two rows called «المبيعات»
    puts the reader back where the free text left them."""
    h = login("admin")
    assert _dept(client, h, name="المبيعات").status_code == 201
    clash = _dept(client, h, name="المبيعات")
    assert clash.status_code == 422, clash.text
    assert "نفس الاسم" in clash.text


def test_a_department_cannot_be_its_own_parent(client, world, login):
    h = login("admin")
    dept = _dept(client, h).json()
    res = client.patch(f"/api/v1/hr/departments/{dept['id']}", headers=h,
                       json={"parent_id": dept["id"]})
    assert res.status_code == 422, res.text


def test_the_tree_cannot_be_bent_into_a_ring(client, world, login):
    """أب تحت ابنه = دايرة، وكل مشي على الشجرة بيلف للأبد.

    Grandparent → parent → child, then point the grandparent at the child. Nothing about that
    request looks wrong at the call site, and the failure it causes is a hang rather than an
    error — which is why it is refused here rather than survived downstream.
    """
    h = login("admin")
    top = _dept(client, h, name="الإدارة").json()
    mid = _dept(client, h, name="المبيعات", parent_id=top["id"]).json()
    low = _dept(client, h, name="مبيعات القاهرة", parent_id=mid["id"]).json()

    res = client.patch(f"/api/v1/hr/departments/{top['id']}", headers=h,
                       json={"parent_id": low["id"]})
    assert res.status_code == 422, res.text
    assert "تحت نفسه" in res.text


def test_a_department_with_active_staff_is_not_deactivated(client, world, login):
    h = login("admin")
    dept = _dept(client, h).json()
    emp = _emp(client, h).json()
    client.patch(f"/api/v1/employees/{emp['id']}", headers=h,
                 json={"department_id": dept["id"]})

    res = client.delete(f"/api/v1/hr/departments/{dept['id']}", headers=h)
    assert res.status_code == 409, res.text
    assert "موظف نشط" in res.text

    # Move him out and it closes.
    client.patch(f"/api/v1/employees/{emp['id']}", headers=h, json={"department_id": None})
    assert client.delete(f"/api/v1/hr/departments/{dept['id']}", headers=h).status_code == 204


def test_a_department_is_deactivated_never_deleted(client, world, login):
    """FR-023 — the name has to stay readable wherever it is already referenced."""
    h = login("admin")
    dept = _dept(client, h).json()
    assert client.delete(f"/api/v1/hr/departments/{dept['id']}", headers=h).status_code == 204

    still_there = client.get(f"/api/v1/hr/departments/{dept['id']}", headers=h)
    assert still_there.status_code == 200, "اتمسح بدل ما يتقفل"
    assert still_there.json()["active"] is False


def test_the_import_turns_every_old_name_into_a_department(client, world, login):
    """الترحيل مايضيّعش قسم حد.

    Three employees, two distinct department strings, and one employee with none. The import must
    create exactly two departments, link the two who had a name, and leave the third alone.
    """
    h = login("admin")
    _emp(client, h, name="أ", department="المخازن")
    _emp(client, h, name="ب", department="المخازن")
    _emp(client, h, name="ج", department="المبيعات")
    _emp(client, h, name="د")

    res = client.post("/api/v1/hr/departments/import-from-employees", headers=h)
    assert res.status_code == 201, res.text
    assert res.json()["created"] == 2, "اتعمل عدد أقسام غلط"
    assert res.json()["linked"] == 3

    names = {d["name"] for d in client.get("/api/v1/hr/departments", headers=h).json()}
    assert {"المخازن", "المبيعات"} <= names

    counts = {d["name"]: d["employee_count"]
              for d in client.get("/api/v1/hr/departments", headers=h).json()}
    assert counts["المخازن"] == 2
    assert counts["المبيعات"] == 1


def test_running_the_import_twice_changes_nothing(client, world, login):
    """It is a button somebody can click again — and a second click must not double the tree."""
    h = login("admin")
    _emp(client, h, name="أ", department="المخازن")
    first = client.post("/api/v1/hr/departments/import-from-employees", headers=h).json()
    assert first["created"] == 1

    second = client.post("/api/v1/hr/departments/import-from-employees", headers=h)
    assert second.status_code == 201, second.text
    assert second.json() == {"created": 0, "linked": 0, "employees": 1}
    assert len(client.get("/api/v1/hr/departments", headers=h).json()) == 1


def test_ending_service_records_the_date_and_stops_the_employee(client, world, login):
    """الاتنين مع بعض — واحد من غير التاني بيسيب الدفاتر غلط."""
    h = login("admin")
    emp = _emp(client, h, hire_date="2024-01-01").json()

    res = client.post("/api/v1/hr/terminations", headers=h, json={
        "employee_id": emp["id"], "end_date": "2026-06-30", "kind": "resignation",
        "reason": "سافر", "settlement_amount": "5000"})
    assert res.status_code == 201, res.text
    assert Decimal(res.json()["settlement_amount"]) == Decimal("5000")

    after = client.get(f"/api/v1/employees/{emp['id']}", headers=h).json()
    assert after["active"] is False, "اتسجّل خروجه وفضل نشط — هيطلع في مسير الشهر الجاي"


def test_service_cannot_end_before_it_started(client, world, login):
    h = login("admin")
    emp = _emp(client, h, hire_date="2026-01-01").json()
    res = client.post("/api/v1/hr/terminations", headers=h, json={
        "employee_id": emp["id"], "end_date": "2025-12-31", "kind": "dismissal"})
    assert res.status_code == 422, res.text


def test_an_employee_leaves_once(client, world, login):
    h = login("admin")
    emp = _emp(client, h).json()
    body = {"employee_id": emp["id"], "end_date": "2026-06-30", "kind": "resignation"}
    assert client.post("/api/v1/hr/terminations", headers=h, json=body).status_code == 201
    again = client.post("/api/v1/hr/terminations", headers=h, json=body)
    assert again.status_code == 409, again.text


def test_a_termination_entered_by_mistake_can_be_undone(client, world, login):
    """ده تصحيح إدخال، مش حذف بيانات — الراجل ماكانش مشي أصلاً."""
    h = login("admin")
    emp = _emp(client, h).json()
    client.post("/api/v1/hr/terminations", headers=h, json={
        "employee_id": emp["id"], "end_date": "2026-06-30", "kind": "resignation"})

    assert client.delete(f"/api/v1/hr/terminations/{emp['id']}", headers=h).status_code == 204
    assert client.get(f"/api/v1/employees/{emp['id']}", headers=h).json()["active"] is True
    assert client.get("/api/v1/hr/terminations", headers=h).json() == []


def test_leavers_are_listed_by_period(client, world, login):
    """«مين مشي الشهر ده» — السؤال اللي الجدول ده اتعمل عشانه."""
    h = login("admin")
    for name, day in (("أ", "2026-03-15"), ("ب", "2026-06-30")):
        emp = _emp(client, h, name=name).json()
        client.post("/api/v1/hr/terminations", headers=h, json={
            "employee_id": emp["id"], "end_date": day, "kind": "resignation"})

    june = client.get("/api/v1/hr/terminations", headers=h,
                      params={"date_from": "2026-06-01", "date_to": "2026-06-30"}).json()
    assert [t["employee_name"] for t in june] == ["ب"]
