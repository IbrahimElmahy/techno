"""تقارير الموارد البشرية — HR-7.

One engine, forty names. `subject` × `level` × `group_by`, the same shape as
`lib/trade_reports.py` — because «كشف حضور تفصيلي» and «ملخص الحضور بالقسم» and «غياب الشهر بالفرع»
are not three reports, they are one set of rows crossed with a grain and a grouping. Forty separate
queries drift apart the first time an absence rule changes.

The two properties that carry it:

* **الإجماليات محسوبة على كل الصفوف المفلترة، مش على الصفحة.** Attendance is employees × days —
  two hundred people over a year is 73,000 rows — so pagination is not optional. And a total that
  describes only the visible page is worse than no total: it looks like the answer to «الشهر ده
  كلّفنا كام» and it is the answer for the first five hundred rows.
* **التقرير اللي فيه مبالغ باسم موظف محتاج `salary.view`.** One endpoint answers both «مين غايب»
  and «مين بياخد كام»; `hr.read` is the right bar for the first and far too low for the second.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def staffed(client, chart, login):
    """قسمين، تلات موظفين بمرتبات، وشوية حضور."""
    h = login("admin")
    client.post("/api/v1/hr/attendance/shifts", headers=h, json={
        "name": "صباحي", "start_time": "09:00", "end_time": "17:00",
        "weekend_days": "4,5", "is_default": True})
    sales = client.post("/api/v1/hr/departments", headers=h,
                        json={"name": "المبيعات"}).json()
    store = client.post("/api/v1/hr/departments", headers=h,
                        json={"name": "المخازن"}).json()

    people = []
    for name, dept, basic in (("أحمد", sales, "6000"), ("سيد", sales, "4000"),
                              ("منى", store, "5000")):
        emp = client.post("/api/v1/employees", headers=h, json={
            "name": name, "department_id": dept["id"], "hire_date": "2026-01-15"}).json()
        client.post("/api/v1/hr/payroll/salaries", headers=h, json={
            "employee_id": emp["id"], "effective_from": "2026-01-01", "basic": basic})
        people.append(emp)

    return {**chart, "h": h, "sales": sales, "store": store, "people": people}


def _report(client, s, **params):
    return client.get("/api/v1/hr/reports", headers=s["h"], params=params)


# ------------------------------------------------------------------ الشكل


def test_an_unknown_subject_is_refused_clearly(client, staffed):
    res = _report(client, staffed, subject="حاجة")
    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "report_invalid"


def test_a_summary_with_no_grouping_is_refused(client, staffed):
    """«ملخّص» من غير «مجمّع بإيه» مالوش معنى — والرفض بيقول ده."""
    res = _report(client, staffed, subject="headcount", level="summary", group_by="none")
    assert res.status_code == 422, res.text


def test_every_subject_answers(client, staffed):
    """المحرك بيرد على كل مواضيعه — تقرير بيقع أوحش من تقرير فاضي."""
    for subject in ("headcount", "attendance", "leave", "payroll", "cost",
                    "advance", "adjustment"):
        res = _report(client, staffed, subject=subject)
        assert res.status_code == 200, f"{subject}: {res.text}"
        assert "rows" in res.json() and "totals" in res.json()


def test_every_grouping_answers(client, staffed):
    for group in ("employee", "department", "branch", "job_title", "month", "status"):
        res = _report(client, staffed, subject="headcount", group_by=group)
        assert res.status_code == 200, f"{group}: {res.text}"


# ------------------------------------------------------------------ المحتوى


def test_the_headcount_lists_everybody(client, staffed):
    res = _report(client, staffed, subject="headcount").json()
    assert res["totals"]["rows"] == 3
    assert {r["employee_name"] for r in res["rows"]} == {"أحمد", "سيد", "منى"}


def test_grouping_by_department_adds_the_salaries_up(client, staffed):
    """٦٠٠٠ + ٤٠٠٠ في المبيعات، ٥٠٠٠ في المخازن."""
    res = _report(client, staffed, subject="headcount", group_by="department").json()
    by_name = {r["label"]: Decimal(r["amount"]) for r in res["rows"]}
    assert by_name["المبيعات"] == Decimal("10000.00")
    assert by_name["المخازن"] == Decimal("5000.00")


def test_a_department_filter_narrows_the_rows(client, staffed):
    res = _report(client, staffed, subject="headcount",
                  department_id=staffed["store"]["id"]).json()
    assert res["totals"]["rows"] == 1
    assert res["rows"][0]["employee_name"] == "منى"


def test_the_attendance_report_carries_the_day_detail(client, staffed):
    h = staffed["h"]
    client.post("/api/v1/hr/attendance/days", headers=h, json={
        "employee_id": staffed["people"][0]["id"], "work_date": "2026-08-17",
        "check_in": "09:30", "check_out": "17:00"})
    res = _report(client, staffed, subject="attendance").json()
    assert res["totals"]["rows"] == 1
    row = res["rows"][0]
    assert row["check_in"] == "09:30"
    assert row["late_minutes"] == 30
    assert row["label"] == "حاضر"


def test_the_attendance_report_filters_by_date_in_sql(client, staffed):
    """الجدول ده موظفين × أيام — الفلترة لازم تحصل في الاستعلام مش بعد التحميل."""
    h = staffed["h"]
    for day in ("2026-07-15", "2026-08-17"):
        client.post("/api/v1/hr/attendance/days", headers=h, json={
            "employee_id": staffed["people"][0]["id"], "work_date": day,
            "check_in": "09:00", "check_out": "17:00"})
    august = _report(client, staffed, subject="attendance",
                     date_from="2026-08-01", date_to="2026-08-31").json()
    assert august["totals"]["rows"] == 1
    assert august["rows"][0]["work_date"] == "2026-08-17"


def test_the_payroll_report_reads_posted_runs_only_by_default(client, staffed):
    """المسودة مش مرتب — تقرير بيعدّها بيقول إن الشركة صرفت حاجة ماصرفتهاش."""
    h = staffed["h"]
    run = client.post("/api/v1/hr/payroll/runs", headers=h,
                      json={"year": 2026, "month": 8}).json()
    draft = _report(client, staffed, subject="payroll", year=2026, month=8).json()
    assert draft["totals"]["rows"] == 0

    with_drafts = _report(client, staffed, subject="payroll", year=2026, month=8,
                          include_drafts=True).json()
    assert with_drafts["totals"]["rows"] == 3

    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    posted = _report(client, staffed, subject="payroll", year=2026, month=8).json()
    assert posted["totals"]["rows"] == 3
    assert Decimal(posted["totals"]["amount"]) == Decimal("15000.00")


def test_the_cost_report_breaks_the_payroll_down_by_element(client, staffed):
    """تكلفة الأجور بالبند — بتتقرا من `payroll_line_detail`، مش استعلام جديد."""
    h = staffed["h"]
    run = client.post("/api/v1/hr/payroll/runs", headers=h,
                      json={"year": 2026, "month": 8}).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)

    res = _report(client, staffed, subject="cost", year=2026, month=8,
                  group_by="component").json()
    labels = {r["label"] for r in res["rows"]}
    assert "الأساسي" in labels


def test_the_advance_report_shows_the_outstanding(client, staffed):
    h = staffed["h"]
    client.post("/api/v1/hr/advances", headers=h, json={
        "employee_id": staffed["people"][0]["id"], "amount": "3000",
        "advance_date": "2026-08-01", "instalments": 3,
        "start_year": 2026, "start_month": 8})
    res = _report(client, staffed, subject="advance").json()
    assert Decimal(res["rows"][0]["outstanding"]) == Decimal("3000.00")


def test_the_leave_balance_report_is_derived(client, staffed):
    h = staffed["h"]
    kind = client.post("/api/v1/hr/leave/types", headers=h,
                       json={"name": "سنوية", "annual_quota": "21"}).json()
    res = client.get("/api/v1/hr/reports/leave-balances", headers=h,
                     params={"year": 2026}).json()
    assert res["totals"]["rows"] == 3
    assert all(Decimal(r["remaining"]) == Decimal("21.000") for r in res["rows"])
    assert kind["name"] == res["rows"][0]["label"]


# ------------------------------------------------------------------ الترقيم


def test_the_page_is_limited_and_says_it_was(client, staffed):
    res = _report(client, staffed, subject="headcount", limit=2).json()
    assert len(res["rows"]) == 2
    assert res["page"]["total_rows"] == 3
    assert res["page"]["truncated"] is True, "الترقيم قص من غير ما يقول"


def test_the_totals_cover_everything_not_just_the_page(client, staffed):
    """أهم فحص في الملف.

    A total that describes the visible page looks like the answer to «الشهر ده كلّفنا كام» and is
    the answer for the first N rows only. Nothing on the screen would say so.
    """
    full = _report(client, staffed, subject="headcount").json()
    paged = _report(client, staffed, subject="headcount", limit=1).json()
    assert len(paged["rows"]) == 1
    assert paged["totals"] == full["totals"], "الإجماليات اتحسبت على الصفحة"
    assert Decimal(paged["totals"]["amount"]) == Decimal("15000.00")


def test_the_offset_walks_forward(client, staffed):
    first = _report(client, staffed, subject="headcount", limit=2, offset=0).json()
    second = _report(client, staffed, subject="headcount", limit=2, offset=2).json()
    assert len(second["rows"]) == 1
    assert second["page"]["truncated"] is False
    ids = {r["employee_id"] for r in first["rows"]} | {r["employee_id"] for r in second["rows"]}
    assert len(ids) == 3, "صف اتكرر أو ضاع بين الصفحتين"


def test_a_grouped_report_is_not_paginated(client, staffed):
    """المجمّع صغير بطبعه — قص عليه بيخفي مجموعة كاملة."""
    res = _report(client, staffed, subject="headcount", group_by="department",
                  limit=1).json()
    assert len(res["rows"]) == 2
    assert res["page"]["truncated"] is False


# ------------------------------------------------------------------ الصلاحيات


def test_a_viewer_reads_attendance_and_not_payroll(client, staffed, login):
    """نقطة نهاية واحدة بتجاوب «مين غايب» و«مين بياخد كام» — والفحص بيحصل لكل طلب."""
    h = staffed["h"]
    client.post("/api/v1/users", headers=h, json={
        "username": "watcher6", "password": "pw", "full_name": "مراقب", "role": "viewer"})
    viewer = login("watcher6")

    ok = client.get("/api/v1/hr/reports", headers=viewer, params={"subject": "attendance"})
    assert ok.status_code == 200, ok.text

    for subject in ("payroll", "cost", "advance", "adjustment"):
        res = client.get("/api/v1/hr/reports", headers=viewer, params={"subject": subject})
        assert res.status_code == 403, f"{subject} اتفتح لقارئ: {res.text}"


def test_a_branch_manager_cannot_read_the_payroll_report(client, staffed, login):
    manager = login("bm_a")
    assert client.get("/api/v1/hr/reports", headers=manager,
                      params={"subject": "attendance"}).status_code == 200
    assert client.get("/api/v1/hr/reports", headers=manager,
                      params={"subject": "payroll"}).status_code == 403
