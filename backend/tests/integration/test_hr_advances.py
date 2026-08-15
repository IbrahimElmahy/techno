"""السلف والجزاءات — HR-5.

**السلفة أصل، مش مصروف.** This is the property the file exists for, and it is the most common
payroll-accounting mistake there is. The money leaves the safe so it LOOKS like a cost — but the
employee owes it back, and the salary that later repays it is booked as a cost too. Book the
advance as an expense and the company carries the same pound twice, in two different months, and
nothing anywhere says so.

The rest:

* **القسمة مابتضيّعش قرش.** 1000 over 3 is 333.33 three times and a lost piastre. The remainder
  goes on the last instalment, or the advance stays open forever over one piastre nobody owes.
* **المتبقي مشتق** من الأقساط اللي اتخصمت — a stored column drifts the first time a run is
  reversed, and then the advance disagrees with the payslips that fed it.
* **جزاء بالأيام حاجة حقيقية.** «خصم يومين» is how it is actually written; turning it into money
  is the payroll's job, at the daily rate of the month it lands in.
"""
from __future__ import annotations

from decimal import Decimal


def _emp(client, h, name="سيد", **over):
    body = {"name": name}
    body.update(over)
    return client.post("/api/v1/employees", headers=h, json=body).json()


def _advance(client, h, employee_id, **over):
    body = {"employee_id": employee_id, "amount": "3000",
            "advance_date": "2026-08-01", "instalments": 3}
    body.update(over)
    return client.post("/api/v1/hr/advances", headers=h, json=body)


def _adjust(client, h, employee_id, **over):
    body = {"employee_id": employee_id, "kind": "penalty",
            "year": 2026, "month": 8, "amount": "150", "reason": "تأخير متكرر"}
    body.update(over)
    return client.post("/api/v1/hr/adjustments", headers=h, json=body)


def _balance(client, h, account_id):
    s = client.get(f"/api/v1/accounts/{account_id}/statement", headers=h).json()
    return Decimal(s["closing_balance"])


# ------------------------------------------------------------------ السلف


def test_an_advance_is_booked_as_an_asset_not_an_expense(client, chart, login, db):
    """أهم اختبار في الملف.

    Debit «سلف العاملين» (an asset — the employee owes it) and credit the safe. Booking it to an
    expense account would mean the wage that repays it is ALSO an expense, and the same pound is
    carried twice with nothing to show it.
    """
    from src.models.ledger import Account, AccountNature

    h = login("admin")
    emp = _emp(client, h)
    res = _advance(client, h, emp["id"])
    assert res.status_code == 201, res.text

    account_id = db.scalar(
        __import__("sqlalchemy").select(Account.id).where(Account.code == "1.02.010"))
    assert account_id is not None, "حساب سلف العاملين مااتعملش"
    account = db.get(Account, account_id)
    assert account.nature == AccountNature.asset, "السلفة اتقيدت مصروف — الجنيه هيتحمّل مرتين"
    assert _balance(client, h, account_id) == Decimal("3000.00")


def test_the_safe_goes_down_by_what_left_it(client, chart, login, db):
    h = login("admin")
    emp = _emp(client, h)
    before = _balance(client, h, chart["treasury"])
    _advance(client, h, emp["id"], amount="1000")
    assert _balance(client, h, chart["treasury"]) == before - Decimal("1000.00")


def test_the_instalments_add_up_to_exactly_what_was_borrowed(client, chart, login):
    """١٠٠٠ على ٣ = ٣٣٣٫٣٣ تلات مرات وقرش ضايع. الباقي بيروح لآخر قسط.

    Without that, the advance repays 999.99 of a 1000 and stays open forever over one piastre
    nobody owes and nobody can find.
    """
    h = login("admin")
    emp = _emp(client, h)
    res = _advance(client, h, emp["id"], amount="1000", instalments=3).json()
    parts = [Decimal(p["amount"]) for p in res["schedule"]]
    assert len(parts) == 3
    assert sum(parts) == Decimal("1000.00"), f"مجموع الأقساط {sum(parts)} مش ١٠٠٠"
    assert parts[-1] != parts[0], "الباقي مااتحطش على آخر قسط"


def test_the_schedule_runs_forward_across_the_year_end(client, chart, login):
    """سلفة في نوفمبر على تلات أقساط بتوصل يناير اللي بعده."""
    h = login("admin")
    emp = _emp(client, h)
    res = _advance(client, h, emp["id"], advance_date="2026-11-01",
                   start_year=2026, start_month=11, instalments=3).json()
    periods = [(p["year"], p["month"]) for p in res["schedule"]]
    assert periods == [(2026, 11), (2026, 12), (2027, 1)]


def test_the_whole_schedule_exists_from_the_moment_it_is_taken(client, chart, login):
    """«هيتخصم مني كام الشهر الجاي» سؤال بيتسأل ساعة الاستلاف مش بعد الترحيل."""
    h = login("admin")
    emp = _emp(client, h)
    res = _advance(client, h, emp["id"], instalments=6).json()
    assert len(res["schedule"]) == 6
    assert all(p["paid"] is False for p in res["schedule"])


def test_the_outstanding_is_the_whole_amount_until_something_is_taken(client, chart, login):
    h = login("admin")
    emp = _emp(client, h)
    res = _advance(client, h, emp["id"]).json()
    assert Decimal(res["taken"]) == Decimal("0.00")
    assert Decimal(res["outstanding"]) == Decimal("3000.00")


def test_a_zero_or_negative_advance_is_refused(client, chart, login):
    h = login("admin")
    emp = _emp(client, h)
    assert _advance(client, h, emp["id"], amount="0").status_code == 422
    assert _advance(client, h, emp["id"], amount="-500").status_code == 422


def test_cancelling_reverses_the_disbursement(client, chart, login, db):
    """السلفة اتصرفت بالغلط — الفلوس بترجع الخزنة والقيد بيتعكس مش بيتمسح."""
    h = login("admin")
    emp = _emp(client, h)
    before = _balance(client, h, chart["treasury"])
    row = _advance(client, h, emp["id"], amount="1000").json()
    assert _balance(client, h, chart["treasury"]) == before - Decimal("1000.00")

    res = client.post(f"/api/v1/hr/advances/{row['id']}/cancel", headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelled"
    assert _balance(client, h, chart["treasury"]) == before, "الفلوس مارجعتش الخزنة"


def test_a_cancelled_advance_keeps_its_document(client, chart, login):
    """FR-023 — بيتلغي بحالته، مابيتمسحش."""
    h = login("admin")
    emp = _emp(client, h)
    row = _advance(client, h, emp["id"]).json()
    client.post(f"/api/v1/hr/advances/{row['id']}/cancel", headers=h)
    listing = client.get("/api/v1/hr/advances", headers=h).json()
    assert [a["document_number"] for a in listing] == [row["document_number"]]


def test_an_advance_that_has_been_deducted_from_cannot_be_cancelled(client, chart, login, db):
    """الرصيد يقول مااتخصمش والدفاتر تقول اتخصم — تناقض مش هينحل."""
    from sqlalchemy import select

    from src.models.hr_advance import EmployeeAdvanceInstalment

    h = login("admin")
    emp = _emp(client, h)
    row = _advance(client, h, emp["id"]).json()
    part = db.scalars(select(EmployeeAdvanceInstalment).where(
        EmployeeAdvanceInstalment.advance_id == row["id"])).first()
    part.payroll_line_id = 99  # المسير بيعمل ده (HR-6)
    db.commit()

    res = client.post(f"/api/v1/hr/advances/{row['id']}/cancel", headers=h)
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "locked"


def test_the_outstanding_follows_what_was_actually_deducted(client, chart, login, db):
    from sqlalchemy import select

    from src.models.hr_advance import EmployeeAdvanceInstalment

    h = login("admin")
    emp = _emp(client, h)
    row = _advance(client, h, emp["id"], amount="3000", instalments=3).json()
    part = db.scalars(select(EmployeeAdvanceInstalment).where(
        EmployeeAdvanceInstalment.advance_id == row["id"])).first()
    part.payroll_line_id = 99
    db.commit()

    after = client.get("/api/v1/hr/advances", headers=h,
                       params={"employee_id": emp["id"]}).json()[0]
    assert Decimal(after["taken"]) == Decimal("1000.00")
    assert Decimal(after["outstanding"]) == Decimal("2000.00")


# ------------------------------------------------------------------ الجزاءات


def test_a_penalty_and_a_bonus_are_the_same_shape(client, chart, login):
    """جدول واحد بإشارة عكسية — زي البيع والشرا في محرك التقارير."""
    h = login("admin")
    emp = _emp(client, h)
    penalty = _adjust(client, h, emp["id"], kind="penalty", amount="150")
    bonus = _adjust(client, h, emp["id"], kind="bonus", amount="500")
    assert penalty.status_code == 201 and bonus.status_code == 201, bonus.text
    assert penalty.json()["document_number"] == "ADJ-000001"
    assert bonus.json()["document_number"] == "ADJ-000002"


def test_a_penalty_can_be_written_in_days(client, chart, login):
    """«خصم يومين» هي الطريقة اللي بيتكتب بيها فعلاً — تحويله لفلوس شغل المسير."""
    h = login("admin")
    emp = _emp(client, h)
    res = _adjust(client, h, emp["id"], basis="days", quantity="2", amount="0")
    assert res.status_code == 201, res.text
    assert res.json()["basis"] == "days"
    assert Decimal(res.json()["quantity"]) == Decimal("2.000")


def test_a_days_penalty_with_no_days_is_refused(client, chart, login):
    h = login("admin")
    emp = _emp(client, h)
    assert _adjust(client, h, emp["id"], basis="days", quantity="0",
                   amount="0").status_code == 422


def test_an_amount_penalty_with_no_amount_is_refused(client, chart, login):
    h = login("admin")
    emp = _emp(client, h)
    assert _adjust(client, h, emp["id"], amount="0").status_code == 422


def test_the_month_it_lands_in_is_named_not_guessed(client, chart, login):
    """جزاء اتكتب يوم ٣ عن واقعة الشهر اللي فات بينزل في المسير المفتوح، مش بيضيع."""
    h = login("admin")
    emp = _emp(client, h)
    _adjust(client, h, emp["id"], year=2026, month=7)
    _adjust(client, h, emp["id"], year=2026, month=8)
    july = client.get("/api/v1/hr/adjustments", headers=h,
                      params={"employee_id": emp["id"], "year": 2026, "month": 7}).json()
    assert len(july) == 1
    assert july[0]["month"] == 7


def test_an_adjustment_already_in_a_posted_run_cannot_be_cancelled(client, chart, login, db):
    from src.models.hr_advance import PayrollAdjustment

    h = login("admin")
    emp = _emp(client, h)
    row = _adjust(client, h, emp["id"]).json()
    db.get(PayrollAdjustment, row["id"]).payroll_line_id = 55
    db.commit()

    res = client.post(f"/api/v1/hr/adjustments/{row['id']}/cancel", headers=h)
    assert res.status_code == 409, res.text


# ------------------------------------------------------------------ الصلاحيات


def test_a_viewer_cannot_read_advances(client, chart, login):
    """مبالغ باسم موظف — نفس حارس المرتبات، مش `hr.read`."""
    h = login("admin")
    client.post("/api/v1/users", headers=h, json={
        "username": "watcher4", "password": "pw", "full_name": "مراقب", "role": "viewer"})
    viewer = login("watcher4")
    assert client.get("/api/v1/hr/advances", headers=viewer).status_code == 403
    assert client.get("/api/v1/hr/adjustments", headers=viewer).status_code == 403
