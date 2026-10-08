from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.lib import phones
from src.models.customer import Customer
from src.models.inspection import Inspection
from src.models.owner import Owner


def _plan_owner(db) -> list[tuple]:
    plan = []
    for o in db.scalars(select(Owner)).all():
        first = phones.normalize(o.phone)
        second = phones.normalize(o.phone2)
        if first is None and second is not None:
            changes = [("phone", second), ("phone2", None)]
            reason = "الرقم الحقيقي كان في الخانة التانية"
        else:
            changes = []
            if first != (o.phone or None):
                changes.append(("phone", first))
            if second != (o.phone2 or None):
                changes.append(("phone2", second))
            if not changes:
                continue
            reason = ("قيمة نائبة اتشالت" if first is None and o.phone
                      else "الصفر الأول رجع")
        plan.append((o, changes, reason))
    return plan


def _plan_simple(db, model, label: str) -> list[tuple]:
    plan = []
    for row in db.scalars(select(model)).all():
        current = getattr(row, "phone", None)
        fixed = phones.normalize(current)
        if fixed == (current or None):
            continue
        reason = ("قيمة نائبة اتشالت" if fixed is None and current
                  else "الصفر الأول رجع")
        plan.append((row, [("phone", fixed)], reason))
    return plan


def _plan_inspection(db) -> list[tuple]:
    plan = []
    for row in db.scalars(
            select(Inspection).where(Inspection.technician_phone.isnot(None))).all():
        fixed = phones.normalize(row.technician_phone)
        if fixed == (row.technician_phone or None):
            continue
        reason = ("قيمة نائبة اتشالت" if fixed is None else "الصفر الأول رجع")
        plan.append((row, [("technician_phone", fixed)], reason))
    return plan


def _describe(row) -> str:
    name = getattr(row, "name", None) or getattr(row, "owner_name", None) or ""
    code = getattr(row, "code", None) or getattr(row, "document_number", None) or f"#{row.id}"
    return f"{code:<16}{str(name)[:28]:<30}"


def run(*, execute: bool, only: str | None) -> None:
    db = SessionLocal()
    try:
        groups = {
            "owner": ("الملاك", lambda: _plan_owner(db)),
            "customer": ("العملاء (سباكين وتجار)", lambda: _plan_simple(db, Customer, "عميل")),
            "inspection": ("تليفون الفني في المعاينات", lambda: _plan_inspection(db)),
        }
        total = 0
        for key, (label, build) in groups.items():
            if only and only != key:
                continue
            plan = build()
            total += len(plan)
            print("=" * 74)
            print(f"{label}: {len(plan)} صف محتاج تصليح")
            print("=" * 74)
            reasons = Counter(r for _, _, r in plan)
            for reason, n in reasons.most_common():
                print(f"   {n:>6}  {reason}")
            for row, changes, reason in plan[:8]:
                shown = "، ".join(
                    f"{col}: {getattr(row, col)!r} → {val!r}" for col, val in changes)
                print(f"     {_describe(row)}{shown}")
            if len(plan) > 8:
                print(f"     … و{len(plan) - 8} غيرهم")
            if execute:
                for row, changes, _ in plan:
                    for col, val in changes:
                        setattr(row, col, val)
            print()

        if not execute:
            print(f"[عرض فقط] {total} صف هيتغيّر. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"✔ اتصلّح {total} صف.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    which = args[args.index("--only") + 1] if "--only" in args else None
    run(execute="--yes" in args, only=which)
