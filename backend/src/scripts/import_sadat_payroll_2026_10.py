from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_advance import AdjustmentBasis, AdjustmentKind
from src.models.hr_payroll_run import PayrollLine
from src.services import advance_service, employee_card_service, numbering, salary_service

BRANCH = 3
YEAR, MONTH = 2026, 10
FROM = date(2026, 10, 1)
PROD, QUALITY, STORES = 6, 7, 8
WORKER = 16

ROWS = [
    dict(sheet="ابو انس", name="ابو انس", basic=8000, allow=5200, transport=630, net="13830"),
    dict(sheet="ابراهيم ابو معاذ", name="ابراهيم ابو معاذ", basic=2200, allow=7300, ot=-17,
         transport=960, incentive=841, adv=1320, net="9139.85",
         notes="راح النيل 16 ساعة أثناء الوردية تم الخصم"),
    dict(sheet="عبد المغني", name="عبد الغني", basic=1200, allow=10800, ot=-6.68, incentive=2,
         net="11584.5", notes="اشتغل 181 ساعة عليه عجز 11 ساعة"),
    dict(sheet="ابو احمد", name="ابو احمد", new=PROD, basic=1200, allow=12800, absent=22.5,
         net="3500", notes="شغل 43.5 ساعة حساب مرتب 14000 تمت المراجعة 48 ساعة"),
    dict(sheet="انس شعبان", name="انس شعبان", new=PROD, basic=3000, allow=3500, annual=1500,
         net="8000"),
    dict(sheet="محمد سامي", name="محمد سامي", basic=2000, allow=4000, annual=1000, ot=26,
         transport=520, adv=250, net="8028.33", notes="يومين جمعة 16 + يوم الاثنين 10"),
    dict(sheet="محمد الجبالي", name="محمد الجبالى", basic=1200, allow=5800, annual=500,
         transport=720, adv=3500, net="4720"),
    dict(sheet="سالم هلول", name="سالم هلول", basic=1200, allow=5800, annual=1000,
         transport=960, adv=1260, net="7700"),
    dict(sheet="عبد الله عصام", name="عبد الله عصام", basic=2000, allow=4000, transport=720,
         adv=500, net="6220"),
    dict(sheet="مصطفى الابحر", name="مصطفى الابحر", basic=1200, allow=5800, transport=720,
         adv=7600, net="120"),
    dict(sheet="سعيد هويدي", name="سعيد هويدي", new=PROD, basic=1500, allow=5000,
         transport=720, net="7220"),
    dict(sheet="الحسن عامر", name="الحسن عامر", basic=1200, allow=7300, annual=2000,
         transport=480, adv=1000, net="9980"),
    dict(sheet="ام عمرو", name="ام عمرو", basic=1500, allow=4500, annual=1000,
         commission=1453.05, transport=4250, absent=1, insurance=275, net="12194.72"),
    dict(sheet="هيام", name="هيام", new=QUALITY, basic=1200, allow=3800, annual=500, adv=1000,
         net="4500"),
    dict(sheet="ام محمد بسيمة", name="بسيمة", basic=1200, allow=2800, annual=1000, incentive=2,
         absent=1, adv=1000, net="3835.33"),
    dict(sheet="ام ياسر", name="ام ياسر", new=QUALITY, basic=1200, allow=3800, annual=500,
         net="5500"),
    dict(sheet="علي الابحر", name="علي الابحر", basic=3500, allow=7000, commission=1728.6,
         transport=2640, incentive=1000, deduction=2640, adv=6500, penalty_days=1,
         insurance=275, net="6103.6",
         notes="خصم 2640 انتقالات شخصية، وخصم يوم جزاء، وتم خصم 5500 سلف صيانة العربية"),
    dict(sheet="نرمين", name="نرمين", basic=1500, allow=5000, annual=1500, commission=145.305,
         extra_days=1.5, adv=1000, net="7545.31", notes="إضافي 1.5 يوم بدل 3 أيام ام عمرو"),
    dict(sheet="سمر", name="سمر عصام", basic=1500, allow=3500, transport=140, adv=1000,
         net="4140"),
    dict(sheet="محمد محمود", name="محمد محمود", basic=1500, allow=6500, transport=520,
         incentive=2600, adv=6600, net="4520", notes="13 يوم غفرة ويوم غياب غفرة"),
    dict(sheet="محمد منصف", name="محمد منصف", basic=1500, allow=5500, annual=500, transport=520,
         incentive=300, net="8320", notes="مكافأة 300 ج"),
]
SHEET_TOTAL = Decimal("146701.64")


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        emps = {e.name.strip(): e for e in db.scalars(select(Employee).where(
            Employee.branch_id == BRANCH, Employee.active.is_(True))).all()}
        if salary_service.current_run(db, branch_id=BRANCH, year=YEAR, month=MONTH):
            raise SystemExit("مرتبات الشهر موجودة بالفعل للسادات.")
        ids = {}
        for r in ROWS:
            emp = emps.get(r["name"])
            if emp is None:
                if not r.get("new"):
                    raise SystemExit(f"الموظف {r['name']} غير موجود.")
                emp = Employee(
                    code=numbering.next_document_number(db, Employee, "EMP",
                                                        column=Employee.code, width=4),
                    name=r["name"], branch_id=BRANCH, department_id=r["new"],
                    job_title_id=WORKER)
                db.add(emp)
                db.flush()
                employee_card_service.open_card(db, emp)
                print(f"موظف جديد: {emp.code} {emp.name}")
            elif r.get("new"):
                raise SystemExit(f"الموظف {r['name']} موجود بالفعل.")
            ids[r["sheet"]] = emp.id
            items = [{"name": "بدلات", "amount": r["allow"]}]
            if r.get("annual"):
                items.append({"name": "زيادة سنوية", "amount": r["annual"]})
            salary_service.save_card(db, employee=emp, effective_from=FROM, basic=r["basic"],
                                     items=items, insurance=r.get("insurance", 0), rules=[],
                                     actor_user_id=actor)
            if r.get("adv"):
                advance_service.create_advance(
                    db, employee_id=emp.id, amount=r["adv"], advance_date=date(2026, 10, 31),
                    actor_user_id=actor, start_year=YEAR, start_month=MONTH,
                    reason="سلف شهر 10 من شيت مرتبات السادات", branch_id=BRANCH, post=False)
            if r.get("penalty_days"):
                salary_service.save_adjustment(
                    db, emp=emp, actor_user_id=actor,
                    data={"kind": AdjustmentKind.penalty.value, "basis": AdjustmentBasis.days.value,
                          "quantity": r["penalty_days"], "year": YEAR, "month": MONTH,
                          "reason": "خصم يوم جزاء"})
        db.flush()
        pr = salary_service.calculate(db, branch_id=BRANCH, year=YEAR, month=MONTH,
                                      actor_user_id=actor)
        for r in ROWS:
            fields = {k: v for k, v in {
                "overtime_hours": r.get("ot"), "commission_override": r.get("commission"),
                "extra_days": r.get("extra_days"), "transport": r.get("transport"),
                "extra_earning": r.get("incentive"), "absent_override": r.get("absent", 0),
                "extra_deduction": r.get("deduction"), "notes": r.get("notes"),
            }.items() if v is not None}
            salary_service.update_line(db, run_id=pr.id, employee_id=ids[r["sheet"]],
                                       fields=fields, actor_user_id=actor)
        db.flush()
        lines = {ln.employee_id: ln for ln in db.scalars(
            select(PayrollLine).where(PayrollLine.run_id == pr.id)).all()}
        bad = 0
        for r in ROWS:
            ln = lines.get(ids[r["sheet"]])
            got = Decimal(str(ln.net)) if ln else None
            ok = got is not None and abs(got - Decimal(r["net"])) <= Decimal("0.01")
            bad += not ok
            print(f"{'✓' if ok else '✗'} {r['sheet']}: الشيت {r['net']} — النظام {got}")
        extra = set(lines) - set(ids.values())
        for eid in extra:
            print(f"! سطر زائد: {db.get(Employee, eid).name} صافي {lines[eid].net}")
        total = sum((Decimal(str(lines[i].net)) for i in ids.values() if i in lines), Decimal(0))
        print(f"الإجمالي: الشيت {SHEET_TOTAL} — النظام {total}  ({pr.document_number})")
        if bad or extra:
            raise SystemExit("فيه فروق — لم يُحفظ شيء.")
        if execute:
            db.commit()
            print("اتحفظ.")
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    actor_arg = next((a for a in sys.argv if a.startswith("--actor=")), "--actor=1")
    run(execute="--yes" in sys.argv, actor=int(actor_arg.split("=")[1]))
