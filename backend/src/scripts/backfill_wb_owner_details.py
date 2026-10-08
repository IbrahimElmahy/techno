from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.lib import phones
from src.models.owner import Owner
from src.scripts import _workbook

CODE_PREFIX = "WB-C-"


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحة «عملاء» الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        rows = [{k: (v or "").strip() for k, v in r.items()}
                for r in csv.DictReader(fh, delimiter="\t")]
    for col in ("phone2", "floor"):
        if rows and col not in rows[0]:
            raise SystemExit(
                f"عمود «{col}» مش في {path} — التصدير القديم مكنش بياخده. "
                "صدّر الصفحة من جديد بكل الأعمدة.")
    return rows


def _cut(v: str | None, n: int) -> str | None:
    v = (v or "").strip()
    return v[:n] if v else None


def run(folder: str, *, execute: bool, xlsx: str | None = None) -> None:
    rows = _workbook.owners(xlsx) if xlsx else _read(os.path.join(folder, "owners.tsv"))

    db = SessionLocal()
    try:
        by_code = {o.code: o for o in db.scalars(select(Owner)).all() if o.code}

        plan: list[tuple[Owner, str, object]] = []
        notes: Counter = Counter()

        for r in rows:
            rid = r.get("id", "")
            o = by_code.get(CODE_PREFIX + rid) if rid else None
            if o is None:
                notes["مالك مش عندنا — اتخطّى"] += 1
                continue

            nums: list[str] = []
            for k in ("phone1", "mobile", "phone2"):
                for x in phones.split_numbers(r.get(k)):
                    if x not in nums:
                        nums.append(x)

            current = phones.normalize(o.phone)
            if current is None and nums:
                plan.append((o, "phone", nums[0][:32]))
                second = next((x for x in nums[1:] if x != nums[0]), None)
            else:
                second = next((x for x in nums if x != current), None)
            if second and not phones.normalize(o.phone2):
                plan.append((o, "phone2", second[:32]))

            floor = _cut(r.get("floor"), 16)
            if floor and floor != "0" and not o.floor_number:
                plan.append((o, "floor_number", floor))

        print(f"صفوف الملف: {len(rows)}")
        for k, v in notes.most_common():
            print(f"   {k:<34}{v:>7}")
        for f, n in Counter(f for _, f, _ in plan).most_common():
            print(f"   {'هيتملى ' + f:<34}{n:>7}")
        if plan:
            print("\n   عيّنة:")
            for o, f, v in plan[:8]:
                print(f"      {o.code:<14}{o.name[:22]:<24}{f:<16}{v}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for o, field, val in plan:
            setattr(o, field, val)
        db.commit()

        q = select(func.count()).select_from(Owner)
        tot = db.scalar(q) or 0
        print(f"\n✔ اتملى {len(plan)} حقل")
        for col, lbl in ((Owner.phone, "تليفون"), (Owner.phone2, "تليفون ٢"),
                         (Owner.floor_number, "الدور"), (Owner.address, "عنوان")):
            print(f"   {lbl:<12}{db.scalar(q.where(col.is_not(None))) or 0:>6} من {tot}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    xlsx = args[args.index("--xlsx") + 1] if "--xlsx" in args else None
    run(folder, execute="--yes" in args, xlsx=xlsx)


if __name__ == "__main__":
    main()
