"""هيكل الرواتب والشرايح — HR-4.

Two things here are versioned by date, for the same reason: **رقم من مارس اللي فات لازم يفضل معناه
اللي كان.**

* **الزيادة صف جديد.** A raise in June must not rewrite May's payslip, so a salary is a row with a
  start date and a raise is a new row — never an edit.
* **الإصدار المستعمل بيتجمّد.** Correcting a typo in a tax rate that a posted payroll already used
  would silently rewrite every month behind it — and the ledger entries underneath cannot be edited
  to match, so the books and the payslips would disagree with no way back.

And the guard that has no second chance: **الشرايح لازم تكون متصلة.** A gap or an overlap between
bands produces a wrong tax figure with nothing anywhere complaining — the payroll runs, the number
looks plausible, and it posts.

The brackets ship EMPTY. Nothing in this file or the library holds an Egyptian rate; the numbers
below are round test values chosen so the arithmetic can be checked in the head.
"""
from __future__ import annotations

from decimal import Decimal


def _emp(client, h, name="سيد", **over):
    body = {"name": name}
    body.update(over)
    return client.post("/api/v1/employees", headers=h, json=body).json()


def _component(client, h, name="بدل انتقالات", **over):
    body = {"name": name, "kind": "earning"}
    body.update(over)
    return client.post("/api/v1/hr/payroll/components", headers=h, json=body)


def _salary(client, h, employee_id, effective_from, basic, **over):
    body = {"employee_id": employee_id, "effective_from": effective_from, "basic": str(basic)}
    body.update(over)
    return client.post("/api/v1/hr/payroll/salaries", headers=h, json=body)


BANDS = [
    {"from_amount": "0", "to_amount": "10000", "rate_pct": "0"},
    {"from_amount": "10000", "to_amount": "30000", "rate_pct": "10"},
    {"from_amount": "30000", "to_amount": None, "rate_pct": "20"},
]


def _scheme(client, h, **over):
    body = {"scheme": "income_tax", "name": "شرايح تجريبية",
            "effective_from": "2026-01-01", "brackets": BANDS}
    body.update(over)
    return client.post("/api/v1/hr/payroll/schemes", headers=h, json=body)


# ------------------------------------------------------------------ البنود


def test_a_component_is_created_with_a_code(client, world, login):
    h = login("admin")
    res = _component(client, h)
    assert res.status_code == 201, res.text
    assert res.json()["code"] == "SC-001"


def test_taxable_and_insurable_are_separate_switches(client, world, login):
    """بدل انتقالات ممكن يكون برّه الأجر التأميني وجوه وعاء الضريبة — مش نفس السؤال."""
    h = login("admin")
    res = _component(client, h, taxable=True, insurable=False)
    assert res.json()["taxable"] is True
    assert res.json()["insurable"] is False


# ------------------------------------------------------------------ الهيكل


def test_a_salary_is_recorded_with_its_components(client, world, login):
    h = login("admin")
    comp = _component(client, h).json()
    emp = _emp(client, h)
    res = _salary(client, h, emp["id"], "2026-01-01", 5000,
                  lines=[{"component_id": comp["id"], "amount": "500"}])
    assert res.status_code == 201, res.text
    body = res.json()
    assert Decimal(body["basic"]) == Decimal("5000.00")
    assert Decimal(body["gross"]) == Decimal("5500.00")


def test_a_percentage_component_is_worked_out_from_the_basic(client, world, login):
    h = login("admin")
    comp = _component(client, h, name="بدل سكن").json()
    emp = _emp(client, h)
    res = _salary(client, h, emp["id"], "2026-01-01", 5000,
                  lines=[{"component_id": comp["id"], "pct": "10"}])
    assert Decimal(res.json()["gross"]) == Decimal("5500.00")


def test_a_raise_is_a_new_row_and_the_old_one_survives(client, world, login):
    """قسيمة مايو لازم تفضل زي ما كانت بعد زيادة يونيو."""
    h = login("admin")
    emp = _emp(client, h)
    _salary(client, h, emp["id"], "2026-01-01", 5000)
    _salary(client, h, emp["id"], "2026-06-01", 7000)

    on_may = client.get(f"/api/v1/hr/payroll/salaries/{emp['id']}", headers=h,
                        params={"on": "2026-05-15"}).json()
    on_july = client.get(f"/api/v1/hr/payroll/salaries/{emp['id']}", headers=h,
                         params={"on": "2026-07-15"}).json()
    assert Decimal(on_may["current"]["basic"]) == Decimal("5000.00")
    assert Decimal(on_july["current"]["basic"]) == Decimal("7000.00")
    assert len(on_july["history"]) == 2, "الصف القديم اتمسح بدل ما يتحفظ"


def test_before_the_first_salary_there_is_none(client, world, login):
    """موظف اتعيّن بعد التاريخ المسؤول عنه — مش صفر، مافيش. الفرق بيهم حقيقي."""
    h = login("admin")
    emp = _emp(client, h)
    _salary(client, h, emp["id"], "2026-06-01", 7000)
    early = client.get(f"/api/v1/hr/payroll/salaries/{emp['id']}", headers=h,
                       params={"on": "2026-01-15"}).json()
    assert early["current"] is None


def test_the_agreed_insurance_base_beats_the_calculated_one(client, world, login):
    """الأجر التأميني حاجة بتتفق عليها مع التأمينات، مش بتتحسب من البنود."""
    h = login("admin")
    comp = _component(client, h, insurable=True).json()
    emp = _emp(client, h)
    res = _salary(client, h, emp["id"], "2026-01-01", 5000,
                  insurance_base="3000",
                  lines=[{"component_id": comp["id"], "amount": "500"}])
    assert Decimal(res.json()["insurance_base"]) == Decimal("3000.00")


def test_a_negative_basic_is_refused(client, world, login):
    h = login("admin")
    emp = _emp(client, h)
    assert _salary(client, h, emp["id"], "2026-01-01", -100).status_code == 422


# ------------------------------------------------------------------ الشرايح


def test_a_scheme_version_is_created_with_its_brackets(client, world, login):
    h = login("admin")
    res = _scheme(client, h)
    assert res.status_code == 201, res.text
    assert len(res.json()["brackets"]) == 3
    assert res.json()["brackets"][-1]["to_amount"] is None, "الشريحة الأخيرة مش مفتوحة"


def test_brackets_with_a_gap_are_refused(client, world, login):
    """فجوة بين الشرايح = دخل مابيتحاسبش، والرقم بيطلع غلط من غير ما حاجة تشتكي."""
    h = login("admin")
    res = _scheme(client, h, brackets=[
        {"from_amount": "0", "to_amount": "10000", "rate_pct": "0"},
        {"from_amount": "15000", "to_amount": None, "rate_pct": "10"},
    ])
    assert res.status_code == 422, res.text
    assert "متصلين" in res.text


def test_overlapping_brackets_are_refused(client, world, login):
    """تداخل = دخل بيتحاسب مرتين."""
    h = login("admin")
    res = _scheme(client, h, brackets=[
        {"from_amount": "0", "to_amount": "10000", "rate_pct": "0"},
        {"from_amount": "8000", "to_amount": None, "rate_pct": "10"},
    ])
    assert res.status_code == 422, res.text


def test_a_bracket_that_ends_before_it_starts_is_refused(client, world, login):
    h = login("admin")
    res = _scheme(client, h, brackets=[
        {"from_amount": "10000", "to_amount": "5000", "rate_pct": "10"},
    ])
    assert res.status_code == 422, res.text


def test_two_versions_cannot_start_on_the_same_day(client, world, login):
    h = login("admin")
    _scheme(client, h)
    again = _scheme(client, h, name="تاني")
    assert again.status_code == 422, again.text


def test_the_version_in_force_is_resolved_by_the_period_not_by_today(client, world, login):
    """«الشهر ده هيتحسب بأنهي شرايح» — سؤال بيتسأل قبل الترحيل."""
    h = login("admin")
    _scheme(client, h, name="قديم", effective_from="2025-01-01")
    _scheme(client, h, name="جديد", effective_from="2026-01-01")

    old = client.get("/api/v1/hr/payroll/schemes/effective", headers=h,
                     params={"scheme": "income_tax", "on": "2025-06-30"}).json()
    new = client.get("/api/v1/hr/payroll/schemes/effective", headers=h,
                     params={"scheme": "income_tax", "on": "2026-06-30"}).json()
    assert old["name"] == "قديم"
    assert new["name"] == "جديد"


def test_before_any_version_there_is_none_rather_than_a_guess(client, world, login):
    h = login("admin")
    _scheme(client, h, effective_from="2026-01-01")
    res = client.get("/api/v1/hr/payroll/schemes/effective", headers=h,
                     params={"scheme": "income_tax", "on": "2025-06-30"})
    assert res.status_code == 200
    assert res.json() is None


def test_a_version_used_by_a_posted_payroll_cannot_be_edited(client, world, login, db):
    """تصحيح رقم في شرايح اتحسب بيها مرتب مرحّل = إعادة كتابة الماضي في صمت.

    The ledger entries the payroll posted cannot be edited to match, so the books and the payslips
    would disagree with no way back. New rates are a new version, always.
    """
    from src.models.hr_payroll import PayrollSchemeVersion

    h = login("admin")
    version = _scheme(client, h).json()

    # المسير هو اللي بيقفلها (HR-6)؛ هنا بنقفلها بالإيد عشان القاعدة تتثبت قبله.
    db.get(PayrollSchemeVersion, version["id"]).locked = True
    db.commit()

    res = client.patch(f"/api/v1/hr/payroll/schemes/{version['id']}", headers=h,
                       json={"name": "تعديل"})
    assert res.status_code == 409, res.text
    assert res.json()["detail"]["code"] == "locked"

    bands = client.patch(f"/api/v1/hr/payroll/schemes/{version['id']}", headers=h,
                         json={"brackets": [{"from_amount": "0", "to_amount": None,
                                             "rate_pct": "99"}]})
    assert bands.status_code == 409, "الشرايح اتغيّرت في إصدار متجمّد"


def test_an_unused_version_is_still_editable(client, world, login):
    """التجميد للمستعمل بس — الغلطة قبل أول ترحيل بتتصلّح عادي."""
    h = login("admin")
    version = _scheme(client, h).json()
    res = client.patch(f"/api/v1/hr/payroll/schemes/{version['id']}", headers=h,
                       json={"name": "اتصلّح"})
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "اتصلّح"


# ------------------------------------------------------------------ الإعدادات


def test_the_settings_open_on_values_not_on_empty(client, world, login):
    h = login("admin")
    res = client.get("/api/v1/hr/payroll/settings", headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["days_per_month"] == 30
    # الافتراضي «التأخير بيتسجّل ومابيتخصمش» — خصم صامت بيخسّر الثقة في أول شهر.
    assert res.json()["late_policy"] == "none"


def test_the_settings_are_changed_and_stick(client, world, login):
    h = login("admin")
    client.patch("/api/v1/hr/payroll/settings", headers=h, json={"days_per_month": 26})
    assert client.get("/api/v1/hr/payroll/settings", headers=h).json()["days_per_month"] == 26


# ------------------------------------------------------------------ الصلاحيات


def test_a_viewer_cannot_read_a_salary(client, world, login):
    """أهم فحص صلاحيات في الموديول ده.

    `salary.view` does not end in `.read`, so the viewer role — which is derived from that suffix —
    never picks it up. Renaming it to `salary.read` would hand every viewer in the company every
    colleague's pay, and this is where that shows.
    """
    h = login("admin")
    emp = _emp(client, h)
    _salary(client, h, emp["id"], "2026-01-01", 5000)
    client.post("/api/v1/users", headers=h, json={
        "username": "watcher3", "password": "pw", "full_name": "مراقب", "role": "viewer"})
    viewer = login("watcher3")

    assert client.get("/api/v1/hr/payroll/components", headers=viewer).status_code == 200
    assert client.get(f"/api/v1/hr/payroll/salaries/{emp['id']}",
                      headers=viewer).status_code == 403


def test_a_branch_manager_cannot_read_a_salary_either(client, world, login):
    """بيعتمد الحضور والأجازات — ومالوش دعوة بمرتبات زمايله."""
    h = login("admin")
    emp = _emp(client, h)
    _salary(client, h, emp["id"], "2026-01-01", 5000)
    manager = login("bm_a")
    assert client.get("/api/v1/hr/attendance/days", headers=manager).status_code == 200
    assert client.get(f"/api/v1/hr/payroll/salaries/{emp['id']}",
                      headers=manager).status_code == 403


def test_the_accountant_reads_and_writes_payroll(client, world, login):
    h = login("admin")
    emp = _emp(client, h)
    acct = login("acct")
    res = _salary(client, acct, emp["id"], "2026-01-01", 5000)
    assert res.status_code == 201, res.text
    assert client.get(f"/api/v1/hr/payroll/salaries/{emp['id']}",
                      headers=acct).status_code == 200
