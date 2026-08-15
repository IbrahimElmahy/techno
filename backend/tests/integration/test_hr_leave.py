"""الأجازات — HR-3.

The rule the whole file exists for: **الرصيد المستهلك مشتق، مش مخزّن.** A `used` column beside the
entitlement reads as an obvious optimisation and drifts the first time a request is cancelled, or
approved twice from two screens. Then the balance on the card disagrees with the requests
underneath it and nobody can tell which one is lying.

The rest:

* **الاعتماد بيكتب أيام حضور.** Payroll reads one thing, so «ليه محسوبه غايب وهو كان في أجازة» has
  no way to happen.
* **الجمعة والعطلة الرسمية مابيتخصموش من الرصيد** — the company was closed anyway, and charging
  somebody for it is the kind of thing that is noticed once and remembered for years.
* **الإلغاء بيرجّع الأيام** — unless one of them is inside a posted payroll, and then it is refused
  outright rather than half-applied.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select


def _emp(client, h, name="سيد", **over):
    body = {"name": name}
    body.update(over)
    return client.post("/api/v1/employees", headers=h, json=body).json()


def _shift(client, h):
    return client.post("/api/v1/hr/attendance/shifts", headers=h, json={
        "name": "صباحي", "start_time": "09:00", "end_time": "17:00",
        "weekend_days": "4,5", "is_default": True}).json()


def _type(client, h, name="سنوية", **over):
    body = {"name": name, "annual_quota": "21"}
    body.update(over)
    return client.post("/api/v1/hr/leave/types", headers=h, json=body).json()


def _request(client, h, employee_id, type_id, date_from, date_to, **over):
    body = {"employee_id": employee_id, "leave_type_id": type_id,
            "date_from": date_from, "date_to": date_to}
    body.update(over)
    return client.post("/api/v1/hr/leave/requests", headers=h, json=body)


def _balance(client, h, employee_id, year=2026):
    rows = client.get("/api/v1/hr/leave/balances", headers=h,
                      params={"year": year, "employee_id": employee_id}).json()
    return rows[0]


# ------------------------------------------------------------------ الأنواع


def test_a_leave_type_is_created_with_a_code(client, world, login):
    h = login("admin")
    res = client.post("/api/v1/hr/leave/types", headers=h,
                      json={"name": "سنوية", "annual_quota": "21"})
    assert res.status_code == 201, res.text
    assert res.json()["code"] == "LVT-001"


def test_two_types_cannot_share_a_name(client, world, login):
    h = login("admin")
    _type(client, h)
    again = client.post("/api/v1/hr/leave/types", headers=h, json={"name": "سنوية"})
    assert again.status_code == 422, again.text


# ------------------------------------------------------------------ الأيام


def test_a_weekend_inside_the_range_is_not_charged(client, world, login):
    """الأحد ← الخميس خمس أيام. الأحد ← السبت خمسة كمان، مش سبعة.

    Charging somebody for the Friday the company was shut is the kind of thing noticed once and
    remembered for years.
    """
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)

    # ٢٠٢٦-٠٨-١٦ حد ← ٢٠٢٦-٠٨-٢٠ خميس = ٥ أيام شغل
    week = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20")
    assert Decimal(week.json()["days"]) == Decimal("5.000")

    client.post(f"/api/v1/hr/leave/requests/{week.json()['id']}/cancel", headers=h)
    # نفس المدى + الجمعة والسبت = لسه ٥
    longer = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-22")
    assert Decimal(longer.json()["days"]) == Decimal("5.000"), "الجمعة والسبت اتخصموا"


def test_a_public_holiday_is_not_charged_either(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    client.post("/api/v1/hr/attendance/holidays", headers=h,
                json={"name": "عيد", "holiday_date": "2026-08-18"})

    res = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20")
    assert Decimal(res.json()["days"]) == Decimal("4.000"), "العطلة الرسمية اتخصمت من الرصيد"


def test_a_type_that_counts_weekends_charges_them(client, world, login):
    """«أسبوع أجازة» و«خمس أيام أجازة» طلبين مختلفين على نفس التواريخ."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h, name="بدون أجر", counts_weekend=True)
    res = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-22")
    assert Decimal(res.json()["days"]) == Decimal("7.000")


def test_a_range_that_is_all_weekend_is_refused(client, world, login):
    """طلب على الجمعة والسبت بس مالوش معنى — ومابيتسجّلش بصفر يوم."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    res = _request(client, h, emp["id"], kind["id"], "2026-08-14", "2026-08-15")
    assert res.status_code == 422, res.text


def test_the_end_cannot_come_before_the_start(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    res = _request(client, h, emp["id"], kind["id"], "2026-08-20", "2026-08-16")
    assert res.status_code == 422, res.text


# ------------------------------------------------------------------ الرصيد


def test_the_balance_is_derived_from_the_approved_requests(client, world, login):
    """مافيش عمود `used` — الرقم بيتجمّع وقت السؤال."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)

    before = _balance(client, h, emp["id"])
    assert Decimal(before["entitled"]) == Decimal("21.000")
    assert Decimal(before["taken"]) == Decimal("0.000")
    assert Decimal(before["remaining"]) == Decimal("21.000")

    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()
    # الطلب لسه متقدّم مش معتمد — مابيخصمش.
    assert Decimal(_balance(client, h, emp["id"])["taken"]) == Decimal("0.000")

    client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)
    after = _balance(client, h, emp["id"])
    assert Decimal(after["taken"]) == Decimal("5.000")
    assert Decimal(after["remaining"]) == Decimal("16.000")


def test_approving_twice_does_not_charge_twice(client, world, login):
    """اعتماد من شاشتين — التاني مابيعملش حاجة، والسبب بنيوي مش حارس.

    Two managers with the screen open is ordinary, not exotic. What makes the second approval
    harmless is not a check that could be removed: the balance is DERIVED by summing approved
    requests, so approving one twice sums one request twice — which is once. And the attendance
    days key on (employee, date), so re-writing them writes the same five rows.

    Both halves are asserted, because if `taken()` ever started counting rows instead of summing
    days — or the days lost their key — this is where it shows.
    """
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()

    first = client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)
    second = client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)
    assert first.status_code == 200 and second.status_code == 200, second.text
    assert Decimal(_balance(client, h, emp["id"])["taken"]) == Decimal("5.000")
    days = client.get("/api/v1/hr/attendance/days", headers=h,
                      params={"employee_id": emp["id"]}).json()
    assert len(days) == 5, "الاعتماد التاني كتب أيام زيادة"


def test_a_request_still_waiting_does_not_touch_the_balance(client, world, login):
    """اللي المشرف لسه مشافوش مش مخصوم.

    `taken()` sums APPROVED requests only. Counting submitted ones too would show a rep a balance
    he does not have — and the first he hears of it is a refusal on the day he books a flight.
    This is the mutation the double-approval test cannot catch, so it is its own test.
    """
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20")
    _request(client, h, emp["id"], kind["id"], "2026-08-23", "2026-08-27")
    state = _balance(client, h, emp["id"])
    assert Decimal(state["taken"]) == Decimal("0.000"), "طلبات مستنية الاعتماد اتخصمت"
    assert Decimal(state["remaining"]) == Decimal("21.000")


def test_a_request_beyond_the_balance_is_refused(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h, annual_quota="3")
    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()
    res = client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)
    assert res.status_code == 422, res.text
    assert "الرصيد مايكفيش" in res.text


def test_an_opening_balance_carries_forward(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    client.post("/api/v1/hr/leave/entitlements", headers=h, json={
        "employee_id": emp["id"], "leave_type_id": kind["id"], "year": 2026,
        "opening": "5", "entitled": "21"})
    assert Decimal(_balance(client, h, emp["id"])["remaining"]) == Decimal("26.000")


# ------------------------------------------------------------------ الحضور


def test_approving_writes_the_attendance_days(client, world, login):
    """المسير بيقرا حاجة واحدة — عشان «محسوبه غايب وهو في أجازة» مايحصلش."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()
    client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)

    days = client.get("/api/v1/hr/attendance/days", headers=h,
                      params={"employee_id": emp["id"]}).json()
    assert len(days) == 5
    assert {d["status"] for d in days} == {"leave"}
    assert all(req["document_number"] in (d["notes"] or "") for d in days)


def test_cancelling_takes_the_days_back(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()
    client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)

    res = client.post(f"/api/v1/hr/leave/requests/{req['id']}/cancel", headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelled"
    assert client.get("/api/v1/hr/attendance/days", headers=h,
                      params={"employee_id": emp["id"]}).json() == []
    assert Decimal(_balance(client, h, emp["id"])["taken"]) == Decimal("0.000")


def test_a_cancelled_request_is_kept_not_deleted(client, world, login):
    """FR-023 — الطلب بيفضل مقروء، بحالته."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()
    client.post(f"/api/v1/hr/leave/requests/{req['id']}/cancel", headers=h)
    rows = client.get("/api/v1/hr/leave/requests", headers=h).json()
    assert [r["document_number"] for r in rows] == [req["document_number"]]


def test_two_requests_cannot_overlap(client, world, login):
    """موظف في أجازة مرتين على نفس اليوم بيخصم مرتين ويكتب اليوم مرتين."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20")
    clash = _request(client, h, emp["id"], kind["id"], "2026-08-18", "2026-08-25")
    assert clash.status_code == 409, clash.text


def test_cancelling_is_refused_when_a_day_is_inside_a_posted_payroll(client, world, login, db):
    """الرصيد يقول ماخدش أجازة والدفاتر تقول أخد — تناقض مش هينحل بعد كده."""
    from src.models.hr_attendance import AttendanceDay

    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()
    client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)

    day = db.scalars(select(AttendanceDay)).first()
    day.locked_by_payroll_run_id = 5
    db.commit()

    res = client.post(f"/api/v1/hr/leave/requests/{req['id']}/cancel", headers=h)
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "locked"
    assert "5" in res.json()["detail"]["message"]


def test_a_type_that_needs_no_approval_is_approved_on_arrival(client, world, login):
    """الإذن ساعة مش محتاج دورة اعتماد — والحالة لازم تعكس ده من أول لحظة."""
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h, name="إذن", requires_approval=False, annual_quota="10")
    res = _request(client, h, emp["id"], kind["id"], "2026-08-17", "2026-08-17")
    assert res.json()["status"] == "approved"
    days = client.get("/api/v1/hr/attendance/days", headers=h,
                      params={"employee_id": emp["id"]}).json()
    assert len(days) == 1


def test_an_approved_request_is_cancelled_not_rejected(client, world, login):
    h = login("admin")
    _shift(client, h)
    emp = _emp(client, h)
    kind = _type(client, h)
    req = _request(client, h, emp["id"], kind["id"], "2026-08-16", "2026-08-20").json()
    client.post(f"/api/v1/hr/leave/requests/{req['id']}/approve", headers=h)
    res = client.post(f"/api/v1/hr/leave/requests/{req['id']}/reject", headers=h, json={})
    assert res.status_code == 422, res.text
