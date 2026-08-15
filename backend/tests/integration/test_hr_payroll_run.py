"""مسير الرواتب — HR-6.

The figures here end up on a payslip somebody reads and in a ledger entry nobody can edit
afterwards. What this file defends, in the order it matters:

* **الترحيل مرتين مابيعملش حاجة.** A button somebody can press twice must be safe to press twice.
  The second press returns `skipped`, not an error — an error for «it already worked» teaches
  people to distrust the screen, and a second POSTING doubles the wage bill in a way nobody
  notices for a year.
* **القيد متوازن، وإجمالي المدين = المستحق + حصة الشركة.** `ledger_service` raises on a one-piastre
  imbalance, so this is also the rounding guard: every line is rounded and then summed, never the
  other way round.
* **الشهر بيتقفل، والحضور معاه.** The entry cannot be edited, so the days it was computed from
  cannot move either. Reversing frees them again.
* **موظف من غير سجل حضور بياخد مرتب كامل**، والمسير بيقول إن ده حصل. Treating «nobody uploaded the
  file» as «absent all month» zeroes somebody's pay for an administrative gap.
* **السلفة بتتقفل لما تتسدّد، وبترجع مفتوحة لما المسير يتعكس.**
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def paid_world(client, chart, login):
    """موظف بمرتب وشرايح، وكل اللي المسير محتاجه."""
    h = login("admin")
    client.post("/api/v1/hr/attendance/shifts", headers=h, json={
        "name": "صباحي", "start_time": "09:00", "end_time": "17:00",
        "weekend_days": "4,5", "is_default": True})
    emp = client.post("/api/v1/employees", headers=h, json={"name": "سيد"}).json()
    client.post("/api/v1/hr/payroll/salaries", headers=h, json={
        "employee_id": emp["id"], "effective_from": "2026-01-01", "basic": "6000"})
    return {**chart, "h": h, "employee_id": emp["id"]}


def _compute(client, w, year=2026, month=8):
    return client.post("/api/v1/hr/payroll/runs", headers=w["h"],
                       json={"year": year, "month": month})


def _balance(client, h, account_id):
    s = client.get(f"/api/v1/accounts/{account_id}/statement", headers=h).json()
    return Decimal(s["closing_balance"])


def _account_id(db, code):
    from sqlalchemy import select

    from src.models.ledger import Account
    return db.scalar(select(Account.id).where(Account.code == code))


# ------------------------------------------------------------------ الحساب


def test_a_draft_is_computed_and_touches_nothing_financial(client, paid_world, db):
    from src.models.ledger import LedgerEntry

    before = db.query(LedgerEntry).count()
    res = _compute(client, paid_world)
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "draft"
    assert res.json()["employees"] == 1
    assert Decimal(res.json()["net"]) == Decimal("6000.00")
    assert db.query(LedgerEntry).count() == before, "المسودة رحّلت قيد"


def test_recomputing_a_draft_replaces_its_lines(client, paid_world):
    """المسودة حالة شغل مش مستند — بتتعاد براحتك."""
    first = _compute(client, paid_world).json()
    second = _compute(client, paid_world).json()
    assert first["id"] == second["id"], "اتعمل مسير تاني بدل ما يتعاد حسابه"
    assert second["employees"] == 1


def test_an_employee_with_no_salary_structure_gets_no_line(client, chart, login):
    """سطر بصفر أوحش من مفيش سطر — بيقرا كإن الراجل مستحق صفر."""
    h = login("admin")
    client.post("/api/v1/employees", headers=h, json={"name": "لسه متعيّن"})
    res = client.post("/api/v1/hr/payroll/runs", headers=h,
                      json={"year": 2026, "month": 8})
    assert res.status_code == 201, res.text
    assert res.json()["employees"] == 0


def test_an_employee_with_no_attendance_is_paid_in_full_and_flagged(client, paid_world):
    """«محدش رفع الملف» مش «غايب الشهر كله» — والفرق هو الفرق بين مرتب كامل ومرتب صفر."""
    res = _compute(client, paid_world).json()
    assert Decimal(res["net"]) == Decimal("6000.00")
    assert res["without_attendance"] == 1, "المسير مابيقولش إن فيه حد من غير حضور"
    assert res["lines"][0]["has_attendance"] is False


def test_absence_comes_off_at_the_daily_rate(client, paid_world):
    """٦٠٠٠ على ٣٠ يوم = ٢٠٠ في اليوم، يومين غياب = ٤٠٠."""
    h = paid_world["h"]
    for day in ("2026-08-17", "2026-08-18"):
        client.post("/api/v1/hr/attendance/days", headers=h, json={
            "employee_id": paid_world["employee_id"], "work_date": day})
    res = _compute(client, paid_world).json()
    line = res["lines"][0]
    assert Decimal(line["days_absent"]) == Decimal("2.000")
    assert Decimal(line["absence_deduction"]) == Decimal("400.00")
    assert Decimal(line["net"]) == Decimal("5600.00")


def test_a_penalty_in_days_becomes_money_at_this_month_rate(client, paid_world):
    """«خصم يومين» بيتحوّل بأجر يوم الشهر ده — مش برقم متخزّن."""
    h = paid_world["h"]
    client.post("/api/v1/hr/adjustments", headers=h, json={
        "employee_id": paid_world["employee_id"], "kind": "penalty", "basis": "days",
        "quantity": "2", "amount": "0", "year": 2026, "month": 8, "reason": "غياب بدون إذن"})
    res = _compute(client, paid_world).json()
    assert Decimal(res["lines"][0]["penalty_amount"]) == Decimal("400.00")


def test_an_advance_instalment_is_deducted(client, paid_world):
    h = paid_world["h"]
    client.post("/api/v1/hr/advances", headers=h, json={
        "employee_id": paid_world["employee_id"], "amount": "3000",
        "advance_date": "2026-08-01", "instalments": 3,
        "start_year": 2026, "start_month": 8})
    res = _compute(client, paid_world).json()
    line = res["lines"][0]
    assert Decimal(line["advance_deduction"]) == Decimal("1000.00")
    assert Decimal(line["net"]) == Decimal("5000.00")


# ------------------------------------------------------------------ الترحيل


def test_posting_writes_a_balanced_entry(client, paid_world, db):
    """الأستاذ بيرفض فرق قرش — فده حارس التدوير كمان."""
    run = _compute(client, paid_world).json()
    res = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=paid_world["h"])
    assert res.status_code == 200, res.text
    assert res.json()["skipped"] is False

    expense = _account_id(db, "5.10.002")
    payable = _account_id(db, "2.02.001")
    assert _balance(client, paid_world["h"], expense) == Decimal("6000.00")
    assert _balance(client, paid_world["h"], payable) == Decimal("6000.00")


def test_posting_twice_changes_nothing(client, paid_world, db):
    """أهم خاصية في الملف — ترحيل تاني بيضاعف فاتورة الأجور ومحدش بياخد باله لسنة."""
    from src.models.ledger import LedgerEntry

    run = _compute(client, paid_world).json()
    first = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=paid_world["h"]).json()
    count = db.query(LedgerEntry).filter(
        LedgerEntry.entry_type == "payroll_accrual").count()

    second = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=paid_world["h"])
    assert second.status_code == 200, second.text
    assert second.json()["skipped"] is True
    assert Decimal(second.json()["total"]) == Decimal("0.00")
    assert second.json()["ledger_entry_id"] == first["ledger_entry_id"]
    assert db.query(LedgerEntry).filter(
        LedgerEntry.entry_type == "payroll_accrual").count() == count, "اترحّل مرتين"


def test_a_second_run_for_a_posted_month_is_refused(client, paid_world):
    """المفتاح الفريد في القاعدة بيمنع ده، والخدمة بتقوله بالعربي قبل ما توصله."""
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=paid_world["h"])
    again = _compute(client, paid_world)
    assert again.status_code == 409, again.text
    assert "مرحّل بالفعل" in again.text


def test_posting_locks_the_attendance_it_read(client, paid_world):
    """القيد مابيتعدّلش، فمصدره مايتحركش من تحته."""
    h = paid_world["h"]
    client.post("/api/v1/hr/attendance/days", headers=h, json={
        "employee_id": paid_world["employee_id"], "work_date": "2026-08-17",
        "check_in": "09:00", "check_out": "17:00"})
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)

    res = client.post("/api/v1/hr/attendance/days", headers=h, json={
        "employee_id": paid_world["employee_id"], "work_date": "2026-08-17", "check_in": "11:00"})
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "locked"


def test_posting_freezes_the_bracket_version_it_used(client, paid_world, db):
    """تصحيح نسبة بعد الترحيل بيعيد كتابة كل شهر وراها في صمت."""
    from src.models.hr_payroll import PayrollSchemeVersion

    h = paid_world["h"]
    version = client.post("/api/v1/hr/payroll/schemes", headers=h, json={
        "scheme": "income_tax", "name": "تجريبي", "effective_from": "2026-01-01",
        "brackets": [{"from_amount": "0", "to_amount": None, "rate_pct": "5"}]}).json()
    assert db.get(PayrollSchemeVersion, version["id"]).locked is False

    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    db.expire_all()
    assert db.get(PayrollSchemeVersion, version["id"]).locked is True

    res = client.patch(f"/api/v1/hr/payroll/schemes/{version['id']}", headers=h,
                       json={"name": "تعديل"})
    assert res.status_code == 409, res.text


def test_an_advance_that_finishes_is_closed(client, paid_world, db):
    h = paid_world["h"]
    advance = client.post("/api/v1/hr/advances", headers=h, json={
        "employee_id": paid_world["employee_id"], "amount": "1000",
        "advance_date": "2026-08-01", "instalments": 1,
        "start_year": 2026, "start_month": 8}).json()
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)

    after = client.get("/api/v1/hr/advances", headers=h).json()[0]
    assert after["status"] == "settled"
    assert Decimal(after["outstanding"]) == Decimal("0.00")
    assert advance["document_number"] == after["document_number"]


# ------------------------------------------------------------------ العكس


def test_reversing_undoes_the_ledger_and_reopens_the_month(client, paid_world, db):
    h = paid_world["h"]
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    expense = _account_id(db, "5.10.002")
    assert _balance(client, h, expense) == Decimal("6000.00")

    res = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/reverse", headers=h)
    assert res.status_code == 200, res.text
    assert _balance(client, h, expense) == Decimal("0.00"), "القيد مااتعكسش"

    # والشهر رجع مفتوح — الحساب من تاني بيعدّي.
    again = _compute(client, paid_world)
    assert again.status_code == 201, again.text


def test_reversing_keeps_the_document(client, paid_world):
    """المستند ليه رقم مطبوع وحد ماسك قسيمة بتقول عليه — مابيتمسحش زي علامة الإهلاك."""
    h = paid_world["h"]
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/reverse", headers=h)

    listing = client.get("/api/v1/hr/payroll/runs", headers=h).json()
    old = [r for r in listing if r["document_number"] == run["document_number"]]
    assert old, "المسير اتمسح — القسيمة اللي في إيد الموظف بتشاور على حاجة مش موجودة"
    assert old[0]["status"] == "reversed"


def test_reversing_frees_the_attendance_and_the_instalments(client, paid_world, db):
    from sqlalchemy import select

    from src.models.hr_advance import EmployeeAdvanceInstalment
    from src.models.hr_attendance import AttendanceDay

    h = paid_world["h"]
    client.post("/api/v1/hr/attendance/days", headers=h, json={
        "employee_id": paid_world["employee_id"], "work_date": "2026-08-17",
        "check_in": "09:00", "check_out": "17:00"})
    client.post("/api/v1/hr/advances", headers=h, json={
        "employee_id": paid_world["employee_id"], "amount": "1000",
        "advance_date": "2026-08-01", "instalments": 1,
        "start_year": 2026, "start_month": 8})
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/reverse", headers=h)
    db.expire_all()

    day = db.scalars(select(AttendanceDay)).first()
    assert day.locked_by_payroll_run_id is None, "اليوم فضل مقفول بعد العكس"
    part = db.scalars(select(EmployeeAdvanceInstalment)).first()
    assert part.payroll_line_id is None, "القسط فضل مستهلك بعد العكس"

    advance = client.get("/api/v1/hr/advances", headers=h).json()[0]
    assert advance["status"] == "active", "السلفة فضلت مقفولة"


def test_a_paid_run_cannot_be_reversed_before_the_payment_is(client, paid_world):
    h = paid_world["h"]
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/pay", headers=h, json={})

    res = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/reverse", headers=h)
    assert res.status_code == 409, res.text
    assert "اتصرف" in res.text


# ------------------------------------------------------------------ الصرف


def test_paying_settles_the_payable_from_the_safe(client, paid_world, db):
    """مدين مرتبات مستحقة / دائن الخزنة — `create_expense` مابتعرفش تعمل ده."""
    h = paid_world["h"]
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    payable = _account_id(db, "2.02.001")
    before_treasury = _balance(client, h, paid_world["treasury"])
    assert _balance(client, h, payable) == Decimal("6000.00")

    res = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/pay", headers=h, json={})
    assert res.status_code == 200, res.text
    assert _balance(client, h, payable) == Decimal("0.00"), "الالتزام مااتقفلش"
    assert _balance(client, h, paid_world["treasury"]) == before_treasury - Decimal("6000.00")


def test_paying_twice_pays_nothing_the_second_time(client, paid_world):
    h = paid_world["h"]
    run = _compute(client, paid_world).json()
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post", headers=h)
    client.post(f"/api/v1/hr/payroll/runs/{run['id']}/pay", headers=h, json={})
    second = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/pay", headers=h, json={})
    assert second.json()["skipped"] is True


def test_an_unposted_run_cannot_be_paid(client, paid_world):
    run = _compute(client, paid_world).json()
    res = client.post(f"/api/v1/hr/payroll/runs/{run['id']}/pay",
                      headers=paid_world["h"], json={})
    assert res.status_code == 422, res.text


# ------------------------------------------------------------------ السداد


def test_remitting_closes_the_liability(client, paid_world, db):
    """من غيره الحساب بيكبر للأبد: المسير بيرحّل عليه كل شهر ومحدش بيقفله."""
    h = paid_world["h"]
    res = client.post("/api/v1/hr/payroll/remittances", headers=h, json={
        "kind": "tax", "amount": "500", "remit_date": "2026-09-05"})
    assert res.status_code == 201, res.text
    tax_payable = _account_id(db, "2.02.003")
    # الحساب دائن بطبيعته، فالسداد بيخصم منه — الرصيد بقى بالسالب لأن مافيش ترحيل قبله.
    assert _balance(client, h, tax_payable) == Decimal("-500.00")


def test_a_remittance_of_an_unknown_kind_is_refused(client, paid_world):
    res = client.post("/api/v1/hr/payroll/remittances", headers=paid_world["h"], json={
        "kind": "something", "amount": "500", "remit_date": "2026-09-05"})
    assert res.status_code == 422, res.text


# ------------------------------------------------------------------ القسيمة


def test_the_payslip_lists_every_element_by_name(client, paid_world):
    """قسيمة بتقول «صافي ٥٠٠٠» من غير تفصيل هي رقم الموظف مش هيصدّقه."""
    h = paid_world["h"]
    client.post("/api/v1/hr/advances", headers=h, json={
        "employee_id": paid_world["employee_id"], "amount": "1000",
        "advance_date": "2026-08-01", "instalments": 1,
        "start_year": 2026, "start_month": 8})
    run = _compute(client, paid_world).json()

    res = client.get(
        f"/api/v1/hr/payroll/runs/{run['id']}/payslip/{paid_world['employee_id']}", headers=h)
    assert res.status_code == 200, res.text
    labels = [d["label"] for d in res.json()["details"]]
    assert "الأساسي" in labels
    assert "قسط سلفة" in labels
    kinds = {d["label"]: d["kind"] for d in res.json()["details"]}
    assert kinds["قسط سلفة"] == "deduction"


# ------------------------------------------------------------------ الصلاحيات


def test_a_branch_manager_sees_that_a_run_exists_and_not_what_it_pays(client, paid_world, login):
    """`payroll.read` وجود وحالة؛ الأرقام محتاجة `salary.view`."""
    run = _compute(client, paid_world).json()
    manager = login("bm_a")
    assert client.get("/api/v1/hr/payroll/runs", headers=manager).status_code == 200
    assert client.get(f"/api/v1/hr/payroll/runs/{run['id']}",
                      headers=manager).status_code == 403


def test_a_viewer_cannot_post_a_run(client, paid_world, login):
    h = paid_world["h"]
    client.post("/api/v1/users", headers=h, json={
        "username": "watcher5", "password": "pw", "full_name": "مراقب", "role": "viewer"})
    viewer = login("watcher5")
    run = _compute(client, paid_world).json()
    assert client.post(f"/api/v1/hr/payroll/runs/{run['id']}/post",
                       headers=viewer).status_code == 403
