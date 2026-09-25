"""فلتر «البيان» في التقارير — **مكان واحد** بيقرر بيتدوّر في إيه وإزاي.

«البيان» هو السطر الحر اللي المستخدم بيكتبه على المستند (`statement1..3`): «توريد مشروع
التجمع»، «بضاعة معرض»، «تسوية حساب». العميل عايز أي تقرير يتفلتر بيه، والتقارير كتير
ومحركاتها مختلفة (استعلام SQL في حتة، ولفّة بايثون على صفوف في حتة تانية). لو كل تقرير
كتب فلتره بنفسه كانوا هيختلفوا في أول تفصيلة: واحد بيفرّق بين «أ» و«ا» وواحد لأ، وواحد
بيدوّر في البيان الأول بس.

---------------------------------------------------------------------------
**العمود بيتعرف من اسمه، مش من قايمة مستندات.**

أي موديل عليه `statement1` / `statement2` / `statement3` بيدخل الفلتر لوحده. المستندات
اللي لسه مالهاش العمود (أمر التصنيع، إذن الهالك…) بتقول `supported() == False`، والشاشة
بتخفي الخانة بدل ما تعرض فلتر بيرجّع فاضي على طول. أول ما العمود يتضاف للموديل الفلتر
بيشتغل من غير ما حد يرجع هنا.

والمستند اللي البيان بتاعه اسمه تاني (الشيك: `description`) بيتبعت اسمه في `extra`.

**والمقارنة موحَّدة زي البحث** (`lib/arabic.py`): الهمزات والتاء المربوطة والألف المقصورة
والتشكيل والأرقام العربية — «فاتوره» بتلاقي «فاتورة»، و«٢» بتلاقي «2». جزء من الكلام في
أي خانة، يعني `ILIKE '%x%'` بعد التوحيد.

**وفي بايثون مش في SQL.** التقارير دي كلها بتلف على صفوفها في الذاكرة أصلاً (التجميع
والتواريخ بيتعملوا هناك)، والتوحيد في SQL محتاج `translate()` اللي مش موجودة على
قاعدة التطوير (MySQL) — فلتر بيشتغل على السيرفر وبيقع عند اللي بيجرّب محلي مش فلتر.
"""
from __future__ import annotations

from src.lib import arabic

# أسماء خانات البيان على المستندات. عمود جديد بالاسم ده بيدخل الفلتر من غير تعديل هنا.
STATEMENT_FIELDS = ("statement1", "statement2", "statement3")

# نفس الفاصل اللي الشاشات بتعرض بيه البيانات في سطر واحد (`utils/statements.ts`).
JOINER = " · "


def _norm(text: str | None) -> str:
    # المسافات المكررة بتتلم لمسافة واحدة — زي `normalizeAr` في الشاشة بالظبط، عشان
    # «توريد  مشروع» بمسافتين تلاقي «توريد مشروع».
    return " ".join(arabic.bare(text).split())


def needle(q: str | None) -> str:
    """الكلام المكتوب في الخانة بعد التوحيد — فاضي = مافيش فلتر."""
    return _norm(q) if q and q.strip() else ""


def _fields(extra: tuple[str, ...] = ()) -> tuple[str, ...]:
    return (*STATEMENT_FIELDS, *extra)


def supported(model, extra: tuple[str, ...] = ()) -> bool:
    """الموديل ده عليه خانة بيان أصلاً؟ — الشاشة بتسأل قبل ما تعرض الفلتر."""
    return any(hasattr(model, f) for f in _fields(extra))


def text_of(obj, extra: tuple[str, ...] = ()) -> str | None:
    """البيانات المليانة على المستند في سطر واحد — للعمود في التقرير.

    `None` لما مافيش ولا خانة مليانة، مش نص فاضي: العمود بيعرض «-» والفلتر بيستبعد.
    """
    if obj is None:
        return None
    parts = [str(v).strip() for f in _fields(extra)
             if (v := getattr(obj, f, None)) and str(v).strip()]
    return JOINER.join(parts) or None


def matches(text: str | None, wanted: str) -> bool:
    """النص ده فيه الكلام المطلوب؟ `wanted` جاي من `needle()` — موحَّد خلاص."""
    if not wanted:
        return True
    return bool(text) and wanted in _norm(text)


def matches_obj(obj, wanted: str, extra: tuple[str, ...] = ()) -> bool:
    return matches(text_of(obj, extra), wanted)
