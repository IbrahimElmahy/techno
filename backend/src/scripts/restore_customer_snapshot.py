"""يرجّع حقول ربط العملاء لحالة لقطة اتاخدت قبل التعديل — نقطة رجوع، مش نسخة احتياطية.

    python -m src.scripts.restore_customer_snapshot --file C:/pgtmp/erp/wb/snap.tsv
    python -m src.scripts.restore_customer_snapshot --file C:/pgtmp/erp/wb/snap.tsv --yes

بيتعاد تشغيله بأمان: بيقارن الموجود باللقطة وبيكتب اللي اختلف بس.

---------------------------------------------------------------------------
**ليه موجود:** `fix_party_links` و`merge_duplicate_parties` بيعدّلوا ربط آلاف
الكروت في تشغيلة واحدة. القرار إننا نعيد البناء من الأول من ملف العميل بدل ما
نكمّل فوق شغل قديم محتاج طريق رجوع — وإلا كل تجربة بتبقى قرار مافيش منه رجعة.

**اللقطة أربع حقول بس، وده مقصود.** `customer_type` و`rep_id` و`service_rep_id`
و`active` — دول اللي السكربتين بيلمسوهم. مافيش مسح صفوف ولا رجوع مستندات، لأن
مافيش حاجة من دي اتعملت: الدمج نقل **صفر صف** (اتقاس جدول جدول قبل التنفيذ).

**بيمسح مراجع `customer_external_ref` اللي اتضافت بعد اللقطة** — بالتاريخ، مش
بالشكل. الـ٨٧١ مرجع القديم اتكتبوا قبل كده وبيفضلوا مكانهم، واللي الدمج ضافه
النهاردة بيتشال عشان الإعادة تبني من نظيف بدل ما تلاقي مفتاح موجود وتتخطّاه.

**اللي مابيرجعش:** `phone`. الدمج كان بيملاه على الكارت الباقي **لو كان فاضي**
بس، واللقطة مافيهاش عمود تليفون. رقم اتزاد على كارت ناقص مش ضرر، فالسكربت
بيقول ده صراحةً بدل ما يدّعي رجوع كامل.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.customer import Customer

# أعمدة اللقطة بالترتيب زي ما اتصدّرت.
(C_ID, C_CODE, C_NAME, C_TYPE, C_REP, C_REPNAME, C_SVC, C_BRANCH, C_ACTIVE) = range(9)


def _load(path: str) -> dict[int, list[str]]:
    """اللقطة: رقم الكارت → صفّه. الملف فيه قسمين، وبنقرا `#CUST` بس."""
    if not os.path.exists(path):
        raise SystemExit(f"مافيش ملف لقطة على {path}")
    out: dict[int, list[str]] = {}
    section = ""
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line.startswith("#"):
                section = line
                continue
            if section != "#CUST":
                continue
            parts = line.split("\t")
            if len(parts) < 9 or not parts[C_ID].isdigit():
                continue
            out[int(parts[C_ID])] = parts
    return out


def _i(v: str) -> int | None:
    v = (v or "").strip()
    return int(v) if v.isdigit() else None


def run(path: str, *, execute: bool) -> None:
    snap = _load(path)
    print(f"اللقطة: {len(snap)} كارت — {path}")

    db = SessionLocal()
    try:
        rows = db.scalars(select(Customer)).all()
        changes: list[tuple[Customer, str, object, object]] = []
        notes: Counter = Counter()

        for c in rows:
            s = snap.get(c.id)
            if s is None:
                notes["كارت عندنا مش في اللقطة (اتعمل بعدها) — اتساب"] += 1
                continue
            for field, want in (("customer_type", s[C_TYPE].strip() or None),
                                ("rep_id", _i(s[C_REP])),
                                ("service_rep_id", _i(s[C_SVC])),
                                ("active", s[C_ACTIVE].strip() == "True")):
                have = getattr(c, field)
                if field == "customer_type" and have is not None:
                    have = getattr(have, "value", have)
                if have != want:
                    changes.append((c, field, have, want))

        missing = len(snap) - sum(1 for c in rows if c.id in snap)
        if missing:
            notes["كارت في اللقطة ومش موجود دلوقتي"] = missing

        # المراجع اللي اتضافت بعد اللقطة — بالتاريخ.
        newer = db.execute(text(
            "SELECT count(*) FROM customer_external_ref"
            " WHERE created_at > (SELECT min(created_at) + interval '1 hour'"
            "                     FROM customer_external_ref)")).scalar() or 0

        by_field = Counter(f for _, f, _, _ in changes)
        print("\nالرجوع:")
        for f, n in by_field.most_common():
            print(f"   {f:<40}{n:>6}")
        print(f"   {'customer_external_ref هتتمسح':<40}{newer:>6}")
        print(f"   {'إجمالي':<40}{len(changes):>6}")
        for k, v in notes.most_common():
            print(f"\n   {k}: {v}")
        print("\n   ⚠ `phone` مابيرجعش — الدمج كان بيملاه لو فاضي بس، واللقطة مافيهاش العمود.")

        if changes:
            print("\n   عيّنة:")
            for c, f, have, want in changes[:8]:
                print(f"      #{c.id} {str(c.code):<16} {f:<16} {str(have):<10} → {want}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, field, _, want in changes:
            setattr(c, field, want)
        db.execute(text(
            "DELETE FROM customer_external_ref"
            " WHERE created_at > (SELECT min(created_at) + interval '1 hour'"
            "                     FROM customer_external_ref)"))
        db.commit()
        print(f"\nرجع: {len(changes)} حقل على "
              f"{len({c.id for c, *_ in changes})} كارت، و{newer} مرجع اتمسح.")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    path = "C:/pgtmp/erp/wb/snap.tsv"
    if "--file" in args:
        path = args[args.index("--file") + 1]
    run(path, execute="--yes" in args)


if __name__ == "__main__":
    main()
