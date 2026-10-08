from __future__ import annotations

import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.stock import StockMovement
from src.models.warehouse import Warehouse

PAIRS: list[tuple[str, str]] = [
    ("مندوب السياره ( أ )", "مخزن السياره ( أ )"),
    ("مندوب السياره ( ب )", "مخزن السياره ( ب )"),
    ("مندوب السياره ( ج )", "محزن السياره ( ج )"),
    ("مندوب السياره (د)", "مخزن السياره ( د )"),
    ("مندوب سياره الشرقيه", "مخزن سيارة الشرقية"),
]

UNLINK: list[str] = ["اداره مبيعات", "ادارة الفروع", "مندوب المبيعات — العلياء"]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        def moves(w: Warehouse) -> int:
            return db.scalar(
                select(func.count()).select_from(StockMovement)
                .where(StockMovement.location_id == w.id,
                       StockMovement.location_kind == "warehouse")) or 0

        plan: list[tuple[Employee, Warehouse, Warehouse | None]] = []
        problems: list[str] = []

        for emp_name, wh_name in PAIRS:
            emps = db.scalars(select(Employee).where(Employee.name == emp_name)).all()
            whs = db.scalars(select(Warehouse).where(Warehouse.name == wh_name)).all()
            if len(emps) != 1 or len(whs) != 1:
                problems.append(f"«{emp_name}» → «{wh_name}»: "
                                f"{len(emps)} موظف × {len(whs)} مخزن")
                continue
            emp, wh = emps[0], whs[0]
            old = db.get(Warehouse, emp.warehouse_id) if emp.warehouse_id else None
            if emp.warehouse_id == wh.id:
                continue
            plan.append((emp, wh, old))

        unlink: list[tuple[Employee, Warehouse]] = []
        for name in UNLINK:
            for emp in db.scalars(select(Employee).where(Employee.name == name)):
                if emp.warehouse_id:
                    w = db.get(Warehouse, emp.warehouse_id)
                    if w is not None:
                        unlink.append((emp, w))

        print(f"{'الموظف':<24}{'من':<24}{'إلى':<24}{'حركات':>7}")
        print("-" * 80)
        for emp, wh, old in plan:
            print(f"{emp.name[:22]:<24}{(old.name if old else '—')[:22]:<24}"
                  f"{wh.name[:22]:<24}{moves(wh):>7}")
        print(f"\nهيتصلّح: {len(plan)}")

        if unlink:
            print(f"\nهيتفكّ منهم المخزن ({len(unlink)}) — مسمّيات إدارية مش مناديب سيارات:")
            for emp, w in unlink:
                print(f"   {emp.name:<26}كان على «{w.name}»")

        if problems:
            print("\n⚠️ مش هيتغيّروا — الاسم مش بيحدّد صف واحد:")
            for p in problems:
                print(f"   {p}")

        target_ids = {w.id for _e, w, _o in plan}
        for emp in db.scalars(select(Employee).where(Employee.warehouse_id.in_(target_ids))):
            if emp.id not in {e.id for e, _w, _o in plan} and \
               emp.id not in {e.id for e, _w in unlink}:
                problems.append(f"«{emp.name}» ماسك مخزن من المطلوبين — اتفكّ منه الأول")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for emp, _w in unlink:
            emp.warehouse_id = None
        db.flush()
        for emp, wh, _old in plan:
            emp.warehouse_id = wh.id
        db.commit()

        print("\nبعد التصحيح:")
        for emp_name, _wh in PAIRS:
            emp = db.scalar(select(Employee).where(Employee.name == emp_name))
            w = db.get(Warehouse, emp.warehouse_id) if emp and emp.warehouse_id else None
            mark = "✔" if w and w.name == dict(PAIRS)[emp_name] else "✘"
            print(f"{mark} {emp_name:<24}{(w.name if w else '—'):<24}"
                  f"{moves(w) if w else 0:>7} حركة")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
