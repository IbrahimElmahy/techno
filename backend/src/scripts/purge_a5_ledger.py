"""يمسح قيود استيراد a5 لبادئة واحدة — لإعادة النقل بمفتاح تجميع صحيح.

    python -m src.scripts.purge_a5_ledger --prefix FC-          # عرض بس
    python -m src.scripts.purge_a5_ledger --prefix FC- --yes

---------------------------------------------------------------------------
**ليه سكربت مسح أصلاً.** `import_a5_ledger` كان بيجمّع سطور القيد بـ`MMStnd`، وده رقم
المستند في يومية a5 مش مفتاح القيد: بيتقسم على القيد الواحد وبيتشارك بين قيود مختلفة.
النتيجة على مصنع السادات كانت **٢٬٧٩٠ قيد غير متوازن من ٢٬٨٠٨** — الميزانية مابتقفلش
وأي تقرير مالي بيقرا الأرقام دي بيطلع غلط. والإصلاح في `--key doc`، بس القيود اللي
اتكتبت غلط مابتتصلّحش في مكانها: لازم تتشال وتتكتب من الأول.

**والمسح على `external_ref` بالبادئة.** كل قيد مستورد بيشيل `a5:<بادئة><مفتاح>`،
فالبادئة بتحدّد النقلة بالظبط — `FC-` بتمسح المصنع وحده ومابتلمسش `AL-` ولا أكتوبر.
والقيد اللي اتكتب من الشاشة مالوش `external_ref` أصلاً فمابيدخلش في الحساب.

**بيرفض يمشي لو القيد متربط بمستند.** القيد اللي فاتورة بتشاور عليه مش قيد استيراد
حر — مسحه بيسيب فاتورة بتشاور على لا حاجة. بيتعدّ وبيتقال، والمسح بيقف.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import delete, func, select

from src.core.db import SessionLocal
from src.models.ledger import LedgerEntry, LedgerLine


def _referencing_models() -> list:
    """كل موديل فيه `ledger_entry_id` — اللي لازم يتفك ربطه قبل مسح القيد."""
    from src.models.fixed_asset import DepreciationRecord
    from src.models.hr_advance import EmployeeAdvance
    from src.models.hr_payroll_run import PayrollRemittance
    from src.models.loyalty import CouponRedemption
    from src.models.purchasing import PurchaseInvoice, PurchaseReturn
    from src.models.sales import SalesInvoice, SalesReturn
    from src.models.voucher import Voucher

    return [SalesInvoice, SalesReturn, PurchaseInvoice, PurchaseReturn, Voucher,
            CouponRedemption, DepreciationRecord, EmployeeAdvance, PayrollRemittance]


def run(*, prefix: str, execute: bool, unlink: bool = False) -> int:
    if not prefix:
        raise SystemExit("لازم تحدّد --prefix — المسح بلا بادئة بيشيل كل النقلات.")
    like = f"a5:{prefix}%"
    db = SessionLocal()
    try:
        ids = [i for (i,) in db.execute(
            select(LedgerEntry.id).where(LedgerEntry.external_ref.like(like))).all()]
        lines = db.scalar(
            select(func.count()).select_from(LedgerLine)
            .where(LedgerLine.entry_id.in_(ids))) if ids else 0
        branches = db.execute(
            select(LedgerEntry.branch_id, func.count())
            .where(LedgerEntry.external_ref.like(like))
            .group_by(LedgerEntry.branch_id)).all()

        print(f"البادئة              {prefix}")
        print(f"قيود هتتمسح          {len(ids):>8,}")
        print(f"سطور هتتمسح          {lines:>8,}")
        for b, n in branches:
            print(f"   فرع {str(b):<16}{n:>8,}")

        # **كل اللي بيشاور على قيد، مش الفواتير بس.** أول نسخة كانت بتفحص فواتير البيع
        # وحدها، والمسح وقع على `purchase_invoice` بمفتاح أجنبي — بعد ما فكّ ربط
        # الفواتير. القايمة دي كل موديل فيه `ledger_entry_id`، متجابة من الموديلات
        # نفسها عشان اللي يضيف واحد جديد يلاقي نفسه هنا.
        linked_by: dict[str, int] = {}
        if ids:
            for model in _referencing_models():
                n = db.scalar(select(func.count()).select_from(model)
                              .where(model.ledger_entry_id.in_(ids))) or 0
                if n:
                    linked_by[model.__name__] = n
        linked = sum(linked_by.values())
        for name, n in linked_by.items():
            print(f"   مربوط بـ{name:<20}{n:>8,}")
        if linked and not unlink:
            print(f"\n⚠ {linked} قيد متربط بفاتورة — المسح وقف."
                  "\n   ضيف --unlink عشان الربط يتفك الأول (الاستيراد بيعيد ربطه).")
            return 1

        if not ids:
            print("\nمافيش حاجة تتمسح.")
            return 0
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتمسحت. ضيف --yes للتنفيذ.")
            return 0

        if linked:
            # **الربط بيتفك مش بيتمسح.** المستند بيفضل زي ما هو، وبس بيبطّل يشاور على
            # قيد هيختفي. و`import_a5_ledger` بيعيد الربط في نفس الخطوة اللي بيعمل فيها
            # القيد الجديد، فالمستند بيرجع مربوط بقيده الصح.
            from sqlalchemy import update

            for model in _referencing_models():
                db.execute(update(model).where(model.ledger_entry_id.in_(ids))
                           .values(ledger_entry_id=None))
            print(f"   اتفك ربط {linked:,} مستند.")

        db.execute(delete(LedgerLine).where(LedgerLine.entry_id.in_(ids)))
        db.execute(delete(LedgerEntry).where(LedgerEntry.id.in_(ids)))
        db.commit()
        print(f"\n✓ اتمسح {len(ids):,} قيد و{lines:,} سطر.")
        return 0
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="مسح قيود استيراد a5 لبادئة")
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--unlink", action="store_true",
                    help="فك ربط الفواتير بقيودها قبل المسح")
    a = ap.parse_args()
    sys.exit(run(prefix=a.prefix, execute=a.yes, unlink=a.unlink))


if __name__ == "__main__":
    main()
