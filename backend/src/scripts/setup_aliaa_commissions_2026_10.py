from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.hr_payroll_run import PayrollLine
from src.services import salary_service

BRANCH, YEAR, MONTH = 2, 2026, 10

POOLS = [
    ("سيارة أ", 542430, 524990),
    ("سيارة ب", 471575, 464935),
    ("سيارة ج", 424937, 705378),
    ("سيارة د", 209422, 305893),
    ("الشرقية", 300555, 274385),
    ("إسكندرية", 233775, 0),
    ("الضبعة", 193500, 0),
]
ALL = [p[0] for p in POOLS]
CAR = dict(pct="2.5", white_pct="2", split=2)

RULES = {
    "حذيفه زين عبد الفتاح": [dict(pools=["سيارة أ"], **CAR)],
    "وائل هلول": [dict(pools=["سيارة أ"], **CAR)],
    "ابراهيم حسونه": [dict(pools=["سيارة ب"], **CAR)],
    "محمد عسران": [dict(pools=["سيارة ب"], **CAR)],
    "محمد مكرم": [dict(pools=["سيارة ج"], **CAR)],
    "احمد عسران": [dict(pools=["سيارة ج"], **CAR)],
    "احمد صبرى": [dict(pools=["سيارة د"], **CAR)],
    "ابراهيم حمود": [dict(pools=["سيارة د"], **CAR)],
    "حسام موسي": [dict(pools=["الشرقية"], **CAR)],
    "نصر السيد": [dict(pools=["الشرقية"], **CAR)],
    "حسن رمضان.": [dict(pools=["سيارة ب", "سيارة د"], pct="0.88", white_pct="0.7", split=1)],
    "كامل هلول": [dict(pools=ALL, pct="0.5", white_pct="0.5", split=1)],
    "أحمد الشحات": [dict(pools=["إسكندرية"], pct="1", white_pct="1", split=1)],
}


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        pr = salary_service.current_run(db, branch_id=BRANCH, year=YEAR, month=MONTH)
        if pr is None or pr.status.value != "draft":
            raise SystemExit("مرتبات أكتوبر للعلياء مش مسودة.")
        before = {ln.employee_id: Decimal(str(ln.net)) for ln in db.scalars(
            select(PayrollLine).where(PayrollLine.run_id == pr.id)).all()}
        salary_service.save_pools(db, branch_id=BRANCH, year=YEAR, month=MONTH, actor_user_id=actor,
                                  rows=[{"name": n, "poly": p, "white": w} for n, p, w in POOLS])
        ids = {p["name"]: p["id"] for p in salary_service.pools_of(
            db, branch_id=BRANCH, year=YEAR, month=MONTH)}
        emps = {e.name: e for e in db.scalars(select(Employee).where(
            Employee.branch_id == BRANCH, Employee.active.is_(True))).all()}
        for name, rules in RULES.items():
            emp = emps[name]
            salary_service.save_rules(db, employee=emp, actor_user_id=actor, rules=[
                {"basis": "pool", "pct": r["pct"], "white_pct": r["white_pct"],
                 "split": r["split"], "pools": [ids[p] for p in r["pools"]]} for r in rules])
            salary_service.update_line(db, run_id=pr.id, employee_id=emp.id,
                                       fields={"commission_override": None},
                                       actor_user_id=actor)
        db.flush()
        bad = 0
        for ln in db.scalars(select(PayrollLine).where(PayrollLine.run_id == pr.id)).all():
            emp = db.get(Employee, ln.employee_id)
            got, was = Decimal(str(ln.net)), before.get(ln.employee_id)
            ok = was is not None and got == was
            bad += not ok
            if emp.name in RULES or not ok:
                print(f"{'✓' if ok else '✗'} {emp.name}: عمولة {ln.commission} — صافي {got} (كان {was})")
        print(f"صافي الشهر {pr.net}")
        if bad:
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
