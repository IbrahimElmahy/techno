"""أسماء المستند على حركة المخزون — **المكان الوحيد اللي بيعرف إن للمستند اسمين**.

`StockMovement.source_doc_type` فيه لغتين لنفس الحاجة، اتكتبوا في مكانين ومحدش بيفرضهم
يتفقوا:

    الخدمة الحيّة      المستورد من a5
    ----------------   -----------------
    sale               sales_invoice
    sale_return        sales_return
    purchase           purchase_invoice
    transfer           stock_transfer

والـid مش بيتصادم: القيمتين بيوصفوا نفس الجدول، فـ`sale` و`sales_invoice` بيشاوروا على
نفس `sales_invoice.id`.

**والكود اللي بيعرف اسم واحد بيغلط بصمت.** الحذف كان بيمرّر وحدة بس، فالمستند المنقول من
a5 كان يتمسح وحركته تفضل: بضاعة بتتحرك من غير ورقة تفسّرها، بتفضل في الرصيد للأبد. اتقاس
على قاعدة الإنتاج — إذن واحد (`stock_transfer#2527`) ساب ١٦ حركة بتنقل ٥٣ وحدة.

فبدل ما كل موضع يكتب القايمة بإيده ويفتكر اسم وينسى التاني، الموضع بينده [names].
"""
from __future__ import annotations

_ALIASES: dict[str, tuple[str, ...]] = {
    "sale": ("sale", "sales_invoice"),
    "sales_invoice": ("sale", "sales_invoice"),
    "sale_return": ("sale_return", "sales_return"),
    "sales_return": ("sale_return", "sales_return"),
    "purchase": ("purchase", "purchase_invoice"),
    "purchase_invoice": ("purchase", "purchase_invoice"),
    "purchase_return": ("purchase_return",),
    "transfer": ("transfer", "stock_transfer"),
    "stock_transfer": ("transfer", "stock_transfer"),
}


def names(source_doc_type: str) -> tuple[str, ...]:
    """كل القيم اللي ممكن تكون متكتوبة على حركة المستند ده.

        names("sale")           → ("sale", "sales_invoice")
        names("sales_invoice")  → ("sale", "sales_invoice")
        names("wastage")        → ("wastage",)

    الاسم اللي مش في الجدول بيرجع لوحده — القايمة دي للمستندات اللي ليها اسمين، مش
    فهرس لكل أنواع الحركة. نوع جديد بيشتغل من غير ما يتسجّل هنا، واللي محتاج تسجيل هو
    اللي المستورد بيكتبه باسم تاني.
    """
    return _ALIASES.get(source_doc_type, (source_doc_type,))


# --------------------------------------------------------------------------- تاريخ المستند
#
# **الحركة مالهاش تاريخ بتاعها — تاريخها هو تاريخ ورقتها.**
#
# `StockMovement` فيه `created_at` بس: وقت كتابة الصف في قاعدتنا. ده مش تاريخ الحركة.
# النقل من a5 كتب ٤٤ ألف حركة في يوم واحد، فكارت الصنف كان بيقول إن بيع يناير حصل يوم
# النقل، والجرد بتاريخ سابق كان بيرجع مخزن فاضي: كل البضاعة بتظهر مرة واحدة يوم النقل.
# والفاتورة اللي بتتكتب النهارده بتاريخ قديم كانت حركتها بتتسجّل بتاريخ النهارده.
#
# الحل إن الحركة تشيل `movement_date`، واللي بيملاه مكان واحد — `post_movement` —
# بينده الدالة دي على نوع المستند ورقمه. كده الـ٢٥ موضع اللي بيكتبوا حركة مايتغيّروش،
# ومايقدروش يختلفوا مع بعض.
#
# الجدول ده أسماء الأعمدة زي ما هي في كل مستند: البيع `invoice_date`، والمردود
# `return_date`، والشراء `purchase_date`، والتحويل `transfer_date` — كل واحد سمّى
# تاريخه باسمه، فمافيش عمود واحد ينفع يتقرا من الكل.
_DATE_FIELDS: dict[str, tuple[str, str, str]] = {
    # اسم النوع: (الموديول، الكلاس، عمود التاريخ)
    "sale": ("src.models.sales", "SalesInvoice", "invoice_date"),
    "sales_invoice": ("src.models.sales", "SalesInvoice", "invoice_date"),
    "sale_return": ("src.models.sales", "SalesReturn", "return_date"),
    "sales_return": ("src.models.sales", "SalesReturn", "return_date"),
    "purchase": ("src.models.purchasing", "PurchaseInvoice", "purchase_date"),
    "purchase_invoice": ("src.models.purchasing", "PurchaseInvoice", "purchase_date"),
    "purchase_return": ("src.models.purchasing", "PurchaseReturn", "return_date"),
    "transfer": ("src.models.transfer", "StockTransfer", "transfer_date"),
    "stock_transfer": ("src.models.transfer", "StockTransfer", "transfer_date"),
    "stock_permit": ("src.models.stock_permit", "StockPermit", "permit_date"),
    "permit": ("src.models.stock_permit", "StockPermit", "permit_date"),
    "stock_count": ("src.models.stock_count", "StockCount", "count_date"),
    "inspection": ("src.models.inspection", "Inspection", "inspection_date"),
    "manufacturing": ("src.models.manufacturing", "ManufacturingOrder", "production_date"),
    "manufacturing_order": ("src.models.manufacturing", "ManufacturingOrder",
                            "production_date"),
}


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
    spec = _DATE_FIELDS.get(source_doc_type)
    if spec is None:
        return None
    module_name, class_name, field = spec
    try:
        import importlib

        model = getattr(importlib.import_module(module_name), class_name)
        row = db.get(model, source_doc_id)
        if row is None:
            return None
        value = getattr(row, field, None)
        return getattr(value, "date", lambda: value)() if hasattr(value, "date") else value
    except Exception:  # noqa: BLE001 — الشرح فوق
        return None
