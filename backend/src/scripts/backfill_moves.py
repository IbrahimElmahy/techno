"""نقل القيود القديمة لموديل المستند — المرحلة ٢ من إعادة الهيكلة على موديل أودو.

    python -m src.scripts.backfill_moves            # عرض بس، مابيكتبش حاجة
    python -m src.scripts.backfill_moves --yes      # التنفيذ

**المشكلة:** القيد بقى بيحمل نوعه وشريكه وتاريخ استحقاقه، بس ده للقيود الجديدة بس.
القديم كله `move_type` و`partner_id` فيه NULL — يعني «كل حركة العميل ده» و«فواتيره
المفتوحة» لسه بيتحسبوا من جدول المستندات مش من الدفتر، والتسوية في المرحلة ٣ مش
هتلاقي فواتير تتقفل عليها.

**اللي بيحصل هنا:**

١. `move_type` بياخد قيمته من `entry_type` — الخريطة في `move_registry`. اللي مش
   فاتورة ولا مردود بياخد `entry` (سند، شيك، راتب، إهلاك — زي أودو بالظبط).
٢. الشريك بيتقرا من **المستند نفسه**، مش من الحسابات اللي القيد لمسها: الفاتورة
   بتقول عميلها، والسند بيقول عميله أو مورده، والشيك بيقول صاحبه، والسلفة بتقول
   موظفها. حساب واحد ممكن يخدم أكتر من طرف (سلف العاملين حساب واحد للكل)، فالاستنتاج
   من الحساب كان هيدّي شريك غلط.
٣. تاريخ الاستحقاق: تاريخ القيد نفسه — «مستحق يوم ما حصل». الاستثناء الشيك: استحقاقه
   مكتوب عليه، فبياخده. من غير شروط دفع مافيش مصدر تاني نستنتج منه.
٤. سطور القيد بتاخد شريك قيدها وتاريخ استحقاقه، زي التوريث اللي بيحصل وقت الكتابة.

**بيتعاد بأمان:** القيد اللي معاه `move_type` خلاص بيتسكّت عنه. والقيد اللي مالوش
مستند (قيد يومية بإيد، افتتاحي، إهلاك) بياخد نوعه وبيفضل بلا شريك — وده صح مش نقص.

**بيقيس:** بيعدّ الفواتير اللي مالقاش لها مستند وبيقول أنواعها، عشان لو فيه مستند
مربوط بطريقة تانية يبان هنا بدل ما يتكشف من تقرير أعمار ناقص.
"""
from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.db import SessionLocal
from src.models.cheque import Cheque
from src.models.hr_advance import EmployeeAdvance
from src.models.ledger import LedgerEntry, PartnerKind
from src.models.loyalty import CouponRedemption
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.voucher import Voucher
from src.services import move_registry


def _partner_map(db) -> dict[int, tuple[str, int]]:
    """قيد → (نوع الشريك، رقمه)، مقروء من جداول المستندات.

    الترتيب مقصود: اللي بيتقرا بعدين بيغلب. مافيش قيد المفروض يبقى في أكتر من جدول،
    فالتعارض ده مايحصلش — والترتيب مكتوب عشان لو حصل يبقى محسوم مش عشوائي.
    """
    out: dict[int, tuple[str, int]] = {}

    def take(rows, kind: PartnerKind) -> None:
        for entry_id, party_id in rows:
            if entry_id and party_id:
                out[int(entry_id)] = (kind.value, int(party_id))

    take(db.execute(select(SalesInvoice.ledger_entry_id, SalesInvoice.customer_id)).all(),
         PartnerKind.customer)
    take(db.execute(select(SalesReturn.ledger_entry_id, SalesReturn.customer_id)).all(),
         PartnerKind.customer)
    take(db.execute(select(SalesReturn.reversal_entry_id, SalesReturn.customer_id)).all(),
         PartnerKind.customer)
    take(db.execute(select(PurchaseInvoice.ledger_entry_id, PurchaseInvoice.supplier_id)).all(),
         PartnerKind.supplier)
    take(db.execute(select(PurchaseReturn.ledger_entry_id, PurchaseReturn.supplier_id)).all(),
         PartnerKind.supplier)
    take(db.execute(select(PurchaseReturn.reversal_entry_id, PurchaseReturn.supplier_id)).all(),
         PartnerKind.supplier)
    take(db.execute(select(CouponRedemption.ledger_entry_id, CouponRedemption.customer_id)).all(),
         PartnerKind.customer)
    take(db.execute(select(EmployeeAdvance.ledger_entry_id, EmployeeAdvance.employee_id)).all(),
         PartnerKind.employee)
    take(db.execute(select(EmployeeAdvance.reversal_entry_id, EmployeeAdvance.employee_id)).all(),
         PartnerKind.employee)
    # السند والشيك بيحملوا طرف واحد من الاتنين، فبيتقروا صف صف.
    for entry_id, customer_id, supplier_id in db.execute(
        select(Voucher.ledger_entry_id, Voucher.customer_id, Voucher.supplier_id)
    ).all():
        if not entry_id:
            continue
        if customer_id:
            out[int(entry_id)] = (PartnerKind.customer.value, int(customer_id))
        elif supplier_id:
            out[int(entry_id)] = (PartnerKind.supplier.value, int(supplier_id))
    for reg, settle, customer_id, supplier_id in db.execute(
        select(Cheque.register_entry_id, Cheque.settle_entry_id,
               Cheque.customer_id, Cheque.supplier_id)
    ).all():
        if customer_id:
            pair = (PartnerKind.customer.value, int(customer_id))
        elif supplier_id:
            pair = (PartnerKind.supplier.value, int(supplier_id))
        else:
            continue
        for entry_id in (reg, settle):
            if entry_id:
                out[int(entry_id)] = pair
    return out


def _due_map(db) -> dict[int, object]:
    """قيد → تاريخ استحقاق من المستند. الشيك بس — هو الوحيد اللي بيقول استحقاقه."""
    out: dict[int, object] = {}
    for reg, settle, due in db.execute(
        select(Cheque.register_entry_id, Cheque.settle_entry_id, Cheque.due_date)
    ).all():
        if due is None:
            continue
        for entry_id in (reg, settle):
            if entry_id:
                out[int(entry_id)] = due
    return out


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        entries = db.scalars(
            select(LedgerEntry).options(selectinload(LedgerEntry.lines))
        ).all()
        print(f"القيود في الدفتر: {len(entries)}")
        if not entries:
            print("مافيش قيود — مافيش حاجة تتنقل.")
            return

        partners = _partner_map(db)
        dues = _due_map(db)
        print(f"مستندات معاها شريك: {len(partners)}")

        todo = [e for e in entries if not e.move_type]
        print(f"معاها نوع خلاص: {len(entries) - len(todo)} — محتاجة نقل: {len(todo)}")

        by_type: dict[str, int] = defaultdict(int)
        by_partner: dict[str, int] = defaultdict(int)
        orphan_types: dict[str, int] = defaultdict(int)

        for entry in todo:
            move_type = move_registry.move_type_for(entry.entry_type).value
            by_type[move_type] += 1
            pair = partners.get(entry.id)
            due = dues.get(entry.id) or entry.entry_date or entry.created_at.date()
            if pair:
                by_partner[pair[0]] += 1
            elif move_registry.is_invoice(move_type):
                # فاتورة من غير مستند — دي اللي تستاهل تتقال: التسوية مش هتلاقيها.
                orphan_types[entry.entry_type] += 1
            if execute:
                entry.move_type = move_type
                if pair:
                    entry.partner_kind, entry.partner_id = pair
                entry.invoice_date_due = due
                for line in entry.lines:
                    if pair and line.partner_id is None:
                        line.partner_kind, line.partner_id = pair
                    if line.date_maturity is None:
                        line.date_maturity = due

        print("\nالتوزيع على أنواع المستندات:")
        for move_type, count in sorted(by_type.items(), key=lambda kv: -kv[1]):
            print(f"  {move_registry.MOVE_TYPE_LABEL.get(move_type, move_type):<14} {count:>6}")

        print("\nالشركاء:")
        for kind, count in sorted(by_partner.items(), key=lambda kv: -kv[1]):
            print(f"  {move_registry.PARTNER_KIND_LABEL.get(kind, kind):<14} {count:>6}")
        without = len(todo) - sum(by_partner.values())
        print(f"  {'بلا شريك':<14} {without:>6}   (قيد يومية، افتتاحي، إهلاك، تحويل خزنة)")

        if orphan_types:
            print("\n⚠ فواتير/مردودات مالقاش لها مستند — التسوية مش هتعرف تقفل عليها:")
            for entry_type, count in sorted(orphan_types.items(), key=lambda kv: -kv[1]):
                print(f"  {entry_type}: {count}")

        if not execute:
            print("\n(عرض بس — ضيف --yes للتنفيذ)")
            return

        db.commit()
        print(f"\n✔ اتنقل {len(todo)} قيد لموديل المستند.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv)
