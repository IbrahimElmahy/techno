"""قيمة النقطة لكل صنف — مشتقّة من جدول العميل مش مكتوبة صنف صنف.

ملف العميل («حساب نقاط») مافيهوش أسماء أصناف أصلاً: فيه **٣٢ قاعدة** مكتوبة
بالوصف — «قطعه بسن ٢٠" او ٢٥"» ⇐ نقطتين، «متر ماسوره ٦٣" بولى» ⇐ ٤ نقط. والكتالوج
عنده ٥٦١ كارت. فالمطابقة بالاسم (زي `seed_item_points`) مابتشتغلش هنا: مافيش كارت
اسمه «قطعه بسن ٣٢"».

فالحل إن كل كارت يتفكّ لتلات حاجات — **العيلة** (أخضر/معزول/بولى ايثيلين/صرف/قفيز)،
و**النوع** (بسن · لحام · محبس · ماسورة · بلاعة)، و**المقاس** — والتلاتة دول بيدوروا
على القاعدة في الجدول.

**اللي مش داخل في قاعدة بيرجع `None`، مابياخدش صفر.** الفرق مش شكلي: صفر معناه
«الصنف ده مالوش نقط» وده قرار، و`None` معناه «مالقيتش له قاعدة» وده سؤال للعميل.
الكارت اللي يرجع `None` بيتعرض في تقرير السكربت ومابيتكتبش في القاعدة.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal

# ── تطبيع الاسم ───────────────────────────────────────────────────────────────
_MARKS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_FOLD = {
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ى": "ي", "ی": "ي",
    "ة": "ه",
    "ک": "ك",
}


def normalize(name: str) -> str:
    text = unicodedata.normalize("NFKC", str(name or ""))
    text = _MARKS.sub("", text)
    for src, dst in _FOLD.items():
        text = text.replace(src, dst)
    text = text.replace("٫", ".")
    for i, digit in enumerate("٠١٢٣٤٥٦٧٨٩"):
        text = text.replace(digit, str(i))
    return re.sub(r"\s+", " ", text).strip().lower()


# ── العيلة ───────────────────────────────────────────────────────────────────
PPR = "ppr"              # تكنو ثيرم — أخضر لحام
PPR_INS = "ppr_ins"      # تكنو ثيرم معزول
PE = "pe"                # بولى ايثيلين
DRAIN = "drain"          # صرف: تكنو وايت + تكنو جوان
QAFIZ = "qafiz"          # النواكل (قفيز)
NONE = "none"            # هدايا/خامات/كوبونات/غراء/عامة — مالهاش نقط عن قصد
UNRATED = "unrated"      # رمادى ومواسير العلياء — مش في جدول العميل

_FAMILY_BY_CATEGORY = {
    "تكنو ثيرم": PPR,
    "تكنو ثيرم معزول": PPR_INS,
    "بولى ايثليين": PE,
    "بولى ايثيلين": PE,
    "تكنو وايت": DRAIN,
    "تكنو وايت 114": DRAIN,
    "تكنو جوان": DRAIN,
    # «النواكل» في الكتالوج الحالي أدوات صحية (حوض · خلاط · شطافة · طقم دش) مش قفيز —
    # القفيز جواها بيتمسك بالاسم فوق قبل ما العيلة تتقرر أصلاً.
    "النواكل": UNRATED,
    "رمادي": UNRATED,
    "مواسير العلياء": UNRATED,
    "هدايا وعروض": NONE,
    "خامات": NONE,
    "كوبونات": NONE,
    "تكنو غرا": NONE,
    "@@فئه عامه": NONE,
    "فئه عامه": NONE,
}


# المفاتيح فوق مكتوبة بإيد، والبحث بيتم على الاسم بعد التطبيع — فلازم يتطبّعوا هما كمان.
# من غير السطر ده «بولى ايثيلين» (بـى) مابيقابلش نفسه بعد ما الـى تبقى ي، والتصنيف
# بيقع في `UNRATED` وهو معروف. نفس المصيدة اللي التطبيع نفسه اتكتب عشانها.
_FAMILY_BY_CATEGORY = {normalize(k): v for k, v in _FAMILY_BY_CATEGORY.items()}


def family_of(category: str | None) -> str:
    """العيلة من تصنيف الكارت. التصنيف المجهول بيرجع `UNRATED` مش تخمين."""
    return _FAMILY_BY_CATEGORY.get(normalize(category or ""), UNRATED)


# ── المقاس ───────────────────────────────────────────────────────────────────
# اللي بيتشال قبل قراية الأرقام: الضغط، سُمك الحيطة، وكود السلسلة «.. 114».
# من غيره «ماسوره 1.5"×4مم» بتطلع مقاس ٤ بوصة بدل ١.٥ — والفرق في النقط تسعة أضعاف.
_NOISE = [
    re.compile(r"ضغط\s*\d+(\.\d+)?\s*(بار)?"),
    re.compile(r"\d+(\.\d+)?\s*بار"),
    re.compile(r"\bp\s*n\s*\d+"),
    re.compile(r"\bبن\s*\d+"),
    re.compile(r"[×x*]\s*\d+(\.\d+)?\s*مم"),      # سُمك الحيطة
    re.compile(r"\d+(\.\d+)?\s*سم"),                   # طول البيبة
    re.compile(r"\.\.+\s*\d+"),                        # «.. 114»
    re.compile(r"\d+\s*وات"),
    re.compile(r"\b2022\b"),
]

# ٤٠ مش في جدول العميل، بس الكتالوج فيه سبع كروت بالمقاس ده. بنعرفه عشان يطلع في
# التقرير باسمه («٤٠ مش في الجدول») بدل ما يتلمّ مع «مقاس مش مقروء».
MM_SIZES = [20, 25, 32, 40, 50, 63, 75, 90, 110]
IN_SIZES = [Decimal("0.5"), Decimal("0.75"), Decimal("1"), Decimal("1.5"), Decimal("2"),
            Decimal("3"), Decimal("4"), Decimal("6")]

# البوصة ↔ المليمتر زي ما الجدول نفسه كاتبها: «متر ماسوره 20" بولى 1/2 بوصه».
_IN_TO_MM = {Decimal("0.5"): 20, Decimal("0.75"): 25, Decimal("1"): 32,
             Decimal("1.5"): 50, Decimal("2"): 63}


# الكسر بيتكتب بالوشين: «3/4» و«4/3» — والاتنين يقصدوا تلاتة ربع. لو سبناه أرقام
# منفصلة، «كوع 1"*4/3 بسن داخلى» بتطلع مقاس ٤ بوصة بدل ٣/٤.
_FRACTIONS = [
    (re.compile(r"\b3\s*/\s*4\b|\b4\s*/\s*3\b"), " 0.75 "),
    (re.compile(r"\b1\s*/\s*2\b|\b2\s*/\s*1\b"), " 0.5 "),
]


def _numbers(text: str) -> list[Decimal]:
    clean = text
    for pattern, repl in _FRACTIONS:
        clean = pattern.sub(repl, clean)
    for pattern in _NOISE:
        clean = pattern.sub(" ", clean)
    out: list[Decimal] = []
    for raw in re.findall(r"\d+(?:\.\d+)?", clean):
        try:
            out.append(Decimal(raw))
        except Exception:  # noqa: BLE001 — رقم مش مقروء يتجاهل
            continue
    return out


def size_mm(text: str) -> int | None:
    """أكبر مقاس مليمتر معروف في الاسم. «مسلوب لحام 50×32» ⇒ ٥٠."""
    hits = [int(n) for n in _numbers(text) if int(n) == n and int(n) in MM_SIZES]
    return max(hits) if hits else None


def size_in(text: str) -> Decimal | None:
    """أكبر مقاس بوصة معروف. «بوش 4×2 بوصة» ⇒ ٤."""
    hits = [n for n in _numbers(text) if n in IN_SIZES]
    return max(hits) if hits else None


# ── الجدول ───────────────────────────────────────────────────────────────────
def _d(value: str) -> Decimal:
    return Decimal(value)


# قطعة بسن (أخضر أو معزول) — سطور ١ و٢ و٣ و٣٠ في الملف
_THREADED = {20: _d("2"), 25: _d("2"), 32: _d("4"), 50: _d("10"), 63: _d("10"),
             75: _d("6"), 90: _d("6"), 110: _d("6")}
# قطعة لحام — سطور ٧ و٨ و٩ و٢٩
_WELDED = {20: _d("0.25"), 25: _d("0.5"), 32: _d("0.5"), 50: _d("2"), 63: _d("2"),
           75: _d("3"), 90: _d("3"), 110: _d("3")}
# متر ماسورة بولى — سطور ١٦..٢٠ و٣١
_PIPE_PPR = {20: _d("0.5"), 25: _d("1"), 32: _d("1.5"), 50: _d("3.25"), 63: _d("4"),
             75: _d("4.75"), 90: _d("4.75"), 110: _d("4.75")}
# متر ماسورة بولى معزول — سطرين ٢١ و٢٢ بس؛ الملف مافيهوش ٥٠ ولا ٦٣ معزول
_PIPE_PPR_INS = {25: _d("1.5"), 32: _d("2")}
# محبس دفن — سطر ٥ (٢٠ و٢٥ بس)
_BURIED_VALVE = {20: _d("12"), 25: _d("12")}
# محبس بلية — سطرين ٥ و٦ (٢٥ و٣٢ ⇐ ١٢، و٥٠ و٦٣ ⇐ ٢٠)؛ ٢٠ و٧٥ مش في الملف
_BALL_VALVE = {25: _d("12"), 32: _d("12"), 50: _d("20"), 63: _d("20")}
# قطعة صرف — سطور ١٢..١٥
_DRAIN_PIECE = {_d("1"): _d("0.167"), _d("1.5"): _d("0.167"),
                _d("2"): _d("0.333"), _d("3"): _d("0.333"),
                _d("4"): _d("1"), _d("6"): _d("2")}
# متر ماسورة صرف — سطور ٢٣..٢٨
_DRAIN_PIPE = {_d("1"): _d("0.167"), _d("1.5"): _d("0.333"), _d("2"): _d("0.667"),
               _d("3"): _d("0.833"), _d("4"): _d("1.5"), _d("6"): _d("2.167")}
# قفيز — سطرين ٣٢ و٣٣
_QAFIZ = {_d("0.75"): _d("0.5"), _d("1"): _d("0.5"), _d("1.5"): _d("0.5"),
          _d("2"): _d("0.5"), _d("3"): _d("0.5"), _d("4"): _d("1"), _d("6"): _d("1")}


@dataclass(frozen=True)
class Verdict:
    points: Decimal | None   # None = مالهاش قاعدة في جدول العميل
    rule: str                # اسم القاعدة، أو سبب الرفض
    family: str


_NOT_GOODS = re.compile(r"قلب محبس|مشتمل|كرتون|شيكاره|شحم|تفلون|حاجز|رول |لقمه|كارته")

# «م 50 ضغط 16 بارتكنو» ماسورة مختصرة لحرف واحد — من غير السطر ده بتتحسب قطعة لحام.
_PIPE_WORDS = re.compile(r"ماسور|مواسير|موسير|^م\s")

# «لاكور 25 بس داخلى» و«لاكور 32 سن خارجى» — النون ساقطة من «بسن» في الكتالوج.
# القيم المحطوطة قبل كده على الكروت دي (٢ و٤) هي قيم البسن، مش اللحام (٠.٥).
_THREADED_WORDS = re.compile(r"بسن|ب?س[نى]?\s*(داخل|خارج)|\bسن\s*(داخل|خارج)")


def _is_pipe(text: str) -> bool:
    return bool(_PIPE_WORDS.search(text))


def classify(name: str, category: str | None) -> Verdict:
    """قيمة النقطة للكارت ده حسب جدول العميل."""
    text = normalize(name)
    fam = family_of(category)

    # الكوبون نفسه كارت صنف في الكتالوج، ومتسجّل تحت «تكنو ثيرم» في تلات حالات.
    # لو عدّى على قاعدة اللحام هياخد نقط على نفسه — كوبون بيكسب كوبونات.
    if "كوبون" in text:
        return Verdict(Decimal("0"), "كوبون — مش بضاعة تكسب نقط", fam)

    # قطع غيار وتعبئة متسجّلة جوّه تصنيفات البضاعة: «قلب محبس دفن ٢٥تكنو» فيه كلمة
    # «محبس دفن ٢٥» بالكامل، فلو عدّى بياخد ١٢ نقطة — تمن محبس كامل على سِنّة.
    if _NOT_GOODS.search(text):
        return Verdict(Decimal("0"), "قطعة غيار أو تعبئة — مش صنف كامل", fam)

    # القفيز قبل العيلة: بيتكتب في «النواكل» و«تكنو ثيرم» وبرّه التصنيفين.
    if "قفيز" in text:
        inch = size_in(text)
        if inch is None and size_mm(text) in (20, 25):   # «قفيز 25» يعني ٢٥مم = ٣/٤ بوصة
            inch = Decimal("0.75")
        if inch is not None and inch in _QAFIZ:
            return Verdict(_QAFIZ[inch], f"قفيز {inch}", fam)
        return Verdict(None, "قفيز بمقاس مش في الجدول", fam)

    if fam == NONE:
        return Verdict(Decimal("0"), "تصنيف مالوش نقط (هدايا/خامات/كوبونات/غراء)", fam)
    if fam == UNRATED:
        return Verdict(None, "تصنيف مش موجود في جدول النقاط", fam)

    if fam == DRAIN:
        if "بلاعه" in text and "طبه" not in text:
            return Verdict(_d("1"), "بلاعة", fam)
        inch = size_in(text)
        if inch is None:
            return Verdict(None, "صرف من غير مقاس مقروء", fam)
        table, label = (_DRAIN_PIPE, "متر ماسورة صرف") if _is_pipe(text) else (
            _DRAIN_PIECE, "قطعة صرف")
        if inch in table:
            return Verdict(table[inch], f"{label} {inch}", fam)
        return Verdict(None, f"صرف مقاس {inch} مش في الجدول", fam)

    # ── العائلات المليمترية: أخضر، معزول، بولى ايثيلين ──
    mm = size_mm(text)
    if mm is None:
        inch = size_in(text)
        if inch is not None and inch in _IN_TO_MM:   # بولى ايثيلين بيتكتب بالبوصة
            mm = _IN_TO_MM[inch]
    if mm is None:
        return Verdict(None, "مقاس مش مقروء", fam)

    if "بطاري" in text:
        return Verdict(_d("10"), "بطارية", fam)
    if "شيك بلف" in text:
        if mm in (25, 32):
            return Verdict(_d("10"), f"شيك بلف {mm}", fam)
        return Verdict(None, f"شيك بلف {mm} مش في الجدول", fam)
    if "محبس" in text or "محيس" in text:   # «تى محيس دفن 25» غلطة كتابة في الكتالوج
        if "دفن" in text:
            if mm in _BURIED_VALVE:
                return Verdict(_BURIED_VALVE[mm], f"محبس دفن {mm}", fam)
            return Verdict(None, f"محبس دفن {mm} مش في الجدول", fam)
        if "بليه" in text or "بلبه" in text:
            if mm in _BALL_VALVE:
                return Verdict(_BALL_VALVE[mm], f"محبس بلية {mm}", fam)
            return Verdict(None, f"محبس بلية {mm} مش في الجدول", fam)
        return Verdict(None, "نوع محبس مش في الجدول", fam)

    if _is_pipe(text):
        table = _PIPE_PPR_INS if fam == PPR_INS else _PIPE_PPR
        if mm in table:
            return Verdict(table[mm], f"متر ماسورة {'معزول' if fam == PPR_INS else 'بولى'} {mm}", fam)
        return Verdict(None, f"ماسورة {'معزول ' if fam == PPR_INS else ''}{mm} مش في الجدول", fam)

    if _THREADED_WORDS.search(text):
        if mm in _THREADED:
            return Verdict(_THREADED[mm], f"قطعة بسن {mm}", fam)
        return Verdict(None, f"بسن {mm} مش في الجدول", fam)

    if fam == PE:
        # وصلات البولى ايثيلين بالروس — لا لحام ولا بسن، ومش مكتوبة في جدول العميل.
        return Verdict(None, "وصلة بولى ايثيلين — مش في الجدول", fam)

    if mm in _WELDED:
        return Verdict(_WELDED[mm], f"قطعة لحام {mm}", fam)
    return Verdict(None, f"لحام {mm} مش في الجدول", fam)
