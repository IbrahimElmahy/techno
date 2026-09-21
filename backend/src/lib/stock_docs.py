"""**السجل الواحد لأسماء حركة المخزون** — النوع والمستند واسمهم العربي، في مكان واحد.

المشكلة اللي الملف ده موجود عشانها مش نظرية، وحصلت تلات مرات:

`StockMovement` بيشيل اسمين نصّيين حُرّين — `source_doc_type` (الورقة) و`movement_type`
(نوع الحركة) — وبيتكتبوا من **٢٥ موضع** مالهمش قايمة مشتركة. الخدمة الحيّة سمّت البيع
`sale`/`sale_out`، ونقل a5 سمّاه `sales_invoice`/`sale`. النتيجة في قاعدة العميل:

    source_doc_type: sales_invoice 45,670  ·  movement_type: sale 45,555 · sale_out 115
                     stock_transfer 66,048                   purchase 3,861 · purchase_in 9
                     purchase_invoice 3,870                  sales_return 1,908 · sale_return_in 2
                                                             permit 363 · permit_in 2

وكل مرة الغلط بيطلع في مكان تاني:

1. **`document_edit_service`** كان بيشيل حركات المستند بالاسم القصير بس، فتعديل أي
   فاتورة منقولة من a5 كان بيسيب حركتها القديمة ويكتب جديدة فوقها — الصنف بينخصم مرتين.
2. **كارت الصنف** كان بيدوّر على `sale` فمالقاش `sales_invoice`، فطلع **٦٤٦ سطر كلهم**
   من غير جهة تعامل ولا سعر ولا إجمالي.
3. **فلتر «نوع الحركة»** في نفس الكارت بيقارن حرفياً، فاختيار «بيع» كان بيخفي ١١٥ سطر
   أو ٤٥٬٥٥٥ — على حسب أي اسم اتخزّن.

والعلاج اللي اتعمل كل مرة كان نفسه: قايمة أسماء مكتوبة بالإيد جنب الكود المكسور. تلات
قوايم في الباك-إند وتلات قوايم في الواجهة، وكل واحدة بتنسى حاجة.

**فالسجل ده هو القايمة الوحيدة.** كل نوع مكتوب مرة واحدة باسمه الموحّد وأسمائه القديمة
واسمه العربي، والباقي بينده:

* `canonical(x)` — الاسم الموحّد لأي اسم قديم. ده **الباب**: `post_movement` بينده عليه
  على الاتنين قبل ما يكتب، فمستحيل يتكتب اسم قديم جديد بعد النهارده.
* `names(x)` — كل الأسامي الممكنة لنوع واحد، للاستعلام على الداتا القديمة.
* `label(x)` — الاسم العربي، وبيتقدّم للواجهة من `/stock/movement-types` فالقايمة
  مابتتنسخش بالإيد في `.tsx`.
* `date_of(db, type, id)` — تاريخ الورقة، لأن الحركة مالهاش تاريخ بتاعها.

**ونوع جديد بيتسجّل هنا وبس.** لو اتكتب اسم مش في السجل، `post_movement` بيرفض —
لأن الاسم اللي محدش يعرفه بيبقى صف في القاعدة محدش هيلاقيه تاني.
"""
from __future__ import annotations

from dataclasses import dataclass, field


# --------------------------------------------------------------------------- المستندات
@dataclass(frozen=True)
class DocSpec:
    """ورقة بتحرّك مخزون: اسمها الموحّد، أسماؤها القديمة، وجدولها وتاريخها."""

    name: str
    label: str
    aliases: tuple[str, ...] = ()
    #: (الموديول، الكلاس، عمود التاريخ) — أو `None` لورقة مالهاش تاريخ نعرفه.
    dated: tuple[str, str, str] | None = None


#: **الأسماء الموحّدة هي أسماء الجداول** — لأنها اللي الداتا كلها عليها (٤٥ ألف صف
#: `sales_invoice` مقابل ٣٢ صف `sale`)، ولأن المستند وحركته بيبقوا مسمّيين نفس الاسم.
DOCS: tuple[DocSpec, ...] = (
    DocSpec("sales_invoice", "فاتورة بيع", ("sale",),
            ("src.models.sales", "SalesInvoice", "invoice_date")),
    DocSpec("sales_return", "مرتجع بيع", ("sale_return",),
            ("src.models.sales", "SalesReturn", "return_date")),
    DocSpec("purchase_invoice", "فاتورة شراء", ("purchase",),
            ("src.models.purchasing", "PurchaseInvoice", "purchase_date")),
    DocSpec("purchase_return", "مرتجع شراء", (),
            ("src.models.purchasing", "PurchaseReturn", "return_date")),
    DocSpec("stock_transfer", "إذن تحويل", ("transfer",),
            ("src.models.transfer", "StockTransfer", "transfer_date")),
    DocSpec("stock_permit", "إذن مخزن", ("permit",),
            ("src.models.stock_permit", "StockPermit", "permit_date")),
    DocSpec("stock_count", "جرد", (),
            ("src.models.stock_count", "StockCount", "count_date")),
    DocSpec("manufacturing_order", "أمر تصنيع", ("manufacturing",),
            ("src.models.manufacturing", "ManufacturingOrder", "production_date")),
    # (032) أمر التشغيل — كذا منتج وكذا خامة في ورقة واحدة. مستند تاني غير «أمر تصنيع»
    # بجدول تاني، فاسمه لازم يبقى تاني: اسم واحد للاتنين معناه إن `source_doc_id` بيشاور
    # على جدولين، وأول واحد يقرا الحركة بيفتح الصف الغلط.
    DocSpec("production_order", "أمر تشغيل", (),
            ("src.models.manufacturing", "ProductionOrder", "production_date")),
    DocSpec("inspection", "معاينة", (),
            ("src.models.inspection", "Inspection", "inspection_date")),
    # ورقة أول المدة المنقولة من a5 — مالهاش صف في أي جدول، وتاريخها بيتحسب في
    # `backfill_movement_dates` على إنه أول السنة.
    DocSpec("a5_opening", "رصيد أول المدة", ("opening",)),
    DocSpec("a5_opening_fix", "تصحيح رصيد أول المدة", ()),
    # حركات مالهاش ورقة مؤرَّخة: بتتكتب لحظتها وتاريخها يوم كتابتها.
    DocSpec("coupon", "كوبون", ()),
    DocSpec("batch_receive", "استلام دفعة", ()),
    DocSpec("import", "استيراد", ()),
    DocSpec("wastage", "هالك", ()),
    DocSpec("serial_receive", "استلام أرقام تسلسلية", ()),
    DocSpec("sale_return_reversal", "عكس مرتجع بيع", ()),
    DocSpec("purchase_return_reversal", "عكس مرتجع شراء", ()),
)


# --------------------------------------------------------------------------- أنواع الحركة
@dataclass(frozen=True)
class MoveSpec:
    """نوع الحركة زي ما بيتعرض في كارت الصنف: «بيع»، «تحويل وارد»، «هالك»."""

    name: str
    label: str
    aliases: tuple[str, ...] = field(default=())


#: الاسم الموحّد هنا هو **اللي الداتا عليه**، مش اللي الخدمة بتكتبه: `sale` ٤٥٬٥٥٥ صف
#: مقابل `sale_out` ١١٥. تسمية ٤٥ ألف صف أرخص وأأمن من العكس.
MOVES: tuple[MoveSpec, ...] = (
    MoveSpec("sale", "بيع", ("sale_out",)),
    MoveSpec("sales_return", "مرتجع بيع", ("sale_return_in",)),
    MoveSpec("purchase", "شراء", ("purchase_in",)),
    MoveSpec("purchase_return", "مرتجع شراء", ("purchase_return_out",)),
    MoveSpec("transfer_in", "تحويل وارد", ()),
    MoveSpec("transfer_out", "تحويل صادر", ()),
    MoveSpec("opening", "بضاعة أول المدة", ("opening_stock", "opening_in")),
    MoveSpec("permit_in", "إذن إضافة", ()),
    MoveSpec("permit_out", "إذن صرف", ()),
    # `permit` القديم مش عارف هو إضافة ولا صرف — الاتجاه على الصف نفسه هو اللي بيقول.
    # فبيفضل باسمه بدل ما نخمّن ونسمّي صرف «إضافة».
    MoveSpec("permit", "إذن مخزن", ()),
    MoveSpec("count_adjust_in", "تسوية جرد (زيادة)", ()),
    MoveSpec("count_adjust_out", "تسوية جرد (عجز)", ()),
    MoveSpec("production_in", "إنتاج", ()),
    MoveSpec("consumption_out", "استهلاك", ()),
    MoveSpec("waste_out", "هالك", ()),
    MoveSpec("inspection_out", "معاينة", ()),
    MoveSpec("loyalty_gift_out", "هدية نقاط", ()),
    MoveSpec("serial_receive_in", "استلام أرقام تسلسلية", ()),
    MoveSpec("batch_in", "استلام دفعة", ()),
    MoveSpec("sale_return_reversal", "عكس مرتجع بيع", ()),
    MoveSpec("purchase_return_reversal", "عكس مرتجع شراء", ()),
)


class StockDoc:
    """ثوابت أسماء المستندات — نفس اللي في [DOCS]، عشان الكود يكتبها غلط ما ينفعش.

    موجودة كثوابت مش كنصوص حرّة لأن `"sales_invoce"` بتعدّي على المترجم بينما
    `StockDoc.SALE_INVOCE` بتقع في السطر اللي كتبتها فيه.
    """

    SALE = "sales_invoice"
    SALE_RETURN = "sales_return"
    PURCHASE = "purchase_invoice"
    PURCHASE_RETURN = "purchase_return"
    TRANSFER = "stock_transfer"
    PERMIT = "stock_permit"
    COUNT = "stock_count"
    MANUFACTURING = "manufacturing_order"
    INSPECTION = "inspection"
    OPENING = "a5_opening"
    OPENING_FIX = "a5_opening_fix"


# --------------------------------------------------------------------------- الفهارس
def _index(specs) -> tuple[dict[str, str], dict[str, tuple[str, ...]], dict[str, str]]:
    canon: dict[str, str] = {}
    every: dict[str, tuple[str, ...]] = {}
    labels: dict[str, str] = {}
    for s in specs:
        all_names = (s.name, *s.aliases)
        for n in all_names:
            canon[n] = s.name
            every[n] = all_names
            labels[n] = s.label
    return canon, every, labels


#: بادئة العكس — الاسم المشتق لأي حركة مرآة.
_REVERSE = "reverse_"

_DOC_CANON, _DOC_NAMES, _DOC_LABELS = _index(DOCS)
_MOVE_CANON, _MOVE_NAMES, _MOVE_LABELS = _index(MOVES)
_DATED = {s.name: s.dated for s in DOCS if s.dated}
for _s in DOCS:
    if _s.dated:
        for _a in _s.aliases:
            _DATED[_a] = _s.dated


# --------------------------------------------------------------------------- الباب
def canonical(value: str | None, *, kind: str = "doc") -> str | None:
    """الاسم الموحّد لأي اسم — قديم أو جديد — أو `None` لو مش في السجل.

        canonical("sale")                      → "sales_invoice"
        canonical("sale_out", kind="movement") → "sale"
        canonical("حاجة")                       → None

    `None` معناها **اسم محدش يعرفه**، وهي اللي `post_movement` بيرفض عليها: الصف اللي
    بيتكتب باسم مش في السجل بيبقى صف مالوش اسم عربي ومايظهرش في أي فلتر ومحدش
    هيلاقيه تاني.
    """
    if value is None:
        return None
    table = _MOVE_CANON if kind == "movement" else _DOC_CANON
    hit = table.get(value)
    if hit is not None:
        return hit
    # **العكس مشتق مش مسجّل.** أي حركة ينفع تتعكس، و`reverse_movement` بيسمّي المرآة
    # `reverse_<اسم الأصل>`. لو العكس كان لازم يتسجّل بالإيد، نوع جديد يتسجّل صح
    # وعكسه يتنسى — والعكس بيترفض ساعة ما حد يلغي مستند، مش ساعة ما حد يكتب كود.
    if value.startswith(_REVERSE):
        base = table.get(value[len(_REVERSE):])
        if base is not None:
            return _REVERSE + base
    return None


def names(source_doc_type: str, *, kind: str = "doc") -> tuple[str, ...]:
    """كل القيم اللي ممكن تكون متكتوبة على حركة المستند ده.

        names("sale")           → ("sales_invoice", "sale")
        names("sales_invoice")  → ("sales_invoice", "sale")
        names("wastage")        → ("wastage",)

    للاستعلام على داتا اتكتبت قبل التوحيد. الاسم اللي مش في السجل بيرجع لوحده عشان
    استعلام مايرجعش فاضي بسبب نوع لسه ما اتسجّلش.
    """
    table = _MOVE_NAMES if kind == "movement" else _DOC_NAMES
    hit = table.get(source_doc_type)
    if hit is not None:
        return hit
    if source_doc_type.startswith(_REVERSE):
        base = table.get(source_doc_type[len(_REVERSE):])
        if base is not None:
            return tuple(_REVERSE + n for n in base)
    return (source_doc_type,)


def label(value: str | None, *, kind: str = "doc") -> str:
    """الاسم العربي، أو الاسم نفسه لو مش في السجل — العرض مايفضاش أبداً."""
    if value is None:
        return "—"
    table = _MOVE_LABELS if kind == "movement" else _DOC_LABELS
    hit = table.get(value)
    if hit is not None:
        return hit
    if value.startswith(_REVERSE):
        base = table.get(value[len(_REVERSE):])
        if base is not None:
            return f"عكس {base}"
    return value


def movement_types() -> list[dict[str, str]]:
    """قايمة أنواع الحركة بأسمائها العربية — اللي الواجهة بتبني بيها الفلتر والعمود.

    بتتقدّم من `/stock/movement-types` عشان القايمة تبقى نسخة واحدة: كانت متكتوبة
    بالإيد في تلات ملفات `.tsx`، وكل واحدة فيهم ناقصة نوع أو اتنين.
    """
    out = [{"value": s.name, "label": s.label} for s in MOVES]
    # العكس مشتق، فبيتولّد للعرض كمان — بدل ما الشاشة تعرف القاعدة وتكرّرها.
    out += [{"value": _REVERSE + s.name, "label": f"عكس {s.label}"}
            for s in MOVES if not s.name.endswith("_reversal")]
    return out


def doc_types() -> list[dict[str, str]]:
    """نفس الحكاية للمستندات."""
    return [{"value": s.name, "label": s.label} for s in DOCS]


# --------------------------------------------------------------------------- تاريخ المستند
#
# **الحركة مالهاش تاريخ بتاعها — تاريخها هو تاريخ ورقتها.**
#
# `StockMovement` كان فيه `created_at` بس: وقت كتابة الصف في قاعدتنا، مش تاريخ الحركة.
# النقل من a5 كتب ٤٤ ألف حركة في يوم واحد، فكارت الصنف كان بيقول إن بيع يناير حصل يوم
# النقل، والجرد بتاريخ سابق كان بيرجع مخزن فاضي. واللي بيملا `movement_date` مكان واحد —
# `post_movement` — بينده الدالة دي، فالـ٢٥ موضع اللي بيكتبوا حركة مايقدروش يختلفوا.
#
# وكل مستند سمّى عمود تاريخه باسمه — البيع `invoice_date` والتحويل `transfer_date` —
# فمافيش عمود واحد ينفع يتقرا من الكل، والجدول في [DOCS] هو اللي بيعرف.
def date_of(db, source_doc_type: str | None, source_doc_id: int | None):
    """تاريخ المستند اللي الحركة دي جاية منه، أو `None` لو مالوش تاريخ نعرفه.

    `None` مش غلط: الرصيد الافتتاحي مالوش ورقة بتاريخ، والهالك والكوبون بيتكتبوا من
    غير مستند مؤرَّخ. اللي بينده بيحط تاريخ اليوم بدلها — وده صح لحركة اتكتبت النهارده
    من غير ورقة، وغلط بس لو ادّعينا إنه تاريخ الورقة.

    وبيبلع أي استثناء عن قصد: ده تفصيلة عرض على حركة اتكتبت خلاص، ومايستاهلش إن فاتورة
    تقع لأن لوك-أب تاريخ فشل.
    """
    if not source_doc_type or not source_doc_id:
        return None
    spec = _DATED.get(source_doc_type)
    if spec is None:
        return None
    module_name, class_name, field_name = spec
    try:
        import importlib

        model = getattr(importlib.import_module(module_name), class_name)
        row = db.get(model, source_doc_id)
        if row is None:
            return None
        value = getattr(row, field_name, None)
        return getattr(value, "date", lambda: value)() if hasattr(value, "date") else value
    except Exception:  # noqa: BLE001 — الشرح فوق
        return None
