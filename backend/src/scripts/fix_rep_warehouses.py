"""يصلّح ربط مندوب السيارة بمخزنه — الربط كان مزحلق، وكل واحد على مخزن غيره.

    python -m src.scripts.fix_rep_warehouses          # يعرض بس
    python -m src.scripts.fix_rep_warehouses --yes    # ينفّذ

**اللي كان حاصل** — الجدول ده مقيس من القاعدة، مش مفترض:

    مخزن السياره ( أ )    ١٢٬٦٢٢ حركة   مربوط بـ→ مندوب السياره ( ج )
    مخزن السياره ( ب )    ١٨٬٥٧٣        مربوط بـ→ مندوب سياره الشرقيه
    محزن السياره ( ج )    ١٨٬١٠٩        مربوط بـ→ اداره مبيعات
    مخزن السياره ( د )    ١٥٬٤٨٠        مربوط بـ→ ادارة الفروع
    مخزن سيارة الشرقية    ١١٬٩٠٤        مربوط بـ→ مندوب المبيعات — العلياء

    ومندوب ( أ ) على «مخزن سياره احمد شوقى» — **صفر حركة**
    ومندوب ( د ) على «مخزن سياره الجيار»   — **صفر حركة**
    ومندوب ( ب ) على «مخزن سياره كامل»     — ٧ حركات

المطابقة الأوتوماتيكية بالاسم زحلقت الحروف: «مندوب السياره ( ج )» راح لـ«مخزن السياره
( أ )». الأقواس والمسافات جوّاها (`( أ )` مقابل `(أ)`) بتخلّي المقارنة بالكلمات تلاقي
تطابق جزئي وتقبله.

**الأثر مش شكلي.** `rep_store_service.rep_store` بيقرا `employee.warehouse_id` عشان
يعرف المندوب بيبيع من فين. يعني المندوب بيخصم من مخزن راجل تاني، والتاني يلاقي بضاعته
ناقصة من غير سبب. واللي على مخزن فاضي مايقدرش يبيع أصلاً — التطبيق بيقول له مافيش رصيد
وهو واقف جنب عربية مليانة.

**التصحيح صريح بالاسم**، لأن اللي غلط أصلاً هو المطابقة الآلية. والسكربت بيتحقق قبل ما
يكتب إن المخزن مش متاخد لموظف تاني.

**مابيتلمسش:** ولا حركة مخزون ولا فاتورة. الربط بس — واللي اتباع من مخزن غلط قبل كده
اتباع منه فعلاً، والدفتر بيحكي اللي حصل.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.stock import StockMovement
from src.models.warehouse import Warehouse

# اسم الموظف (زي ما هو في a5) → اسم المخزن بالظبط. مافيش تطبيع ولا تقريب: اللي وقّعنا
# هو التقريب، فالتصحيح بالنص الكامل.
PAIRS: list[tuple[str, str]] = [
    ("مندوب السياره ( أ )", "مخزن السياره ( أ )"),
    ("مندوب السياره ( ب )", "مخزن السياره ( ب )"),
    ("مندوب السياره ( ج )", "محزن السياره ( ج )"),   # «محزن» غلطة مطبعية في داتا a5
    ("مندوب السياره (د)", "مخزن السياره ( د )"),
    ("مندوب سياره الشرقيه", "مخزن سيارة الشرقية"),
]

# اللي بيتشال منهم المخزن: مسمّيات إدارية مش مناديب سيارات، وماكانش المفروض تمسك
# مخزن سيارة أصلاً.
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

        # التصادم: مخزن هيتاخد وهو متاخد لحد تاني مش في الخطة.
        target_ids = {w.id for _e, w, _o in plan}
        for emp in db.scalars(select(Employee).where(Employee.warehouse_id.in_(target_ids))):
            if emp.id not in {e.id for e, _w, _o in plan} and \
               emp.id not in {e.id for e, _w in unlink}:
                problems.append(f"«{emp.name}» ماسك مخزن من المطلوبين — اتفكّ منه الأول")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        # الفكّ الأول، عشان المخزن يبقى فاضي قبل ما يتاخد.
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
