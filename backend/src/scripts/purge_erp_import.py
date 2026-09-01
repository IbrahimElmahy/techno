"""يشيل اللي اتسحب من `ERP` ويسيب a5 زي ما هو — بطلب صاحب النظام: هيدخّلها بإيده.

    python -m src.scripts.purge_erp_import          # يعرض بس
    python -m src.scripts.purge_erp_import --yes    # ينفّذ

**الشيل آمن لأن الفصل تام، مش لأننا واثقين.** اتفحص قبل الكتابة:

    فواتير بيع على طرف ERP ......... 0
    مردودات على طرف ERP ............ 0
    سندات على طرف ERP .............. 0
    حسابات ذمم لأطراف ERP .......... 0

يعني مافيش مستند a5 واحد بيشاور على أي حاجة هنا، فحذفها مابيسيبش مرجع مكسور ولا
بيغيّر رقم في دفاتر a5. والسكربت **بيعيد الفحص ده وقت التشغيل** ويقف لو رقم منهم
مابقاش صفر — الحالة اتغيّرت يبقى الافتراض اتغيّر.

**بيتشال:** المعاينات وسطورها · مستندات صرف واستلام الكوبونات وسطورها · أطراف ERP
(ملّاك وسباكين وتجار) — واللي بيميّزها كودها `ERP-`.

**بيفضل:** كل داتا a5 · أنواع الكوبونات وأصناف المعاينة (دي قوايم مرجعية مش حركة،
والإدخال اليدوي محتاجها) · المستخدمين والفروع والإعدادات.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select, text

from src.core.db import SessionLocal

# الأمان بيتقاس، مايتفترضش. أي رقم هنا مش صفر معناه إن داتا a5 اتربطت بأطراف ERP
# بعد ما السكربت ده اتكتب — فالحذف بقى بيسيب ورا مراجع مكسورة، والوقفة أرخص.
GUARDS: list[tuple[str, str]] = [
    ("فواتير بيع على طرف ERP",
     "select count(*) from sales_invoice s join customer c on c.id=s.customer_id"
     " where c.code like 'ERP-%'"),
    ("مردودات بيع على طرف ERP",
     "select count(*) from sales_return s join customer c on c.id=s.customer_id"
     " where c.code like 'ERP-%'"),
    ("سندات على طرف ERP",
     "select count(*) from voucher v join customer c on c.id=v.customer_id"
     " where c.code like 'ERP-%'"),
    ("حسابات ذمم لأطراف ERP",
     "select count(*) from customer_account a join customer c on c.id=a.customer_id"
     " where c.code like 'ERP-%'"),
]

# بالترتيب: الابن قبل الأب.
STEPS: list[tuple[str, str, str]] = [
    ("سطور المعاينات", "inspection_item", "delete from inspection_item"),
    ("المعاينات", "inspection", "delete from inspection"),
    ("سطور استلام الكوبونات", "coupon_receipt_line", "delete from coupon_receipt_line"),
    ("مستندات استلام الكوبونات", "coupon_receipt", "delete from coupon_receipt"),
    ("سطور صرف الكوبونات", "coupon_issue_line", "delete from coupon_issue_line"),
    ("مستندات صرف الكوبونات", "coupon_issue", "delete from coupon_issue"),
    ("أطراف ERP (ملّاك وسباكين وتجار)", "customer",
     "delete from customer where code like 'ERP-%'"),
]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        print("فحص الفصل:")
        blocked = False
        for label, sql in GUARDS:
            n = db.scalar(text(sql)) or 0
            mark = "✔" if n == 0 else "✘"
            print(f"  {mark} {label:<32}{n:>8}")
            if n:
                blocked = True
        if blocked:
            print("\n⛔ فيه داتا a5 مربوطة بأطراف ERP — وقفت. الحذف كده بيكسر مراجع.")
            return

        print("\nهيتشال:")
        total = 0
        for label, table, sql in STEPS:
            where = sql.split("where", 1)[1] if " where " in sql else ""
            q = f"select count(*) from {table}" + (f" where{where}" if where else "")
            n = db.scalar(text(q)) or 0
            total += n
            print(f"  {label:<34}{n:>8,}")
        print(f"  {'الإجمالي':<34}{total:>8,}")

        kept = {
            "عملاء a5": "select count(*) from customer where code not like 'ERP-%'",
            "فواتير البيع": "select count(*) from sales_invoice",
            "قيود الدفتر": "select count(*) from ledger_entry",
            "الأصناف": "select count(*) from item",
            "أنواع الكوبونات": "select count(*) from coupon_type",
            "أصناف المعاينة": "select count(*) from inspection_item_type",
        }
        print("\nهيفضل:")
        for label, sql in kept.items():
            print(f"  {label:<34}{db.scalar(text(sql)) or 0:>8,}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for label, _table, sql in STEPS:
            res = db.execute(text(sql))
            print(f"✔ {label}: {res.rowcount}")
        db.commit()

        print("\nبعد الشيل:")
        for label, sql in kept.items():
            print(f"  {label:<34}{db.scalar(text(sql)) or 0:>8,}")
        left = db.scalar(text("select count(*) from customer where code like 'ERP-%'")) or 0
        print(f"  {'أطراف ERP الفاضلة':<34}{left:>8,}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
