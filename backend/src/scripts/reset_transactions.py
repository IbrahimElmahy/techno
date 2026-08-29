"""يمسح الحركات والمستندات ويسيب البيانات الأساسية — لبدء تشغيل نظيف.

الفرق بينه وبين `purge_demo`: ده بيمسح **كل** الحركات مهما كان مصدرها، مش الداتا المزروعة
بالاسم. الأساسي بيفضل: المستخدمين والفروع والمخازن والأصناف والعملاء والموردين والموظفين
وشجرة الحسابات والوصفات والإعدادات.

الأرصدة كلها مشتقّة من الحركات في النظام ده — رصيد المخزن مجموع حركاته، ورصيد العميل مجموع
قيوده. فمسح الحركات بيصفّر الأرصدة لوحده، من غير ما نلمس صف رصيد واحد.

**حذف نهائي مالوش رجعة.** خُد نسخة من قاعدة البيانات قبله لو فيها حاجة تهمّك.

    python -m src.scripts.reset_transactions --dry-run    # يعرض بس
    python -m src.scripts.reset_transactions --yes        # ينفّذ
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select, text

import src.models  # noqa: F401 — بيملا الـmetadata بكل الجداول
from src.core.db import Base, SessionLocal, engine

# بالترتيب: الابن قبل الأب، عشان المفاتيح الأجنبية ما ترفضش.
TRANSACTIONAL: list[str] = [
    # الولاء والكوبونات
    "coupon_redemption", "coupon_receipt_line", "coupon_receipt", "coupon",
    "point_conversion", "point_record",
    # المعاينات
    "inspection_item", "inspection",
    # الحجوزات والطلبات
    "reservation", "trade_order_line", "trade_order",
    # المبيعات
    "sales_invoice_expense", "sales_invoice_coupon",
    "sales_return_line", "sales_return", "sales_invoice_line", "sales_invoice",
    # المشتريات
    "purchase_return_line", "purchase_return",
    "purchase_invoice_line", "purchase_invoice",
    # التصنيع والهوالك
    "manufacturing_order_consumption", "manufacturing_order_resource",
    "manufacturing_op", "manufacturing_order", "wastage_document",
    # المخزون
    "stock_permit_line", "stock_permit",
    "stock_count_line", "stock_count",
    "stock_transfer_line", "stock_transfer",
    "item_serial_movement", "item_serial",
    "stock_batch_movement", "stock_batch",
    "stock_movement", "stock_locator",
    # الخزينة والدفاتر
    "cheque", "voucher",
    "ledger_line", "ledger_entry",
    # الموارد البشرية — الموظف نفسه بيفضل
    "payroll_line_detail", "payroll_line", "payroll_remittance", "payroll_run",
    "employee_advance", "attendance_record", "leave_request",
    "depreciation_record",
    # السجل
    "audit_log_entry",
]

# اللي بيفضل — مكتوب صراحةً عشان يتقرا، مش عشان يتنفّذ.
KEPT = [
    "user", "role", "role_capability",
    "branch", "governorate", "territory", "head_office",
    "warehouse", "custody", "treasury",
    "item", "item_price", "item_price_history", "item_unit", "category",
    "customer", "customer_account", "supplier", "supplier_account",
    "account", "account_routing", "cost_center", "voucher_key",
    "employee", "department", "job_title",
    "bom", "bom_component", "bom_resource",
    "coupon_type", "product_point_value", "inspection_item_type",
    "lookup_option", "sales_setting", "stock_setting", "fixed_asset",
]


def _counts() -> dict[str, int]:
    known = set(Base.metadata.tables)
    out: dict[str, int] = {}
    with engine.connect() as c:
        for t in TRANSACTIONAL:
            if t not in known:
                continue
            n = c.execute(select(func.count()).select_from(Base.metadata.tables[t])).scalar() or 0
            if n:
                out[t] = n
    return out


def run(*, execute: bool) -> None:
    counts = _counts()
    total = sum(counts.values())
    print(f"{'الجدول':<34}{'صفوف':>8}")
    print("-" * 42)
    for t, n in counts.items():
        print(f"{t:<34}{n:>8}")
    print("-" * 42)
    print(f"{'الإجمالي':<34}{total:>8}\n")

    if not execute:
        print("عرض فقط — لم يُحذف شيء. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    try:
        dialect = engine.dialect.name
        known = set(Base.metadata.tables)
        # المفاتيح الأجنبية بتتوقف مؤقتاً: الترتيب مظبوط، بس الحلقات (الفاتورة ↔ القيد)
        # مافيش ترتيب بيحلّها.
        if dialect in ("mysql", "mariadb"):
            db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        deleted = 0
        for t in TRANSACTIONAL:
            if t not in known:
                continue
            r = db.execute(text(f"DELETE FROM `{t}`" if dialect in ("mysql", "mariadb")
                                else f'DELETE FROM "{t}"'))
            deleted += r.rowcount or 0
        if dialect in ("mysql", "mariadb"):
            db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
        db.commit()
        print(f"اتمسح {deleted} صف.")
        left = _counts()
        print("فاضل:", left or "لا شيء")
    finally:
        db.close()


if __name__ == "__main__":
    args = set(sys.argv[1:])
    if "--yes" not in args:
        run(execute=False)
    else:
        run(execute=True)
