"""الحضور والانصراف — HR-2.

The grain is one employee, one day. `UniqueConstraint(employee_id, work_date)` is what makes the
fingerprint import safe to run twice, and safe to run over a range that overlaps last week's file —
which is what people actually do, because nobody remembers where the last export stopped.

What this file defends:

* **الاستيراد بيتعاد من غير ما يكرّر.** Same file twice must update days, not double them.
* **الصف اللي مااتطابقش بيرجع.** A file with three unrecognised identifiers has to say so;
  importing the other forty-seven silently marks three people absent for the month.
* **المعاينة قبل التنفيذ مابتكتبش حاجة.** «بص قبل ما تلتزم» is only worth having if the looking
  leaves no trace.
* **يوم داخل مسير مرحّل مابيتعدّلش** — and the refusal says which run, so «اعكس المسير الأول» is
  on the screen rather than in somebody's head.
"""
from __future__ import annotations

from decimal import Decimal


def _emp(client, h, name="سيد", **over):
    body = {"name": name}
    body.update(over)
    return client.post("/api/v1/employees", headers=h, json=body).json()


def _shift(client, h, **over):
    body = {"name": "الوردية الصباحية", "start_time": "09:00", "end_time": "17:00",
            "grace_minutes": 15, "weekend_days": "4,5", "is_default": True}
    body.update(over)
    return client.post("/api/v1/hr/attendance/shifts", headers=h, json=body)


def _day(client, h, employee_id, work_date, **over):
    body = {"employee_id": employee_id, "work_date": work_date}
    body.update(over)
    return client.post("/api/v1/hr/attendance/days", headers=h, json=body)


def _file(*rows):
    return [["الموظف", "التاريخ", "الوقت"], *[list(r) for r in rows]]


# ------------------------------------------------------------------ الورديات


def test_a_shift_is_created_and_becomes_the_default(client, world, login):
    h = login("admin")
    res = _shift(client, h)
    assert res.status_code == 201, res.text
    assert res.json()["is_default"] is True


def test_only_one_shift_is_the_default(client, world, login):
    """اتنين افتراضيين معناهم إن اللي بيتشال منهم عشوائي."""
    h = login("admin")
    _shift(client, h)
    _shift(client, h, name="الوردية المسائية", start_time="14:00", end_time="22:00",
           is_default=True)
    shifts = client.get("/api/v1/hr/attendance/shifts", headers=h).json()
    assert [s["name"] for s in shifts if s["is_default"]] == ["الوردية المسائية"]


def test_a_shift_with_an_unreadable_time_is_refused(client, world, login):
    h = login("admin")
    res = _shift(client, h, start_time="تسعة")
    assert res.status_code == 422, res.text


# ------------------------------------------------------------------ اليوم


def test_a_day_is_recorded_with_its_figures_worked_out(client, world, login):
    """المستخدم بيكتب المواعيد، والنظام بيطلع التأخير والساعات."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    res = _day(client, h, emp["id"], "2026-08-17", check_in="09:30", check_out="17:00")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["late_minutes"] == 15, "٩:٣٠ بسماح ١٥ = ١٥ دقيقة تأخير"
    assert Decimal(body["worked_hours"]) == Decimal("7.500")
    assert body["status"] == "present"


def test_the_same_day_sent_twice_is_one_row(client, world, login):
    """مفتاح (موظف، يوم) — ودي نفس الحماية اللي بتخلّي الاستيراد آمن يتعاد."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    first = _day(client, h, emp["id"], "2026-08-17", check_in="09:00", check_out="17:00")
    second = _day(client, h, emp["id"], "2026-08-17", check_in="10:00", check_out="18:00")
    assert first.json()["id"] == second.json()["id"], "اتسجّل مرتين"

    days = client.get("/api/v1/hr/attendance/days", headers=h,
                      params={"employee_id": emp["id"]}).json()
    assert len(days) == 1
    assert days[0]["check_in"] == "10:00", "التعديل ماوصلش"


def test_a_day_with_no_check_in_is_absence(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    res = _day(client, h, emp["id"], "2026-08-17")
    assert res.json()["status"] == "absent"


def test_friday_is_a_weekend_not_absence(client, world, login):
    """من غير ده كل جمعة بتبقى غياب لكل الشركة."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    res = _day(client, h, emp["id"], "2026-08-14")  # جمعة
    assert res.json()["status"] == "weekend"


def test_a_public_holiday_beats_the_working_day(client, world, login):
    """من غير جدول العطلات، العيد بيتحسب غياب للشركة كلها."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    client.post("/api/v1/hr/attendance/holidays", headers=h,
                json={"name": "عيد", "holiday_date": "2026-08-17"})
    res = _day(client, h, emp["id"], "2026-08-17")
    assert res.json()["status"] == "holiday"


def test_two_holidays_cannot_sit_on_one_day(client, world, login):
    h = login("admin")
    client.post("/api/v1/hr/attendance/holidays", headers=h,
                json={"name": "عيد", "holiday_date": "2026-08-17"})
    again = client.post("/api/v1/hr/attendance/holidays", headers=h,
                        json={"name": "نفس اليوم", "holiday_date": "2026-08-17"})
    assert again.status_code == 422, again.text


def test_the_shift_is_frozen_onto_the_day(client, world, login, db):
    """تغيير الوردية في مارس مايعيدش الحكم على فبراير.

    Recorded under a 09:00 shift and thirty minutes late; the employee then moves to a 10:00 shift.
    The February row must still say thirty minutes late — it was true, and a report that changes
    its mind about the past is a report nobody can act on.
    """
    from src.models.hr_attendance import AttendanceDay

    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    day = _day(client, h, emp["id"], "2026-08-17", check_in="09:30", check_out="17:00").json()
    assert day["late_minutes"] == 15

    late_shift = _shift(client, h, name="وردية متأخرة", start_time="10:00", end_time="18:00",
                        is_default=False).json()
    client.post("/api/v1/hr/attendance/shifts/assign", headers=h, json={
        "employee_id": emp["id"], "shift_id": late_shift["id"],
        "effective_from": "2026-09-01"})

    stored = db.get(AttendanceDay, day["id"])
    db.refresh(stored)
    assert stored.late_minutes == 15, "الماضي اتعاد الحكم عليه"


# ------------------------------------------------------------------ الاستيراد


def test_the_preview_writes_nothing(client, world, login):
    """«بص قبل ما تلتزم» مالهاش لازمة لو البص نفسه بيكتب."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    rows = _file([emp["code"], "2026-08-17", "09:00"], [emp["code"], "2026-08-17", "17:00"])

    res = client.post("/api/v1/hr/attendance/import/preview", headers=h, json={"rows": rows})
    assert res.status_code == 200, res.text
    assert len(res.json()["matched"]) == 1
    assert res.json()["matched"][0]["check_in"] == "09:00"
    assert res.json()["matched"][0]["check_out"] == "17:00"

    assert client.get("/api/v1/hr/attendance/days", headers=h).json() == [], "المعاينة كتبت"


def test_an_import_creates_the_days(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    rows = _file([emp["code"], "2026-08-17", "09:00"], [emp["code"], "2026-08-17", "17:10"])

    res = client.post("/api/v1/hr/attendance/import", headers=h,
                      json={"rows": rows, "filename": "device.csv"})
    assert res.status_code == 201, res.text
    assert res.json()["created"] == 1
    assert res.json()["document_number"] == "ATT-000001"

    days = client.get("/api/v1/hr/attendance/days", headers=h).json()
    assert len(days) == 1
    assert days[0]["check_in"] == "09:00"
    assert days[0]["check_out"] == "17:10"
    assert days[0]["source"] == "import"


def test_importing_the_same_file_twice_does_not_double_the_days(client, world, login):
    """الناس بترفع نفس التصدير تاني لأن محدش فاكر الأخير وقف فين."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    rows = _file([emp["code"], "2026-08-17", "09:00"], [emp["code"], "2026-08-17", "17:00"])

    first = client.post("/api/v1/hr/attendance/import", headers=h, json={"rows": rows}).json()
    second = client.post("/api/v1/hr/attendance/import", headers=h, json={"rows": rows}).json()
    assert first["created"] == 1 and first["updated"] == 0
    assert second["created"] == 0 and second["updated"] == 1, "اتعمل يوم تاني"
    assert len(client.get("/api/v1/hr/attendance/days", headers=h).json()) == 1


def test_unmatched_rows_come_back_rather_than_vanishing(client, world, login):
    """صف مرمي في صمت = موظف غايب شهر ومحدش عارف ليه."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    rows = _file(
        [emp["code"], "2026-08-17", "09:00"],
        ["مش-موجود-1", "2026-08-17", "09:00"],
        ["مش-موجود-2", "2026-08-17", "09:00"],
    )
    res = client.post("/api/v1/hr/attendance/import", headers=h, json={"rows": rows}).json()
    assert res["created"] == 1
    assert {u["employee_key"] for u in res["unmatched"]} == {"مش-موجود-1", "مش-موجود-2"}


def test_an_unreadable_row_comes_back_with_its_line_number(client, world, login):
    """المستخدم لازم يلاقي السطر في الملف — رقم السطر هو اللي بيوصّله."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    rows = _file([emp["code"], "2026-08-17", "09:00"], [emp["code"], "مش تاريخ", "09:00"])
    res = client.post("/api/v1/hr/attendance/import", headers=h, json={"rows": rows}).json()
    assert len(res["rejected"]) == 1
    assert res["rejected"][0]["line"] == 3


def test_the_day_is_built_from_the_first_and_last_punch(client, world, login):
    """أربع بصمات في اليوم — الأولى والأخيرة، مش أول اتنين."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    rows = _file(
        [emp["code"], "2026-08-17", "08:30"],
        [emp["code"], "2026-08-17", "13:00"],
        [emp["code"], "2026-08-17", "14:00"],
        [emp["code"], "2026-08-17", "17:10"],
    )
    client.post("/api/v1/hr/attendance/import", headers=h, json={"rows": rows})
    day = client.get("/api/v1/hr/attendance/days", headers=h).json()[0]
    assert (day["check_in"], day["check_out"]) == ("08:30", "17:10")


def test_an_employee_is_matched_by_code_or_national_id_or_name(client, world, login):
    """الجهاز بيطبع اللي اتظبط عليه من سنين ومحدش فاكر — فالتلاتة بيتقبلوا."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h, name="سيد الفني", national_id="29001011234567")
    for key in (emp["code"], "29001011234567", "سيد الفني"):
        rows = _file([key, "2026-08-17", "09:00"])
        res = client.post("/api/v1/hr/attendance/import/preview", headers=h,
                          json={"rows": rows}).json()
        assert len(res["matched"]) == 1, f"«{key}» مااتطابقش"


def test_the_import_batches_are_readable_afterwards(client, world, login):
    """«الملف ده عمل إيه» — سؤال بيتسأل بعد أسبوع."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    client.post("/api/v1/hr/attendance/import", headers=h,
                json={"rows": _file([emp["code"], "2026-08-17", "09:00"]),
                      "filename": "august.csv"})
    batches = client.get("/api/v1/hr/attendance/imports", headers=h).json()
    assert len(batches) == 1
    assert batches[0]["filename"] == "august.csv"
    assert batches[0]["rows_created"] == 1


# ------------------------------------------------------------------ القفل


def test_a_day_inside_a_posted_payroll_refuses_to_move(client, world, login, db):
    """المسير المرحّل قيد في الدفاتر، والقيد مابيتعدّلش — فمصدره مايتحركش من تحته.

    The lock is set by the payroll run (HR-6); here it is set directly, because the rule this
    defends is the attendance side of it and it has to hold before payroll exists to lean on it.
    """
    from src.models.hr_attendance import AttendanceDay

    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    day = _day(client, h, emp["id"], "2026-08-17", check_in="09:00", check_out="17:00").json()

    stored = db.get(AttendanceDay, day["id"])
    stored.locked_by_payroll_run_id = 12
    db.commit()

    res = _day(client, h, emp["id"], "2026-08-17", check_in="10:00")
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "locked"
    assert "12" in res.json()["detail"]["message"], "الرسالة مابتقولش أنهي مسير"

    gone = client.delete(f"/api/v1/hr/attendance/days/{day['id']}", headers=h)
    assert gone.status_code == 409, "اتحذف وهو مقفول"


def test_an_import_skips_locked_days_instead_of_overwriting_them(client, world, login, db):
    """الاستيراد بيحترم نفس القفل — ولو مابيحترمهوش، الشهر المرحّل بيتغيّر في صمت."""
    from src.models.hr_attendance import AttendanceDay

    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    day = _day(client, h, emp["id"], "2026-08-17", check_in="09:00", check_out="17:00").json()
    stored = db.get(AttendanceDay, day["id"])
    stored.locked_by_payroll_run_id = 7
    db.commit()

    res = client.post("/api/v1/hr/attendance/import", headers=h, json={
        "rows": _file([emp["code"], "2026-08-17", "11:00"])}).json()
    assert res["created"] == 0 and res["updated"] == 0
    assert len(res["locked"]) == 1

    unchanged = client.get("/api/v1/hr/attendance/days", headers=h).json()[0]
    assert unchanged["check_in"] == "09:00", "الاستيراد داس على يوم مقفول"


def test_a_viewer_reads_attendance_and_cannot_write_it(client, world, login):
    h = login("admin")
    client.post("/api/v1/users", headers=h, json={
        "username": "watcher2", "password": "pw", "full_name": "مراقب", "role": "viewer"})
    viewer = login("watcher2")
    assert client.get("/api/v1/hr/attendance/days", headers=viewer).status_code == 200
    assert _shift(client, viewer).status_code == 403
