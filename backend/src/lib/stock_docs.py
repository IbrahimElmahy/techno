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
