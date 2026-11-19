from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_advance import AdjustmentBasis, AdjustmentKind
from src.models.hr_payroll_run import PayrollLine
from src.services import employee_card_service, numbering, salary_service

BRANCH = 2
YEAR, MONTH = 2026, 10
FROM = date(2026, 10, 1)
ADMIN = 2

BONUS, EARN, PENALTY, DED = (AdjustmentKind.bonus, AdjustmentKind.other_earning,
                             AdjustmentKind.penalty, AdjustmentKind.other_deduction)

ROWS = [
    dict(sheet="كامل هلول", name="كامل هلول", basic=2914,
         items={"تقييم": 500, "منحة غلاء": 500}, commission="23258.88", insurance=275,
         adj=[(EARN, 3000, "إضافي")], net="29897.88",
         notes="عمولة 0.5٪ من تحصيل 4,651,775"),
    dict(sheet="الشحات هلول", name="الشحات العربى", basic=1755,
         items={"بدلات": 100, "تقييم": 4485, "منحة غلاء": 750, "مكالمات": 25},
         adj=[(EARN, 1000, "إضافي")], net="8115"),
    dict(sheet="احمد عسران", name="احمد عسران", basic=1873,
         items={"بدلات": 250, "منحة غلاء": 500}, commission="12365.49", net="14988.49",
         notes="نصف عمولة سيارة ج"),
    dict(sheet="محمد مكرم", name="محمد مكرم", basic=1586,
         items={"تقييم": 80, "منحة غلاء": 500}, commission="12365.49", net="14531.49",
         notes="نصف عمولة سيارة ج"),
    dict(sheet="حذيفة زين", name="حذيفه زين عبد الفتاح", basic=1750,
         items={"بدلات": 500, "تقييم": 1000, "منحة غلاء": 700}, commission="12030.28",
         net="15980.28", notes="نصف عمولة سيارة أ"),
    dict(sheet="حسن رمضان", name="حسن رمضان.", basic=1442,
         items={"تقييم": 1000, "منحة غلاء": 800}, commission="11388.57", net="14630.57",
         notes="إشراف ب/د: 0.88٪ بولي + 0.7٪ أبيض"),
    dict(sheet="احمد الشحات", name="أحمد الشحات", basic=1600,
         items={"بدلات": 1000, "تقييم": 5000, "منحة غلاء": 500, "مكالمات": 400},
         commission="2337.75", adj=[(EARN, 1500, "إضافي")], dues=500, net="11837.75"),
    dict(sheet="ابراهيم حسونة", name="ابراهيم حسونه", basic=1617,
         items={"منحة غلاء": 500}, commission="10544.04", dues=2000, net="10661.04",
         notes="نصف عمولة سيارة ب"),
    dict(sheet="محمد عسران", name="محمد عسران", basic=1605,
         items={"منحة غلاء": 500}, commission="10544.04", net="12649.04",
         notes="نصف عمولة سيارة ب"),
    dict(sheet="حسام موسي", name="حسام موسي", basic=1818,
         items={"منحة غلاء": 500}, commission="6500.79", adj=[(EARN, 1181, "إضافي")],
         net="9999.79", notes="نصف عمولة سيارة الشرقية"),
    dict(sheet="نصر زاهر", name="نصر السيد", basic=1605,
         items={"بدلات": 500, "تقييم": 895, "منحة غلاء": 500}, commission="6500.79",
         net="10000.79", notes="نصف عمولة سيارة الشرقية"),
    dict(sheet="احمد صبري", name="احمد صبرى", basic=1500,
         items={"بدلات": 500, "تقييم": 3000, "منحة غلاء": 500}, commission="5676.71",
         dues=1177, net="9999.71", notes="نصف عمولة سيارة د"),
    dict(sheet="ابراهيم حمود", name="ابراهيم حمود", basic=1500,
         items={"بدلات": 500, "تقييم": 500, "منحة غلاء": 500}, commission="5676.71",
         net="8676.71", notes="نصف عمولة سيارة د"),
    dict(sheet="وائل هلول", name="وائل هلول", basic=1500,
         items={"بدلات": 500, "تقييم": 500, "منحة غلاء": 500}, commission="12030.28",
         net="15030.28", notes="نصف عمولة سيارة أ"),
    dict(sheet="محمد عزوز", name="محمد عزوز.", basic=1500,
         items={"بدلات": 500, "تقييم": 3500, "منحة غلاء": 500},
         adj=[(EARN, 1000, "إضافي")], net="7000"),

    dict(sheet="محمد حسن", name="محمد حسن", basic=2800,
         items={"بدلات": 1700, "تقييم": 1000, "منحة غلاء": 1000}, insurance=275,
         adj=[(EARN, 500, "إضافي"), (BONUS, 1000, "مكافأة")], net="7725"),
    dict(sheet="محمد عبد العال", name="محمد عبد العال", basic=2630,
         items={"بدلات": 2400, "تقييم": 2500, "منحة غلاء": 1000},
         adj=[(EARN, 1000, "إضافي"), (BONUS, 500, "مكافأة"), (PENALTY, 30, "عجز/جزاء")],
         net="10000"),
    dict(sheet="احمد منصف", name="احمد منصف زين الدين", basic=1850,
         items={"بدلات": 1000, "تقييم": 1300, "منحة غلاء": 1000},
         adj=[(EARN, 1500, "إضافي"), (BONUS, 1000, "مكافأة")], net="7650",
         notes="إضافي 500 + 1000"),
    dict(sheet="احمد صالح", name="احمد صالح", new=ADMIN, basic=1500,
         items={"بدلات": 2000, "تقييم": 1000, "منحة غلاء": 1000},
         adj=[(EARN, 1000, "إضافي"), (BONUS, 500, "مكافأة")], net="7000"),
    dict(sheet="محمد ربيع", name="محمد ربيع السقا", basic=1800,
         items={"بدلات": 1550, "تقييم": 1000, "منحة غلاء": 1000},
         adj=[(EARN, 1200, "إضافي"), (BONUS, 1100, "مكافأة")], net="7650",
         notes="إضافي 1000 + 200"),
    dict(sheet="محمود النقراشي", name="محمود النقراشى", basic=1285,
         items={"بدلات": 1060, "منحة غلاء": 300},
         adj=[(EARN, 500, "إضافي"), (BONUS, 200, "مكافأة")], net="3345"),
    dict(sheet="محمد عشيبة", name="محمد عشيبة", basic=1175, items={"منحة غلاء": 300},
         net="1475"),

    dict(sheet="محمد هلال", name="محمد هلال ابو عمه", basic=2355,
         items={"بدلات": 500, "اشراف": 2000, "تقييم": 1000}, insurance=275,
         adj=[(BONUS, 3000, "مكافأة")], net="8580"),
    dict(sheet="احمد تركي", name="أحمدتركى", basic=2120,
         items={"بدلات": 1200, "اشراف": 1000, "تقييم": 1000, "منحة غلاء": 500},
         adj=[(DED, "70.67", "غياب يوم (على الأساسي)")], net="5749.33"),
    dict(sheet="اشرف محيي", name="اشرف محى", basic=2120,
         items={"بدلات": 1200, "تقييم": 1000, "منحة غلاء": 500, "بدلات اضافية": 750},
         adj=[(BONUS, 250, "مكافأة")], net="5820"),
    dict(sheet="بيومى جابر", name="بيومى جابر", basic=2050,
         items={"بدلات": 1000, "تقييم": 1000, "منحة غلاء": 500, "بدلات اضافية": 750},
         net="5300"),
    dict(sheet="حسن عيد", name="حسن عيد", basic=1530,
         items={"بدلات": 1200, "تقييم": 1000, "منحة غلاء": 500}, net="4230"),
    dict(sheet="محمد ممدوح", name="محمد ممدوح", basic=1475,
         items={"بدلات": 1250, "تقييم": 1000, "منحة غلاء": 500, "بدلات اضافية": 1300},
         dues=4000, net="1525"),
    dict(sheet="مدحت خضر", name="مدحت خضر", basic=1475,
         items={"بدلات": 2400, "تقييم": 1000, "منحة غلاء": 500, "بدلات اضافية": 300},
         adj=[(DED, "98.33", "غياب يومين (على الأساسي)")], net="5576.67"),
    dict(sheet="محمد تركى", name="محمد تركى", basic=1500,
         items={"بدلات": 3500, "تقييم": 1000, "منحة غلاء": 500},
         adj=[(DED, 100, "غياب يومين (على الأساسي)")], net="6400"),
]
SHEET_TOTAL = Decimal("282024.79")


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        emps = {e.name.strip(): e for e in db.scalars(select(Employee).where(
            Employee.branch_id == BRANCH, Employee.active.is_(True))).all()}
        if salary_service.current_run(db, branch_id=BRANCH, year=YEAR, month=MONTH):
            raise SystemExit("مرتبات الشهر موجودة بالفعل للعلياء.")
        ids = {}
        for r in ROWS:
            emp = emps.get(r["name"])
            if emp is None:
                if not r.get("new"):
                    raise SystemExit(f"الموظف {r['name']} غير موجود.")
                emp = Employee(
                    code=numbering.next_document_number(db, Employee, "EMP",
                                                        column=Employee.code, width=4),
                    name=r["name"], branch_id=BRANCH, department_id=r["new"])
                db.add(emp)
                db.flush()
                print(f"موظف جديد: {emp.code} {emp.name}")
            elif r.get("new"):
                raise SystemExit(f"الموظف {r['name']} موجود بالفعل.")
            if r.get("dues") and emp.receivable_account_id is None:
                employee_card_service.open_card(db, emp)
                db.flush()
            ids[r["sheet"]] = emp.id
            salary_service.save_card(
                db, employee=emp, effective_from=FROM, basic=r["basic"],
                items=[{"name": k, "amount": v} for k, v in r["items"].items()],
                insurance=r.get("insurance", 0), rules=[], actor_user_id=actor)
            for kind, amount, reason in r.get("adj", []):
                salary_service.save_adjustment(
                    db, emp=emp, actor_user_id=actor,
                    data={"kind": kind.value, "basis": AdjustmentBasis.amount.value,
                          "amount": amount, "year": YEAR, "month": MONTH, "reason": reason})
        db.flush()
        pr = salary_service.calculate(db, branch_id=BRANCH, year=YEAR, month=MONTH,
                                      actor_user_id=actor)
        for r in ROWS:
            fields = {k: v for k, v in {
                "commission_override": r.get("commission"),
                "dues_deduction": r.get("dues"), "notes": r.get("notes"),
            }.items() if v is not None}
            if fields:
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
