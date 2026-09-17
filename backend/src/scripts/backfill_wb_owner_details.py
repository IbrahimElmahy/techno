"""يكمّل بيانات الملّاك من ملف العميل: الرقم التاني والدور.

    python -m src.scripts.backfill_wb_owner_details --xlsx "C:/wb/عملاء.xlsx"        # يعرض بس
    python -m src.scripts.backfill_wb_owner_details --xlsx "C:/wb/عملاء.xlsx" --yes  # ينفّذ

`--dir` لسه شغّال للتصدير القديم (`owners.tsv`)، بس `--xlsx` بيقرا ملف العميل
زي ما هو من غير خطوة تصدير.

بيتعاد تشغيله بأمان: المطابقة بالكود، والخانة الملّانة مايتلمسش فيها.

---------------------------------------------------------------------------
⛔ **قاعدة `ERP` ممنوع لمسها** (شوف `CLAUDE.md`). المصدر صفحة «عملاء».

`import_wb_owners` أخد رقم واحد وعنوان وساب عمودين:

* **الرقم التاني.** الملف بيدّي `Phone1` و`Phone2` و`Mobile`، و**٧٬٨٠٥ من ٧٬٨٦٠
  عندهم رقمين مختلفين**. المستورد كان بياخد أول واحد يلاقيه. خدمة العملاء برقم
  واحد بتفضل ترنّ على نفس الرقم لو مردّش، والتاني مكتوب في الملف قدامها.

* **`Address2` هو الدور مش عنوان تاني.** قيمه «ارضي»، «أول علوي»، «الارضى» —
  ٧٬٨١١ صف. اسم العمود بيكدب، ومحتواه هو اللي بيحدد. الدور خانة قايمة بذاتها على
  المالك (`floor_number`) وبيتكتب في شهادة الضمان.

**والمحافظة والمركز مالهمش مصدر في الملف.** `RegionID` و`CityID` **صفر في ٩٩٪**
من الصفوف (٧٬٧٦٠ و٧٬٨٣٨ من ٧٬٨٦٠)، و`AddressID3` فيه ١٩ صف بس. اللي موجود فعلاً
هو `Address` وهو منقول خلاص في خانة العنوان. اختراع مركز من أول كلمة في العنوان
تخمين — «طرابمبا دمنهور» مركزها دمنهور بس «منشيه راغب دمنهور» كمان، والعكس مش
مضمون. فبتفضل فاضية لحد ما يجي مصدر.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
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
    # الملف نفسه لو اتقال، وإلا التصدير القديم. الخطوة اليدوية دي هي اللي كانت
    # بتتنسى — فالأرقام تفضل في الإكسل والكروت فاضية.
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

            # كل الأرقام في الصف، بترتيبها، من غير تكرار.
            nums: list[str] = []
            for k in ("phone1", "mobile", "phone2"):
                x = (r.get(k) or "").strip()
                if x and x not in nums:
                    nums.append(x)
            # الرقم اللي عندنا خلاص هو الأول؛ التاني هو أول رقم مختلف عنه.
            second = next((x for x in nums if x != (o.phone or "")), None)
            if o.phone is None and nums:
                plan.append((o, "phone", nums[0][:32]))
                second = next((x for x in nums[1:] if x != nums[0]), None)
            if second and not o.phone2:
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
