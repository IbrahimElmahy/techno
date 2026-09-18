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
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

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
    # نفس بضاعة الصرف متسجّلة باسمين: «تكنو وايت» القديم و«ابيض تكنوو» الجديد. ملف
    # العميل (`points.tsv`) بيسمّيهم «ابيض 114» و«ابيض 110» وبيديهم قيم الصرف، فالاتنين
    # عيلة واحدة — واللي مش متسجّل فيهم هو اللي سايب ٣٬٣٩٣ سطر بيع من غير نقط.
    "ابيض تكنوو": DRAIN,
    "ابيض تكنوو 110": DRAIN,
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
#
# و«١ ونص بوصة» بتتكتب بالوشين كمان: «ماسورة 1/2 1"بولى» و«ماسوره1"2/1». لازم تتقرا
# قبل الكسر لوحده، وإلا الـ١ بتتقرا بوصة واحدة (٣٢مم) والماسورة بتاخد نص نقط مقاسها.
_HALF = [
    (re.compile(r"(\d+)\s*[\"']?\s*2\s*/\s*1(?!\d)"), r" \1.5 "),
    (re.compile(r"1\s*/\s*2\s*[\"']?\s*(\d+)(?!\d)"), r" \1.5 "),
]
# **بس مش في الصرف.** «مشترك 3/4 عاده 110» يعني ٣ بوصة في ٤ بوصة، مش تلاتة ربع —
# القياس بالبوصة الصحيحة هناك والكسور مالهاش لازمة. أما «قفيز 3/4 بولى» فتلاتة ربع
# فعلاً. نفس الشرطة، معنيين، والفرق بيتقرر من العيلة.
_QUARTERS = [
    (re.compile(r"\b3\s*/\s*4\b|\b4\s*/\s*3\b"), " 0.75 "),
    (re.compile(r"\b1\s*/\s*2\b|\b2\s*/\s*1\b"), " 0.5 "),
]


def _numbers(text: str, *, quarters: bool = True) -> list[Decimal]:
    clean = text
    for pattern, repl in _HALF + (_QUARTERS if quarters else []):
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


def size_in(text: str, *, first: bool = False, quarters: bool = True) -> Decimal | None:
    """مقاس البوصة. الافتراضي أكبر مقاس («بوش 4×2 بوصة» ⇒ ٤).

    `first=True` بتاخد أول مقاس بدل أكبر واحد — ودي قراية ماسورة الصرف: «م 3"*4 110»
    تلات بوصة سُمك ٤، مش أربع بوصة. والملف بيأكّدها: المحطوط ٥ (تلات بوصة) مش ٩.

    `quarters=False` بتوقّف قراية «3/4» كتلاتة ربع — في الصرف الشرطة معناها «٣ في ٤».
    """
    hits = [n for n in _numbers(text, quarters=quarters) if n in IN_SIZES]
    if not hits:
        return None
    return hits[0] if first else max(hits)


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
# متر ماسورة بولى معزول — الجدول فيه ٢٥ و٣٢ بس. و٥٠ و٦٣ جايين من ملف نقاط البيع
# بتاع العميل نفسه (١٣ و١٦ للّفة ⇐ ٣٫٢٥ و٤ للمتر) — نفس قيمة غير المعزول بالظبط.
_PIPE_PPR_INS = {25: _d("1.5"), 32: _d("2"), 50: _d("3.25"), 63: _d("4")}
# محبس دفن — سطر ٥ (٢٠ و٢٥ بس)
_BURIED_VALVE = {20: _d("12"), 25: _d("12"),
                 # ٣٢ مش في الجدول، بس العميل حطّها بإيده على «محبس دفن 32 اقتصادى
                 # تكنو» بـ١٢ — نفس قيمة ٢٠ و٢٥.
                 32: _d("12")}
# محبس بلية — سطرين ٥ و٦ (٢٥ و٣٢ ⇐ ١٢، و٥٠ و٦٣ ⇐ ٢٠)؛ ٢٠ و٧٥ مش في الملف
_BALL_VALVE = {25: _d("12"), 32: _d("12"), 50: _d("20"), 63: _d("20")}
# قطعة صرف — سطور ١٢..١٥. **كسور مش أرقام عشرية:** الجدول مكتوب فيه ٠٫١٦٦٦٦٦…
# و٠٫٨٣٣٣٣…، وبيتخزّن ٣ خانات. لو ضربنا المخزّن في طول اللفة يطلع ٤٫٩٩٨ بدل ٥ —
# والعميل كاتب ٥ بالظبط. فالكسر بيتحفظ كسر، والتقريب بيحصل مرة واحدة في الآخر.
_DRAIN_PIECE = {_d("1"): Fraction(1, 6), _d("1.5"): Fraction(1, 6),
                _d("2"): Fraction(1, 3), _d("3"): Fraction(1, 3),
                _d("4"): Fraction(1), _d("6"): Fraction(2)}
# متر ماسورة صرف — سطور ٢٣..٢٨
_DRAIN_PIPE = {_d("1"): Fraction(1, 6), _d("1.5"): Fraction(1, 3), _d("2"): Fraction(2, 3),
               _d("3"): Fraction(5, 6), _d("4"): Fraction(3, 2), _d("6"): Fraction(13, 6)}
# قفيز — سطرين ٣٢ و٣٣
_QAFIZ = {_d("0.75"): _d("0.5"), _d("1"): _d("0.5"), _d("1.5"): _d("0.5"),
          _d("2"): _d("0.5"), _d("3"): _d("0.5"), _d("4"): _d("1"), _d("6"): _d("1")}


# طول اللفة اللي الماسورة بتتباع بيها. جدول العميل بالمتر، والفاتورة بتعدّ لفف —
# فنقط البيع = نقط المتر × الطول ده. مقاسها اتأكد من ملف نقاط البيع نفسه: ماسورة ٦٣
# بولى ١٦ نقطة (٤ × ٤)، وماسورة صرف ٦ بوصة ١٣ نقطة (١٣/٦ × ٦).
PIPE_LENGTH_M = {PPR: 4, PPR_INS: 4, PE: 4, DRAIN: 6}


# تلات خانات لأن `product_point_value.point_value` هو `Numeric(18,3)` — أي خانة زيادة
# هنا معناها إن اللي في الذاكرة مش اللي في القاعدة، والمقارنة بين الاتنين هتقول
# «مختلف» على فرق مش موجود أصلاً.
_QUANTUM = Decimal("0.001")


def _q(value) -> Decimal:
    """كسر أو رقم ⇐ Decimal بدقّة العمود — التقريب مرة واحدة بعد الضرب في الطول."""
    if isinstance(value, Fraction):
        value = Decimal(value.numerator) / Decimal(value.denominator)
    return Decimal(value).quantize(_QUANTUM, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Verdict:
    points: Decimal | None       # لكل قطعة أو متر — نفس وحدة جدول المعاينة
    rule: str                    # اسم القاعدة، أو سبب الرفض
    family: str
    # لكل وحدة بيع: القطعة زي ما هي، والماسورة مضروبة في طول اللفة. ده اللي بيتكتب في
    # `product_point_value` لأن الفاتورة بتعدّ لفف مش أمتار.
    sale_points: Decimal | None = None


_NOT_GOODS = re.compile(r"قلب محبس|مشتمل|كرتون|شيكاره|شحم|تفلون|حاجز|رول |لقمه|كارته")

# «م 50 ضغط 16 بارتكنو» ماسورة مختصرة لحرف واحد — من غير السطر ده بتتحسب قطعة لحام.
_PIPE_WORDS = re.compile(r"ماسور|مواسير|موسير|^م\s")

# «لاكور 25 بس داخلى» و«لاكور 32 سن خارجى» — النون ساقطة من «بسن» في الكتالوج.
# القيم المحطوطة قبل كده على الكروت دي (٢ و٤) هي قيم البسن، مش اللحام (٠.٥).
_THREADED_WORDS = re.compile(r"بسن|ب?س[نى]?\s*(داخل|خارج)|\bسن\s*(داخل|خارج)")


def _is_pipe(text: str) -> bool:
    return bool(_PIPE_WORDS.search(text))


def _ok(value, rule: str, fam: str, *, length: int = 1) -> Verdict:
    """حكم بقيمة. `length` طول اللفة لو الكارت ماسورة — غير كده القطعة زي ما هي."""
    return Verdict(_q(value), rule, fam, sale_points=_q(value * length))


def _no(rule: str, fam: str) -> Verdict:
    """مافيش قاعدة — مش صفر. الصفر قرار، وده سؤال."""
    return Verdict(None, rule, fam, sale_points=None)


def classify(name: str, category: str | None) -> Verdict:
    """قيمة النقطة للكارت ده حسب جدول العميل."""
    text = normalize(name)
    fam = family_of(category)

    # الكوبون نفسه كارت صنف في الكتالوج، ومتسجّل تحت «تكنو ثيرم» في تلات حالات.
    # لو عدّى على قاعدة اللحام هياخد نقط على نفسه — كوبون بيكسب كوبونات.
    if "كوبون" in text:
        return _ok(0, "كوبون — مش بضاعة تكسب نقط", fam)

    # قطع غيار وتعبئة متسجّلة جوّه تصنيفات البضاعة: «قلب محبس دفن ٢٥تكنو» فيه كلمة
    # «محبس دفن ٢٥» بالكامل، فلو عدّى بياخد ١٢ نقطة — تمن محبس كامل على سِنّة.
    if _NOT_GOODS.search(text):
        return _ok(0, "قطعة غيار أو تعبئة — مش صنف كامل", fam)

    # القفيز قبل العيلة: بيتكتب في «النواكل» و«تكنو ثيرم» وبرّه التصنيفين.
    if "قفيز" in text:
        inch = size_in(text)
        if inch is None and size_mm(text) in (20, 25):   # «قفيز 25» يعني ٢٥مم = ٣/٤ بوصة
            inch = Decimal("0.75")
        if inch is not None and inch in _QAFIZ:
            return _ok(_QAFIZ[inch], f"قفيز {inch}", fam)
        return _no("قفيز بمقاس مش في الجدول", fam)

    if fam == NONE:
        return _ok(0, "تصنيف مالوش نقط (هدايا/خامات/كوبونات/غراء)", fam)
    if fam == UNRATED:
        return _no("تصنيف مش موجود في جدول النقاط", fam)

    if fam == DRAIN:
        if "بلاعه" in text and "طبه" not in text:
            return _ok(1, "بلاعة", fam)
        pipe = _is_pipe(text)
        # الماسورة بتتكتب «مقاس × سُمك» فأول رقم هو المقاس: «م 3"*4 110» تلات بوصة
        # سُمك ٤، والعميل حاططها ٥ (تلات بوصة) مش ٩. لكن القطعة بتتكتب «مقاس × مقاس»
        # وبتتسعّر على الأكبر: «مشترك 2/4» و«بوش 3"×4"» عند العميل بنقطة — تمن الأربعة.
        inch = size_in(text, first=pipe, quarters=False)
        if inch is None:
            return _no("صرف من غير مقاس مقروء", fam)
        table, label = (_DRAIN_PIPE, "متر ماسورة صرف") if pipe else (_DRAIN_PIECE, "قطعة صرف")
        if inch in table:
            return _ok(table[inch], f"{label} {inch}", fam,
                       length=PIPE_LENGTH_M[DRAIN] if pipe else 1)
        return _no(f"صرف مقاس {inch} مش في الجدول", fam)

    # ── العائلات المليمترية: أخضر، معزول، بولى ايثيلين ──
    mm = size_mm(text)
    if mm is None:
        inch = size_in(text)
        if inch is not None and inch in _IN_TO_MM:   # بولى ايثيلين بيتكتب بالبوصة
            mm = _IN_TO_MM[inch]
    if mm is None:
        return _no("مقاس مش مقروء", fam)

    if "بطاري" in text:
        return _ok(10, "بطارية", fam)
    if "شيك بلف" in text:
        if mm in (25, 32):
            return _ok(10, f"شيك بلف {mm}", fam)
        return _no(f"شيك بلف {mm} مش في الجدول", fam)
    if "محبس" in text or "محيس" in text:   # «تى محيس دفن 25» غلطة كتابة في الكتالوج
        if "دفن" in text:
            if mm in _BURIED_VALVE:
                return _ok(_BURIED_VALVE[mm], f"محبس دفن {mm}", fam)
            return _no(f"محبس دفن {mm} مش في الجدول", fam)
        if "بليه" in text or "بلبه" in text or "لاكور" in text:
            if mm in _BALL_VALVE:
                return _ok(_BALL_VALVE[mm], f"محبس بلية {mm}", fam)
            return _no(f"محبس بلية {mm} مش في الجدول", fam)
        return _no("نوع محبس مش في الجدول", fam)

    if _is_pipe(text):
        table = _PIPE_PPR_INS if fam == PPR_INS else _PIPE_PPR
        kind = "معزول" if fam == PPR_INS else "بولى"
        if mm in table:
            return _ok(table[mm], f"متر ماسورة {kind} {mm}", fam, length=PIPE_LENGTH_M[fam])
        return _no(f"ماسورة {kind} {mm} مش في الجدول", fam)

    if _THREADED_WORDS.search(text):
        if mm in _THREADED:
            return _ok(_THREADED[mm], f"قطعة بسن {mm}", fam)
        return _no(f"بسن {mm} مش في الجدول", fam)

    if fam == PE:
        # وصلات البولى ايثيلين بالروس — لا لحام ولا بسن، ومش مكتوبة في جدول العميل.
        return _no("وصلة بولى ايثيلين — مش في الجدول", fam)

    if mm in _WELDED:
        return _ok(_WELDED[mm], f"قطعة لحام {mm}", fam)
    return _no(f"لحام {mm} مش في الجدول", fam)
