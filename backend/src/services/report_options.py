"""خيارات التقارير المالية — السلوك المشترك اللي بيخلّي التقارير تقرا نفس الدفتر.

أودو مابيبنيش كل تقرير بخياراته؛ فيه **خيارات واحدة** كل التقارير بتاخدها: الفترة،
والمقارنة، و«كل القيود ولا المرحّل بس»، والدفاتر. عشان كده لما تفتح قائمة الدخل
وتقارنها بالسنة اللي فاتت، تلاقي نفس الزرار في الميزانية وميزان المراجعة بنفس
المعنى بالظبط.

الملف ده هو الخيارات دي عندنا:

* **`posted_only`** — المرحّل بس (الافتراضي) ولا المسودة كمان. أودو بيسمّيها «All
  entries / Posted only». مهمة لأن المحاسب في آخر الشهر عايز يشوف أثر المسودات
  قبل ما يرحّلها؛ والافتراضي بيفضل المرحّل عشان الرقم اللي بيتطبع يبقى الحقيقة.
* **المقارنة** — نفس التقرير مرتين: الفترة دي، والفترة اللي قبلها أو نفس الفترة
  السنة اللي فاتت. الرقم لوحده مابيقولش «كويس ولا وحش»؛ اللي بيقول هو اللي جنبه.

**المقارنة بتتحسب هنا مش في كل تقرير.** «الفترة اللي قبلها» مش طرح شهر: فترة من
٠١/٠١ لـ٣١/٠٣ اللي قبلها من ٠١/١٠ لـ٣١/١٢ بطولها هي، والسنة اللي فاتت بتنقص سنة
على الطرفين. ولو التقرير على تاريخ واحد (الميزانية) المقارنة تاريخ واحد كمان.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

COMPARISON_NONE = "none"
COMPARISON_PREVIOUS = "previous"       # الفترة اللي قبلها بطولها
COMPARISON_LAST_YEAR = "last_year"     # نفس الفترة السنة اللي فاتت

COMPARISONS = (COMPARISON_NONE, COMPARISON_PREVIOUS, COMPARISON_LAST_YEAR)

COMPARISON_LABEL = {
    COMPARISON_PREVIOUS: "الفترة السابقة",
    COMPARISON_LAST_YEAR: "نفس الفترة العام الماضي",
}


@dataclass(frozen=True)
class ReportOptions:
    date_from: date | None = None
    date_to: date | None = None
    #: المرحّل بس — الافتراضي. `False` بيضم المسودة كمان (الملغي بيفضل بره دايماً).
    posted_only: bool = True
    comparison: str = COMPARISON_NONE

    @property
    def compares(self) -> bool:
        return self.comparison in (COMPARISON_PREVIOUS, COMPARISON_LAST_YEAR)


def _minus_year(day: date) -> date:
    """نفس اليوم السنة اللي فاتت — و٢٩ فبراير بيرجع ٢٨ بدل ما يرمي."""
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        return day.replace(year=day.year - 1, day=28)


def comparison_window(options: ReportOptions) -> tuple[date | None, date | None]:
    """فترة المقارنة — أو `(None, None)` لو مافيش مقارنة.

    «السابقة» بطول الفترة نفسها مش شهر ثابت: ربع سنة بيتقارن بربع سنة، وأسبوع
    بأسبوع. الطرح بالأيام هو اللي بيضمن ده من غير ما حد يحدد الطول.
    """
    if not options.compares:
        return None, None
    start, end = options.date_from, options.date_to
    if options.comparison == COMPARISON_LAST_YEAR:
        return (_minus_year(start) if start else None,
                _minus_year(end) if end else None)
    # previous
    if end is None:
        return None, None
    if start is None:
        # تقرير على تاريخ واحد (الميزانية): المقارنة اليوم اللي قبل بداية الفترة.
        return None, end - timedelta(days=1)
    span = (end - start).days
    prev_end = start - timedelta(days=1)
    return prev_end - timedelta(days=span), prev_end


def comparison_label(options: ReportOptions) -> str | None:
    if not options.compares:
        return None
    start, end = comparison_window(options)
    label = COMPARISON_LABEL.get(options.comparison, "")
    if end is None:
        return label
    span = f"{start:%Y-%m-%d} ← {end:%Y-%m-%d}" if start else f"حتى {end:%Y-%m-%d}"
    return f"{label} ({span})"
