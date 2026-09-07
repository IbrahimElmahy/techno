"""يكمّل بيانات السباكين من ملف العميل: تليفون ومحافظة ومركز ومنطقة.

    python -m src.scripts.backfill_wb_plumber_details --dir C:/pgtmp/wb2          # يعرض بس
    python -m src.scripts.backfill_wb_plumber_details --dir C:/pgtmp/wb2 --yes    # ينفّذ

بيتعاد تشغيله بأمان: المطابقة بالكود، والحقل اللي متملّي صح مايتلمسش.

---------------------------------------------------------------------------
⛔ **قاعدة `ERP` ممنوع لمسها** (شوف `CLAUDE.md`). المصدر صفحة «سباك».

`import_wb_plumbers` عمل الكروت بالاسم والتصنيف ومندوب الخدمة **وساب باقي
الأعمدة**، فالـ١٬٦٨٦ كارت طلعوا بصفر تليفون وصفر محافظة وصفر عنوان — والملف فيه
١٬٣٦١ تليفون و١٬٦٨٤ محافظة و١٬٦٨٥ مدينة ومنطقة. السباك اللي مالوش تليفون في نظام
خدمة عملاء مالوش لازمة.

**`gov` رقم بيطابق `governorate.id` عندنا مباشرةً** — اتقاس: ٣=المنوفية، ٤=البحيرة،
٥=الشرقية، ٧=الغربية، ٨=كفرالشيخ، وكلهم بيوافقوا مدنهم في العمود اللي جنبه
(٤ مع «المحمودية» و«دمنهور»، ٧ مع «كفر الزيات» و«طنطا»). الرقم اللي مش في الجدول
بيتساب وبيتقال.

**التليفون بيتخزّن زي ما هو من غير ما يتزوّد صفر.** الملف كاتب `1099286319` —
عشرة أرقام من غير الصفر البادئ (إكسل بيبلعه). زوّدنا الصفر معناه إننا نخترع رقم:
اللي في `Cust.ph3` بتاع a5 بيتكتب بنفس الشكل، والمقارنة بينهم لازم تفضل ممكنة.
الشكل بيتظبط في العرض مش في الداتا.

**`ph2`/`ph3` بيروحوا `contact` مش بيدوسوا على الأول** — ١١ و٣ صف بس فيهم قيمة،
بس الرقم التاني بتاع السباك مش نسخة من الأول.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.org import Governorate

CODE_PREFIX = "WB-P-"


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def _cut(v: str | None, n: int) -> str | None:
    v = (v or "").strip()
    return v[:n] if v else None


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "plumbers.tsv"))

    db = SessionLocal()
    try:
        govs = {g.id: g.name for g in db.scalars(select(Governorate)).all()}
        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}

        plan: list[tuple[Customer, str, object]] = []
        notes: Counter = Counter()
        bad_gov: Counter = Counter()

        for r in rows:
            if r.get("kind") != "سباك" or not r.get("code"):
                continue
            c = by_code.get(CODE_PREFIX + r["code"])
            if c is None:
                notes["كارت مش عندنا — اتخطّى"] += 1
                continue

            gov = r.get("gov", "")
            gid = int(gov) if gov.isdigit() and int(gov) in govs else None
            if gov and gid is None:
                bad_gov[gov] += 1

            city = _cut(r.get("city"), 120)
            area = _cut(r.get("area"), 240)
            # `المنطقة` بتساوي `المدينة` في أغلب الصفوف. تكرارها في خانة العنوان
            # بيملا الكارت بنفس الكلمة مرتين ومابيضيفش معلومة — فبتتكتب بس لما تفرق.
            for field, val in (
                # التليفون بيتحط بس لو الخانة فاضية — الموجود ممكن يكون اتصحّح بإيد.
                ("phone", _cut(r.get("phone"), 32)),
                ("governorate_id", gid),
                ("markaz", city),
                ("address", area if area and area != city else None),
            ):
                if val is None:
                    continue
                if getattr(c, field) in (None, "") and getattr(c, field) != val:
                    plan.append((c, field, val))

        print(f"صفوف السباكين: {sum(1 for r in rows if r.get('kind') == 'سباك')}")
        for k, v in notes.most_common():
            print(f"   {k:<34}{v:>6}")
        per_field = Counter(f for _, f, _ in plan)
        for f, n in per_field.most_common():
            print(f"   {'هيتملى ' + f:<34}{n:>6}")
        if bad_gov:
            print(f"\n⚠ أرقام محافظات مش في الجدول: {dict(bad_gov)}")
        if plan:
            print("\n   عيّنة:")
            for c, f, v in plan[:8]:
                print(f"      {c.code:<14}{c.name[:24]:<26}{f:<16}{v}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, field, val in plan:
            setattr(c, field, val)
        db.commit()

        q = select(func.count()).select_from(Customer).where(
            Customer.code.like(f"{CODE_PREFIX}%"))
        tot = db.scalar(q) or 0
        print(f"\n✔ اتملى {len(plan)} حقل")
        for col, lbl in ((Customer.phone, "تليفون"),
                         (Customer.governorate_id, "محافظة"),
                         (Customer.markaz, "مركز"),
                         (Customer.address, "منطقة")):
            print(f"   {lbl:<10}{db.scalar(q.where(col.is_not(None))) or 0:>6} من {tot}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
