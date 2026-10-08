from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

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


PPR = "ppr"
PPR_INS = "ppr_ins"
PE = "pe"
DRAIN = "drain"
QAFIZ = "qafiz"
NONE = "none"
UNRATED = "unrated"

_FAMILY_BY_CATEGORY = {
    "تكنو ثيرم": PPR,
    "تكنو ثيرم معزول": PPR_INS,
    "تكنو وايت": DRAIN,
    "تكنو وايت 114": DRAIN,
    "ابيض تكنوو": DRAIN,
    "ابيض تكنوو 110": DRAIN,
    "تكنو جوان": DRAIN,
    "رمادي": NONE,
    "مواسير العلياء": NONE,
    "هدايا وعروض": NONE,
    "خامات": NONE,
    "كوبونات": NONE,
    "تكنو غرا": NONE,
    "@@فئه عامه": NONE,
    "فئه عامه": NONE,
    "ميتي": NONE, "الامل الشريف": NONE, "بولي الامل الشريف": NONE,
    "النيل ثيرم": NONE, "ابيض النيل": NONE,
    "جي ام ابيض": NONE, "جي ام بولي": NONE,
    "ديمكوو": NONE, "اكواتيك": NONE, "رمادي اكواتك": NONE,
    "ابيضmmp": NONE, "رمادي mmp": NONE,
    "الوطنيه الالمانيه": NONE, "الزهراء": NONE, "السادات ثيرم": NONE,
    "انفت": NONE, "br": NONE, "مكه": NONE,
    "الاستثماري الابيض": NONE, "استثماري بولي": NONE, "مواسيراستثماري": NONE,
    "الرمادي": NONE, "مواسيررمادي": NONE,
    "بولي ايثليين": NONE, "بولي ايثيلين": NONE,
    "مواسير العليـــــــــــاء": NONE,
    "خدمه العملاء": NONE, "ادوات مكتبيه": NONE, "الغراء": NONE, "سياره جديده": NONE,
    "النواكل": NONE,
}


_FAMILY_BY_CATEGORY = {normalize(k): v for k, v in _FAMILY_BY_CATEGORY.items()}


def family_of(category: str | None) -> str:
    return _FAMILY_BY_CATEGORY.get(normalize(category or ""), UNRATED)


_NOISE = [
    re.compile(r"ضغط\s*\d+(\.\d+)?\s*(بار)?"),
    re.compile(r"\d+(\.\d+)?\s*بار"),
    re.compile(r"\bp\s*n\s*\d+"),
    re.compile(r"\bبن\s*\d+"),
    re.compile(r"[×x*]\s*\d+(\.\d+)?\s*مم"),
    re.compile(r"\d+(\.\d+)?\s*سم"),
    re.compile(r"\.\.+\s*\d+"),
    re.compile(r"\d+\s*وات"),
    re.compile(r"\b2022\b"),
]

MM_SIZES = [20, 25, 32, 40, 50, 63, 75, 90, 110]
IN_SIZES = [Decimal("0.5"), Decimal("0.75"), Decimal("1"), Decimal("1.5"), Decimal("2"),
            Decimal("3"), Decimal("4"), Decimal("6")]

_IN_TO_MM = {Decimal("0.5"): 20, Decimal("0.75"): 25, Decimal("1"): 32,
             Decimal("1.5"): 50, Decimal("2"): 63}


_HALF = [
    (re.compile(r"(\d+)\s*[\"']?\s*2\s*/\s*1(?!\d)"), r" \1.5 "),
    (re.compile(r"1\s*/\s*2\s*[\"']?\s*(\d+)(?!\d)"), r" \1.5 "),
]
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
        except Exception:  # noqa: BLE001
            continue
    return out


def size_mm(text: str) -> int | None:
    hits = [int(n) for n in _numbers(text) if int(n) == n and int(n) in MM_SIZES]
    return max(hits) if hits else None


def size_in(text: str, *, first: bool = False, quarters: bool = True) -> Decimal | None:
    hits = [n for n in _numbers(text, quarters=quarters) if n in IN_SIZES]
    if not hits:
        return None
    return hits[0] if first else max(hits)


def _d(value: str) -> Decimal:
    return Decimal(value)


_THREADED = {20: _d("2"), 25: _d("2"), 32: _d("4"), 50: _d("10"), 63: _d("10"),
             75: _d("6"), 90: _d("6"), 110: _d("6")}
_WELDED = {20: _d("0.25"), 25: _d("0.5"), 32: _d("0.5"), 50: _d("2"), 63: _d("2"),
           75: _d("3"), 90: _d("3"), 110: _d("3")}
_PIPE_PPR = {20: _d("0.5"), 25: _d("1"), 32: _d("1.5"), 50: _d("3.25"), 63: _d("4"),
             75: _d("4.75"), 90: _d("4.75"), 110: _d("4.75")}
_PIPE_PPR_INS = {25: _d("1.5"), 32: _d("2"), 50: _d("3.25"), 63: _d("4")}
_BURIED_VALVE = {20: _d("12"), 25: _d("12"),
                 32: _d("12")}
_BALL_VALVE = {25: _d("12"), 32: _d("12"), 50: _d("20"), 63: _d("20")}
_DRAIN_PIECE = {_d("1"): Fraction(1, 6), _d("1.5"): Fraction(1, 6),
                _d("2"): Fraction(1, 3), _d("3"): Fraction(1, 3),
                _d("4"): Fraction(1), _d("6"): Fraction(2)}
_DRAIN_PIPE = {_d("1"): Fraction(1, 6), _d("1.5"): Fraction(1, 3), _d("2"): Fraction(2, 3),
               _d("3"): Fraction(5, 6), _d("4"): Fraction(3, 2), _d("6"): Fraction(13, 6)}
_QAFIZ = {_d("0.75"): _d("0.5"), _d("1"): _d("0.5"), _d("1.5"): _d("0.5"),
          _d("2"): _d("0.5"), _d("3"): _d("0.5"), _d("4"): _d("1"), _d("6"): _d("1")}


PIPE_LENGTH_M = {PPR: 4, PPR_INS: 4, PE: 4, DRAIN: 6}


_QUANTUM = Decimal("0.001")


def _q(value) -> Decimal:
    if isinstance(value, Fraction):
        value = Decimal(value.numerator) / Decimal(value.denominator)
    return Decimal(value).quantize(_QUANTUM, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Verdict:
    points: Decimal | None
    rule: str
    family: str
    sale_points: Decimal | None = None


_NOT_GOODS = re.compile(r"قلب محبس|مشتمل|كرتون|شيكاره|شحم|تفلون|حاجز|رول |لقمه|كارته")

_PIPE_WORDS = re.compile(r"ماسور|مواسير|موسير|^م\s")

_THREADED_WORDS = re.compile(r"بسن|ب?س[نى]?\s*(داخل|خارج)|\bسن\s*(داخل|خارج)")


def _is_pipe(text: str) -> bool:
    return bool(_PIPE_WORDS.search(text))


def _ok(value, rule: str, fam: str, *, length: int = 1) -> Verdict:
    return Verdict(_q(value), rule, fam, sale_points=_q(value * length))


def _no(rule: str, fam: str) -> Verdict:
    return Verdict(None, rule, fam, sale_points=None)


def classify(name: str, category: str | None) -> Verdict:
    text = normalize(name)
    fam = family_of(category)

    if "كوبون" in text:
        return _ok(0, "كوبون — مش بضاعة تكسب نقط", fam)

    if _NOT_GOODS.search(text):
        return _ok(0, "قطعة غيار أو تعبئة — مش صنف كامل", fam)

    if "قفيز" in text:
        inch = size_in(text)
        if inch is None and size_mm(text) in (20, 25):
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
        inch = size_in(text, first=pipe, quarters=False)
        if inch is None:
            return _no("صرف من غير مقاس مقروء", fam)
        table, label = (_DRAIN_PIPE, "متر ماسورة صرف") if pipe else (_DRAIN_PIECE, "قطعة صرف")
        if inch in table:
            return _ok(table[inch], f"{label} {inch}", fam,
                       length=PIPE_LENGTH_M[DRAIN] if pipe else 1)
        return _no(f"صرف مقاس {inch} مش في الجدول", fam)

    mm = size_mm(text)
    if mm is None:
        inch = size_in(text)
        if inch is not None and inch in _IN_TO_MM:
            mm = _IN_TO_MM[inch]
    if mm is None:
        return _no("مقاس مش مقروء", fam)

    if "بطاري" in text:
        return _ok(10, "بطارية", fam)
    if "شيك بلف" in text:
        if mm in (25, 32):
            return _ok(10, f"شيك بلف {mm}", fam)
        return _no(f"شيك بلف {mm} مش في الجدول", fam)
    if "محبس" in text or "محيس" in text:
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
        return _no("وصلة بولى ايثيلين — مش في الجدول", fam)

    if mm in _WELDED:
        return _ok(_WELDED[mm], f"قطعة لحام {mm}", fam)
    return _no(f"لحام {mm} مش في الجدول", fam)
