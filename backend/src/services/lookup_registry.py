"""Registry of configurable dropdown categories — 013-settings-lookups.

Declares every admin-configurable dropdown: which page it belongs to (for the Settings UI grouping),
whether it is enum-bound (`system=True` → values locked, only relabel/reorder/hide), and the default
option list (value, label) used to lazily seed the category on first use.
"""
from __future__ import annotations

# category key -> metadata
CATEGORIES: dict[str, dict] = {
    # --- Catalog page ---
    "item_kind": {
        "page": "catalog", "label": "أنواع الأصناف", "system": True,
        "defaults": [("raw_material", "مادة خام"), ("product", "منتج")],
    },
    # Free list (v4): item categories — admins define their own classification.
    "item_category": {
        "page": "catalog", "label": "فئات الأصناف", "system": False,
        "defaults": [("مواسير", "مواسير"), ("لحامات", "لحامات"), ("عدد وأدوات", "عدد وأدوات"),
                     ("خامات تشغيل", "خامات تشغيل")],
    },
    "unit_of_measure": {
        "page": "catalog", "label": "وحدات القياس", "system": False,
        "defaults": [("قطعة", "قطعة"), ("متر", "متر"), ("كرتونة", "كرتونة"),
                     ("كيلو", "كيلو"), ("لتر", "لتر")],
    },
    "price_tier": {
        "page": "catalog", "label": "فئات الأسعار", "system": True,
        "defaults": [("commercial", "تجاري"), ("semi_commercial", "نصف تجاري"),
                     ("wholesale", "جملة"), ("semi_wholesale", "نصف جملة"),
                     ("consumer", "مستهلك")],
    },
    # --- Customers page ---
    # Free list (013): no logic branches on customer_type, so admins can add their own types.
    "customer_type": {
        "page": "customers", "label": "أنواع العملاء", "system": False,
        "defaults": [("trader", "تاجر"), ("plumber", "سباك"), ("other", "أخرى")],
    },
    # --- Suppliers page ---
    # Free list, exactly like customer_type: their الموردين form has a تصنيف dropdown, and a fixed
    # list of our own invention would be wrong for the first company that buys differently.
    "supplier_type": {
        "page": "suppliers", "label": "أنواع الموردين", "system": False,
        "defaults": [("manufacturer", "مصنع"), ("importer", "مستورد"),
                     ("distributor", "موزع"), ("other", "أخرى")],
    },
    # --- Loyalty page ---
    # أنواع الكوبونات = فئات الكوبون الورقي (عادي/فضي/ذهبي/ماسي) — قايمة حرة يديرها صاحب
    # الشغل من الإعدادات، وبنقرأها في شاشة استلام الكوبونات على الويب والموبايل.
    "coupon_kind": {
        "page": "setup", "label": "أنواع الكوبونات", "system": False,
        "defaults": [("عادي", "عادي"), ("فضي", "فضي"),
                     ("ذهبي", "ذهبي"), ("ماسي", "ماسي")],
    },
    "redemption_mode": {
        "page": "loyalty", "label": "طرق استرداد الكوبون", "system": True,
        "defaults": [("money", "خصم نقدي"), ("gift_product", "منتج هدية"),
                     ("gift_money_off", "خصم على الفاتورة")],
    },
    # --- Organization / Warehouses page ---
    "warehouse_type": {
        "page": "org", "label": "أنواع المخازن", "system": True,
        "defaults": [("central", "مركزي"), ("branch", "فرعي")],
    },
    "holder_type": {
        "page": "org", "label": "أنواع العُهد", "system": True,
        "defaults": [("rep", "مندوب"), ("warehouse", "مخزن")],
    },
    "location_kind": {
        "page": "org", "label": "أنواع المواقع", "system": True,
        "defaults": [("warehouse", "مخزن"), ("custody", "عهدة")],
    },
    # --- Purchases / Sales page (free lists) ---
    "payment_method": {
        "page": "transactions", "label": "طرق الدفع", "system": False,
        "defaults": [("cash", "نقدي"), ("credit", "آجل")],
    },
    # --- Inspections page (015 — mobile معاينات; free lists per the client's spec) ---
    "inspection_description": {
        "page": "inspections", "label": "توصيف المعاينة", "system": False,
        "defaults": [("حمام و مطبخ", "حمام و مطبخ"), ("حمام فقط", "حمام فقط"),
                     ("مطبخ فقط", "مطبخ فقط"), ("2 حمام و مطبخ", "2 حمام و مطبخ"),
                     ("مرمه", "مرمه"), ("محل", "محل"), ("مسجد", "مسجد"),
                     ("صيدليه", "صيدليه"), ("2 حمام", "2 حمام")],
    },
    "inspection_type": {
        "page": "inspections", "label": "نوع المعاينة", "system": False,
        "defaults": [("تغذية و صرف", "تغذية و صرف"), ("تغذية فقط", "تغذية فقط"),
                     ("صرف فقط", "صرف فقط")],
    },
    # نوع الزيارة في شاشة المراجعة (النظام القديم: معاينة/مرمة) — قابلة للإضافة.
    "visit_type": {
        "page": "inspections", "label": "نوع الزيارة", "system": False,
        "defaults": [("معاينة", "معاينة"), ("مرمة", "مرمة")],
    },
}

# Human-readable page titles for the Settings UI.
PAGE_LABELS: dict[str, str] = {
    "setup": "اداره الانشءات",
    "catalog": "الكتالوج والأصناف",
    "customers": "العملاء",
    "loyalty": "الولاء والكوبونات",
    "org": "التنظيم والمخازن",
    "transactions": "الفواتير والمعاملات",
    "inspections": "المعاينات",
}


def is_system(category: str) -> bool:
    meta = CATEGORIES.get(category)
    return bool(meta and meta.get("system"))
