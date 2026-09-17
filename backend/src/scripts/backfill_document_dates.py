"""تاريخ المستند الفاضي — بيترجع من `created_at`. درايَ-رن بالافتراضي.

    python -m src.scripts.backfill_document_dates
    python -m src.scripts.backfill_document_dates --out C:/pgtmp/report.txt
    python -m src.scripts.backfill_document_dates --yes

---------------------------------------------------------------------------
**المشكلة.** تاريخ المستند عندنا حقل بيبعته العميل — والتطبيق مابعتوش خالص. فالإذن
بينزل بـ`transfer_date = NULL`، والنتيجة إنه **بيختفي**: أي كشف بيفلتر بمدى تاريخ
بيرميه برّه المدى، والورقة بتتطبع وخانة التاريخ فاضية. مستند موجود في القاعدة ومش
موجود في أي شاشة.

اتقاس على قاعدة الإنتاج: **٥ من ٩** أذون تحويل مكتوبة عندنا تاريخها فاضي —
`TRF-000001`, `TRF-000002`, `TRF-000005`, `TRF-000006`, `TRF-000007`. وباقي
المستندات (بيع، مردود بيع، شرا، مردود شرا، أذون المخزن) اتفحصت هي كمان لأن الحقل
`nullable=True` في كلها والسبب نفسه ممكن يكون حصل — العدد بيتطبع جدول جدول.

**والسبب اتقفل قدّام.** `transfer_service.initiate()` بقى بيحط
`transfer_date or clock.today()`، فالإذن الجديد عمره مانزل من غير تاريخ تاني. اللي
فاضل هو الصفوف القديمة، والإصلاح مابيلمسهاش بأثر رجعي — ده شغل السكربت ده.

**ليه `created_at` هو الجواب الصح — لمستنداتنا إحنا وبس.** `created_at` هو لحظة ما
الصف اتكتب. والمستند اللي إحنا عملناه بيتكتب ساعة ما بيحصل أو بعده بشوية، فيومه هو
يوم الحركة. لكن المستند المنقول من a5 حامل **تاريخ العميل** — يوم الحركة عنده هو،
واللي ممكن يكون من شهور، و`created_at` بتاعه هو يوم النقل. فالكتابة عليه بـ
`created_at` هتحرّك مستند من تاريخه الحقيقي لتاريخ الاستيراد وتخرّب كل تقرير.

عشان كده **الشرط الوحيد هو `IS NULL`**: الصف اللي تاريخه مكتوب مابيتلمسش مهما كان،
ومستندات a5 كلها تاريخها مكتوب — النقل بيحط تاريخ a5 على المستند. يعني السكربت
مابيحتاجش يعرف مين كتب المستند عشان يبقى آمن، الخانة الفاضية نفسها هي التفرقة.

**واليوم بيتحسب بتوقيت الشغل مش بتوقيت السيرفر.** `created_at` متخزّن UTC، والمكتب
UTC+2/+3. فالمستند اللي اتكتب ١١ بالليل بيبقى مختوم اليوم اللي فات، و`date(created_at)`
الخام هتقيّده على يوم غلط. الحساب هنا بيعدّي على نفس إزاحة `clock` اللي الخدمة الحيّة
بتستعمل في `clock.today()` — عشان الصف القديم والصف الجديد يتقيّدوا بنفس القاعدة.

⚠️ **حدود الأمانة: ساعة السيرفر كانت متأخرة ٤ أيام لحد النهارده ١٤:٢٩.** يعني قيم
`created_at` اللي واقعة في نافذة **٢٠٢٦-٠٩-١٢ .. ٢٠٢٦-٠٩-١٦** مكتوبة بساعة غلط
أصلاً، والتاريخ اللي هيتحط منها ممكن يكون متأخر عن الحقيقة بأربع أيام. مافيش مصدر
تاني نصحّح منه — الصف مالوش ختم تاني — فالسكربت **مابيخمّنش** ومابيضيفش الأربع أيام:
بيعلّم الصف بـ«⚠ نافذة الساعة» في التقرير وسايب القرار للي بيقرا. تاريخ تقريبي أحسن
من خانة فاضية بتخفي المستند، بس المفروض حد يعرف إنه تقريبي.

⚠️ **والكتابة مالهاش رجوع تلقائي.** الخانة كانت فاضية، فمافيش قيمة قديمة تترجّع من
القاعدة لو الرقم طلع غلط. عشان كده درايَ-رن بالافتراضي، والصفوف بتتطبع بالرقم والقديم
والجديد قبل أي كتابة.
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta

from sqlalchemy import select

from src.core import clock
from src.core.db import SessionLocal
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.stock_permit import StockPermit
from src.models.transfer import StockTransfer

# (الموديل، اسم عمود التاريخ، الاسم اللي بيتقرا في التقرير)
TARGETS = [
    (SalesInvoice, "invoice_date", "فواتير البيع"),
    (SalesReturn, "return_date", "مردود المبيعات"),
    (PurchaseInvoice, "purchase_date", "فواتير الشراء"),
    (PurchaseReturn, "return_date", "مردود المشتريات"),
    (StockPermit, "permit_date", "أذون المخزن"),
    (StockTransfer, "transfer_date", "أذون التحويل"),
]

# النافذة اللي ساعة السيرفر كانت فيها متأخرة ٤ أيام — بتتعلّم في التقرير وبس.
SUSPECT_FROM = date(2026, 9, 12)
SUSPECT_TO = date(2026, 9, 16)


def _business_day(ts: datetime) -> date:
    """الختم UTC واليوم اللي بيتقيّد عليه المستند يوم المكتب — نفس إزاحة `clock.today()`."""
    return (ts + timedelta(hours=clock.business_utc_offset_hours())).date()


def run(*, execute: bool, out_path: str | None) -> int:
    lines: list[str] = []

    def say(text: str = "") -> None:
        lines.append(text)
        # الكونسول بتاع ويندوز بيكسّر العربي على stdout — الملف هو النسخة اللي بتتقرا.
        try:
            print(text)
        except UnicodeEncodeError:
            print(text.encode("ascii", "replace").decode("ascii"))

    db = SessionLocal()
    try:
        say(f"تاريخ اليوم بتوقيت الشغل: {clock.today()}")
        say("")

        grand = grand_suspect = 0
        touched: list[tuple[object, str]] = []

        for cls, col, label in TARGETS:
            total = len(db.scalars(select(cls.id)).all())
            rows = db.scalars(select(cls).where(getattr(cls, col).is_(None))).all()

            say(f"{label}  ({cls.__tablename__}.{col})")
            say(f"   إجمالي الصفوف   {total}")
            say(f"   تاريخها فاضي    {len(rows)}")
            if not rows:
                say("   ← مافيش حاجة تتعمل")
                say("")
                continue

            no_stamp = 0
            for r in sorted(rows, key=lambda x: x.id):
                stamp = getattr(r, "created_at", None)
                num = getattr(r, "document_number", None) or f"#{r.id}"
                if stamp is None:
                    # مالوش ختم كتابة كمان — مافيش من فين نجيب تاريخ. بيتقال ومابيتلمسش.
                    no_stamp += 1
                    say(f"   {num:<16} created_at فاضي  ← مااتلمسش")
                    continue
                new = _business_day(stamp)
                flag = ""
                if SUSPECT_FROM <= new <= SUSPECT_TO:
                    flag = "   ⚠ نافذة الساعة المتأخرة (ممكن يكون أقدم بـ٤ أيام)"
                    grand_suspect += 1
                say(f"   {num:<16} (فاضي) → {new}   من created_at={stamp}{flag}")
                touched.append((r, col))

            if no_stamp:
                say(f"   صفوف من غير created_at: {no_stamp} ← مااتلمستش")
            say("")

        grand = len(touched)
        say(f"الإجمالي: {grand} صف هيتكتب عليه تاريخ"
            f"   منهم {grand_suspect} في نافذة الساعة المتأخرة")
        say("والصفوف اللي تاريخها مكتوب — ومنها كل المنقول من a5 — مااتلمستش أصلاً.")

        if not execute:
            db.rollback()
            say("")
            say("درايَ-رن. `--yes` عشان ينفّذ — **والخانة كانت فاضية فمافيش رجوع**.")
            return 0

        for row, col in touched:
            setattr(row, col, _business_day(row.created_at))
        db.commit()
        say("")
        say(f"اتكتب: {grand} صف.")
        return 0
    finally:
        db.close()
        if out_path:
            os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
            with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    argv = sys.argv[1:]
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    sys.exit(run(execute="--yes" in argv, out_path=out))
