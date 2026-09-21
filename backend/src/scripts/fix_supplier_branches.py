# -*- coding: utf-8 -*-
"""المورد اللي فرعه فاضي — بيتكتب عليه فرعه من بادئة كوده.

    python -m src.scripts.fix_supplier_branches
    python -m src.scripts.fix_supplier_branches --yes

**المشكلة.** استيراد موردين فرع المصنع كتب الكروت صح (١١٠ مورد بكودهم الحقيقي
`FC-A5-…`) وساب `branch_id` فاضي. وعند a5 الكشف سليم؛ الناقص عندنا هو الفرع بس.

**والفرع الفاضي مش «مالوش فرع» — ده «مركزي، الكل بيشوفه».** القاعدة في
`branch_scope.scope`:

    stmt.where(or_(model.branch_id == branch_id, model.branch_id.is_(None)))

يعني الـ١١٠ مورد بتوع المصنع كانوا بيطلعوا في قايمة موردين **العلياء وأكتوبر كمان**.
واللي في العلياء بيفتح قايمة الموردين يلاقي فيها موردين مصنع مالهمش علاقة بيه، ويقدر
يكتب عليهم فاتورة شرا بفرعه.

**والبادئة هي الدليل، مش الاسم.** الكود بيتولّد وقت النقل من بادئة الفرع (`FC-`
المصنع، `AL-` العلياء، بدون بادئة أكتوبر) وبيفضل ثابت؛ الاسم بيتعدّل من الشاشة.

**والصف اللي فرعه مكتوب مابيتلمسش** — حتى لو مختلف عن بادئته. ده ممكن يكون نقل
بقرار، والكتابة فوقه بتلغي قرار مش بتصلّح غلط.

ومافيش رصيد ولا مستند ولا قيد بيتغيّر هنا — التصنيف بس.
"""
from __future__ import annotations

import argparse
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.org import Branch
from src.models.supplier import Supplier

#: بادئة الكود → اسم الفرع. بدون بادئة = أكتوبر، وده الأصل اللي النقل بدأ منه.
PREFIX_BRANCH: list[tuple[str, str]] = [
    ("FC-", "السادات"),
    ("AL-", "العلياء"),
]
DEFAULT_BRANCH = "أكتوبر"


def _branch_name(code: str) -> str:
    for prefix, name in PREFIX_BRANCH:
        if (code or "").startswith(prefix):
            return name
    return DEFAULT_BRANCH


def main() -> None:
    ap = argparse.ArgumentParser(description="كتابة فرع المورد من بادئة كوده")
    ap.add_argument("--yes", action="store_true", help="نفّذ")
    ap.add_argument("--limit", type=int, default=12, help="حجم العيّنة في الكشف")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        branches = {b.name: b for b in db.scalars(select(Branch)).all()}
        rows = db.scalars(select(Supplier).where(Supplier.branch_id.is_(None))).all()
        if not rows:
            print("مافيش مورد فرعه فاضي.")
            return

        plan: dict[str, list[Supplier]] = defaultdict(list)
        missing: set[str] = set()
        for s in rows:
            name = _branch_name(s.code or "")
            if name not in branches:
                missing.add(name)
                continue
            plan[name].append(s)

        print(f"{'موردين فرعهم فاضي':<28}{len(rows):>6,}")
        for name, group in sorted(plan.items(), key=lambda kv: -len(kv[1])):
            print(f"   ⇦ {name:<22}{len(group):>6,}")
        if missing:
            print(f"\n⚠ فروع مش موجودة في القاعدة، والصفوف بتاعتها اتسابت: "
                  f"{'، '.join(sorted(missing))}")

        print(f"\n{'الكود':<18}{'الفرع':<12}الاسم")
        shown = 0
        for name, group in sorted(plan.items()):
            for s in group[: args.limit]:
                print(f"{(s.code or ''):<18}{name:<12}{s.name}")
                shown += 1
            if len(group) > args.limit:
                print(f"   … و{len(group) - args.limit:,} مورد تاني في «{name}»")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return

        done = 0
        for name, group in plan.items():
            for s in group:
                s.branch_id = branches[name].id
                done += 1
        db.commit()
        print(f"\n   ✓ اتكتب الفرع على {done:,} مورد.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
