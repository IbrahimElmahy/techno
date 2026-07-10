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
    "customer_type": {
        "page": "customers", "label": "أنواع العملاء", "system": True,
        "defaults": [("trader", "تاجر"), ("plumber", "سباك"), ("other", "أخرى")],
    },
    # --- Loyalty page ---
    "coupon_kind": {
        "page": "loyalty", "label": "أنواع الكوبونات", "system": True,
        "defaults": [("money", "نقدي"), ("gift", "هدية")],
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
}

# Human-readable page titles for the Settings UI.
PAGE_LABELS: dict[str, str] = {
    "catalog": "الكتالوج والأصناف",
    "customers": "العملاء",
    "loyalty": "الولاء والكوبونات",
    "org": "التنظيم والمخازن",
    "transactions": "الفواتير والمعاملات",
}


def is_system(category: str) -> bool:
    meta = CATEGORIES.get(category)
    return bool(meta and meta.get("system"))
