"""يصلّح نوع المعاينة وحالتها ومحل الشراء على المعاينات المنقولة.

    python -m src.scripts.backfill_wb_visit_fields --dir C:/pgtmp/wb2          # يعرض بس
    python -m src.scripts.backfill_wb_visit_fields --dir C:/pgtmp/wb2 --yes    # ينفّذ

بيتعاد تشغيله بأمان: بيقرا الملف ويحطّ القيمة الصح، واللي مظبوط بيتخطّى.

---------------------------------------------------------------------------
⛔ **قاعدة `ERP` ممنوع لمسها** (شوف `CLAUDE.md`). المصدر صفحة «معاينات».

`import_wb_visits` نقل الـ١٠٬٧٩٦ معاينة **بقيم ثابتة** في تلات خانات، فطلعوا كلهم
نسخة واحدة: نوع «معاينة»، حالة «مقبولة». والملف فيه العمودين وماتقروش.

**نوع المعاينة = `IsMarma`.** المرمة تصليح لزيارة سابقة مش معاينة أولى —
**٣٬٧٥١ من ١٠٬٧٩٦ مرمة** (٣٥٪) وكلهم مسجّلين عندنا «معاينة». ده مش تفصيلة شكلية:
تقرير المعاينات بيعدّ المرمة زي المعاينة فالرقم بيتقري إن الشغل ٣٥٪ أكتر مما هو.

**الحالة = `VisitType`** (بقرار المستخدم). ١ مقبولة (١٠٬٥٦٧) و٠ مرفوضة (٢٢٩).
الصفوف اللي فيها صفر بتيجي ورا صف بنفس العميل ونفس اليوم وبرقم أكبر بواحد —
تصحيح لزيارة اتلغت، وده بالظبط معنى «مرفوضة» عندنا: بديل الحذف.

**ومحل الشراء بيتكمّل.** ٧١ معاينة اتعملت وكارت تاجرها ماكانش موجود لسه (٦٤ منهم
للمصنع) فطلعت بلا تاجر. `import_wb_traders` عمل الكروت، والتمريرة دي بتربطهم —
**بتملا الفاضي بس**، اللي عليه تاجر مايتغيّرش.

**`PreviewTypeID` و`PreviewDiscID` مابيتكتبوش.** أرقام (١/٢/٣ و١..٨) مالهاش قايمة
أسماء في أي صفحة في الملف، وكتابة الرقم في خانة اسمها «نوع المعاينة» بتخلّي
الشاشة تعرض «2» — أسوأ من فاضي لأنها بتبان كأنها معلومة.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.inspection import Inspection, InspectionStatus
from src.scripts.import_wb_traders import ALIAS

DOC_PREFIX = "WBV-"
TRADER_PREFIX = "WB-T-"

MARMA, PREVIEW = "مرمة", "معاينة"


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحة «معاينات» الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        rows = [{k: (v or "").strip() for k, v in r.items()}
                for r in csv.DictReader(fh, delimiter="\t")]
    for col in ("is_marma", "visit_kind"):
        if rows and col not in rows[0]:
            raise SystemExit(
                f"عمود «{col}» مش في {path} — التصدير القديم مكنش بياخده. "
                "صدّر الصفحة من جديد بكل الأعمدة.")
    return rows


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "visits.tsv"))

    db = SessionLocal()
    try:
        custs = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        by_doc = {n: i for n, i in db.execute(
            select(Inspection.document_number, Inspection.id)).all()}

        plan: list[tuple[int, str, object]] = []
        notes: Counter = Counter()

        for r in rows:
            vid = r.get("id", "")
            iid = by_doc.get(DOC_PREFIX + vid) if vid else None
            if iid is None:
                notes["معاينة مش عندنا — اتخطّت"] += 1
                continue
            insp = db.get(Inspection, iid)
            if insp is None:
                continue

            want_type = MARMA if r.get("is_marma") == "1" else PREVIEW
            if insp.visit_type != want_type:
                plan.append((iid, "visit_type", want_type))

            # `visit_kind` في الملف اسمه كده بس قيمته الحالة: ١ مقبولة و٠ مرفوضة.
            want_st = (InspectionStatus.accepted if r.get("visit_kind") != "0"
                       else InspectionStatus.rejected)
            if insp.status != want_st:
                plan.append((iid, "status", want_st))

            code = r.get("trader_a5", "")
            if code and insp.merchant_customer_id is None:
                # نفس ترتيب `import_wb_coupons`: كود a5، وإلا كارت «اضافه تجار»،
                # وإلا كارت موجود الكود بيتحوّل له (`1001355` = المصنع = `A5X1`).
                t = (custs.get(code) or custs.get(TRADER_PREFIX + code)
                     or custs.get(ALIAS.get(code, "")))
                if t is not None:
                    plan.append((iid, "merchant_customer_id", t.id))
                else:
                    notes["كود تاجر لسه مش عندنا"] += 1

        print(f"معاينات في الملف: {len(rows)}")
        for k, v in notes.most_common():
            print(f"   {k:<34}{v:>7}")
        per = Counter(f for _, f, _ in plan)
        for f, n in per.most_common():
            print(f"   {'هيتغيّر ' + f:<34}{n:>7}")
        marma = sum(1 for _, f, v in plan if f == "visit_type" and v == MARMA)
        rej = sum(1 for _, f, v in plan
                  if f == "status" and v == InspectionStatus.rejected)
        print(f"\n   {'منها هتبقى «مرمة»':<34}{marma:>7}")
        print(f"   {'منها هتبقى «مرفوضة»':<34}{rej:>7}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for iid, field, val in plan:
            setattr(db.get(Inspection, iid), field, val)
        db.commit()

        print(f"\n✔ اتغيّر {len(plan)} حقل")
        print("\n   النوع دلوقتي:")
        for v, n in db.execute(select(Inspection.visit_type, func.count())
                               .group_by(Inspection.visit_type)).all():
            print(f"      {str(v):<14}{n:>7}")
        print("   الحالة دلوقتي:")
        for v, n in db.execute(select(Inspection.status, func.count())
                               .group_by(Inspection.status)).all():
            print(f"      {str(getattr(v, 'value', v)):<14}{n:>7}")
        no_m = db.scalar(select(func.count()).select_from(Inspection)
                         .where(Inspection.merchant_customer_id.is_(None))) or 0
        print(f"   معاينات بلا محل شراء: {no_m}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
