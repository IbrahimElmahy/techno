"""خصم السطر على المستندات المنقولة من a5 — مستنتج من السطر نفسه. درايَ-رن بالافتراضي.

    python -m src.scripts.backfill_line_discounts
    python -m src.scripts.backfill_line_discounts --yes

---------------------------------------------------------------------------
**المشكلة.** `import_a5_docs` بيكتب السطر بسعر الوحدة الخام من a5 (`item_price`)
والإجمالي الصافي (`a_price`)، و`discount_pct = 0`. والخصم اللي بينهم — ١٠٪ في ٢٥٬٩٧١
سطر بيع، و٢٨٬٥٧٩ سطر عليه خصم إجمالاً — راح. فالسطر مابيضربش: الكمية × السعر ≠ الإجمالي،
والقاعدة اللي الموديل نفسه كاتبها على العمود (`line_total = quantity × unit_price ×
(1 − discount_pct/100)`) مكسورة على كل سطر منقول عليه خصم.

**الخصم مش محتاج a5 عشان يترجع.** الرقمين اللي بيعرّفوه متخزّنين عندنا خلاص: السعر
الخام والإجمالي الصافي. النسبة بينهم هي الخصم بالظبط. فمافيش تصدير ولا مطابقة سطر بسطر
ولا فرصة نربط سطر بسطر تاني — الحساب جوّه الصف الواحد.

**ولا مليم بيتغيّر.** `line_total` هو اللي a5 قاله وهو اللي الفاتورة اتجمعت عليه، فمابيتلمسش.
اللي بيتكتب هو `discount_pct` وبس.

⚠️ **والنتيجة إن السطر بيقرّب، مش بيضبط بالظبط.** العمود `Numeric(5,2)`، والخصم الحقيقي
ساعات بكسور أطول (١٤٫٤٣٧٥٪ = ١٠٪ وبعدها ٥٪). النسبة المقرّبة على منزلتين ممكن تخلّي
الضرب يفرق مليم أو اتنين عن الإجمالي المخزّن. البديل — إننا نعيد حساب `line_total` من
النسبة المقرّبة — بيخلّي السطر يضرب مظبوط بس بيغيّر فلوس فاتورة اتقفلت خلاص ويكسر
مجموع الرأس. الفلوس أهم من جمال المعادلة، فالتقريب في النسبة مش في المبلغ. والسكربت
بيعدّ الصفوف اللي فرقها أكبر من قرش ويقولها.

**والسطر اللي إحنا كتبناه مابيتلمسش**: بيتشاف بس لو `discount_pct` صفر/فاضي والضرب
مش ظابط — والسطر اللي اتكتب من الشاشة بيبقى ظابط أصلاً لأن الشاشة هي اللي حسبته.
"""
from __future__ import annotations

import sys
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.purchasing import PurchaseInvoiceLine, PurchaseReturnLine
from src.lib import discounts
from src.models.sales import SalesInvoiceLine, SalesReturnLine

ZERO = Decimal("0")
CENT = Decimal("0.01")
# فرق أقل من ده تقريب، مش خصم.
TOL = Decimal("0.005")

TARGETS = [
    (SalesInvoiceLine, "سطور فواتير البيع"),
    (SalesReturnLine, "سطور مردود المبيعات"),
    (PurchaseInvoiceLine, "سطور فواتير الشراء"),
    (PurchaseReturnLine, "سطور مردود المشتريات"),
]


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        grand = 0
        for cls, label in TARGETS:
            if not hasattr(cls, "discount_pct"):
                print(f"{label}: مافيش عمود خصم — اتخطّى")
                continue

            fixed = off_by_more_than_a_cent = negative = weird = 0
            worst = Decimal("0")
            for ln in db.scalars(select(cls)).all():
                have = Decimal(str(ln.discount_pct or 0))
                if have != ZERO:
                    continue  # سطر خصمه مكتوب خلاص — مش بتاعنا
                qty = Decimal(str(ln.quantity or 0))
                price = Decimal(str(ln.unit_price or 0))
                total = Decimal(str(ln.line_total or 0))
                gross = qty * price
                if gross <= ZERO:
                    continue
                gap = gross - total
                if abs(gap) <= TOL:
                    continue  # بيضرب مظبوط — مافيش خصم

                pct = discounts.implied_pct(gross, total)
                if pct < ZERO:
                    # الإجمالي أكبر من الكمية × السعر: زيادة مش خصم. مابنكتبش رقم
                    # سالب في خانة اسمها «خصم» — بيتقال وبس.
                    negative += 1
                    continue
                if pct >= Decimal("100"):
                    weird += 1
                    continue

                ln.discount_pct = pct
                fixed += 1
                # الفرق اللي فاضل بعد التقريب — الرقم اللي بيقول التقريب كلّفنا كام.
                left = abs(gross * (1 - pct / 100) - total)
                if left > CENT:
                    off_by_more_than_a_cent += 1
                worst = max(worst, left)

            grand += fixed
            print(f"\n{label}")
            print(f"   هيتكتب عليها خصم        {fixed}")
            if off_by_more_than_a_cent:
                print(f"   فرقها بعد التقريب > قرش {off_by_more_than_a_cent}"
                      f"   (أكبر فرق {worst})")
            if negative:
                print(f"   إجماليها أكبر من الخام  {negative}  ← مااتلمستش")
            if weird:
                print(f"   خصمها ١٠٠٪ أو أكتر      {weird}  ← مااتلمستش")

        if not execute:
            db.rollback()
            print(f"\nالإجمالي: {grand} سطر. درايَ-رن — `--yes` عشان ينفّذ.")
            return 0
        db.commit()
        print(f"\nاتكتب: {grand} سطر.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
