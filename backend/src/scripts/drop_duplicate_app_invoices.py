"""يمسح فاتورة التطبيق اللي ليها توأم متطابق جاي من a5.

    python -m src.scripts.drop_duplicate_app_invoices            # عرض فقط
    python -m src.scripts.drop_duplicate_app_invoices --yes

**ليه أصلاً.** في فترة التجربة الفريق كان بيكتب البيعة مرتين: مرة في التطبيق (وبتوصلنا
بـ`client_uuid`) ومرة في a5 (وبتوصلنا مع الاستيراد برقم مستند a5). فالمخزون اتخصم
مرتين، والعميل اتحمّل مرتين، والنقاط اتكسبت مرتين.

**المطابقة بالسطور مش بالقيمة.** القيمة لوحدها بتكدب: فاتورتين بصفر جنيه بيتطابقوا
وهما مالهمش علاقة — وده حصل فعلاً في أول قياس، فاتورة عميل علياء «طابقت» فاتورة
أكتوبر لأن الاتنين صفر. الشرط دلوقتي: نفس اليوم، **ونفس بصمة السطور** (صنف × كمية
مرتّبة)، والقيمة فرقها أقل من قرشين. التلاتة مع بعض.

**والباقي بيتساب.** فاتورة التطبيق اللي مالهاش توأم بيعة حقيقية اتكتبت في التطبيق
وحده — مسحها ضياع مستند.

بيمسح بـ`document_edit_service.delete_sale`، فالمخزون والقيد والنقاط والمرتجعات
والسجل كلهم بيتظبطوا — مش `DELETE` على الصف.
"""
from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.sales import SalesInvoice, SalesInvoiceLine
from src.services import document_edit_service

# فرق مسموح بين القيمتين — **نسبي مش ثابت**.
#
# البصمة (صنف × كمية) هي الدليل القوي؛ السعر ممكن يكون اتصحّح في a5 بعد ما البيعة
# اتكتبت في التطبيق. اتقاس: SINV-000031 وAL-S68688، نفس التاجر ونفس التلتاشر سطر
# بنفس الكميات، والفرق ١٫١٩ ج جاي من سطر واحد سعره اتعدّل (٨٣٫٠٩ ⇐ ٥٥٫٥٠) — بفرق
# ثابت قدره قرشين كان التوأم ده هيعدّي ويفضل مزدوج.
TOLERANCE_PCT = Decimal("0.005")   # نص في المية
TOLERANCE_MIN = Decimal("0.02")


def _tolerance(value) -> Decimal:
    return max(TOLERANCE_MIN, abs(Decimal(str(value or 0))) * TOLERANCE_PCT)


def _fingerprint(db, invoice_id: int) -> tuple:
    """بصمة سطور الفاتورة: (صنف، كمية) مرتّبة — **للسطور اللي عليها فلوس بس**.

    الكوبون اللي بيتصرف مع البيعة بيتسجّل في a5 **سطر صنف بصفر جنيه**، وعندنا بيتسجّل
    في خانة الكوبونات على الفاتورة. فنفس البيعة بالظبط بتطلع بسطرين عند a5 وسطر واحد
    عندنا — والبصمة الكاملة بتقول «مش توأم» على توأم. اتقاس: SINV-000030 و
    AL-S68689، نفس التاجر ونفس التلات أصناف ونفس الـ١٢٬١٤٥٫٥٠، والفرق سطر «كوبون
    ذهبى» بصفر.
    """
    rows = db.execute(
        select(SalesInvoiceLine.item_id, SalesInvoiceLine.quantity,
               SalesInvoiceLine.unit_price)
        .where(SalesInvoiceLine.invoice_id == invoice_id)
    ).all()
    return tuple(sorted((int(i), Decimal(str(q)))
                        for i, q, price in rows if Decimal(str(price or 0)) > 0))


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        app = db.scalars(select(SalesInvoice).where(
            SalesInvoice.client_uuid.isnot(None)).order_by(SalesInvoice.id)).all()
        if not app:
            print("مافيش فواتير من التطبيق.")
            return

        dates = {i.invoice_date for i in app if i.invoice_date}
        a5 = db.scalars(select(SalesInvoice).where(
            SalesInvoice.client_uuid.is_(None),
            SalesInvoice.invoice_date.in_(dates))).all()

        by_key: dict[tuple, list[SalesInvoice]] = {}
        for inv in a5:
            by_key.setdefault((inv.invoice_date, _fingerprint(db, inv.id)), []).append(inv)

        twins: list[tuple[SalesInvoice, SalesInvoice]] = []
        alone: list[SalesInvoice] = []
        taken: set[int] = set()
        for inv in app:
            key = (inv.invoice_date, _fingerprint(db, inv.id))
            # **الفاتورة اللي كل سطورها بصفر مالهاش بصمة.** لو سمحنا لها تطابق، أي
            # فاتورة صفرية بتطابق أي فاتورة صفرية تانية — وده حصل: فاتورة عميل علياء
            # «طابقت» فاتورة أكتوبر لأن الاتنين صفر. بتتساب وتتقال في الآخر.
            if not key[1]:
                alone.append(inv)
                continue
            match = None
            for candidate in by_key.get(key, []):
                if candidate.id in taken:
                    continue
                gap = abs(Decimal(str(inv.net or 0)) - Decimal(str(candidate.net or 0)))
                if gap <= _tolerance(inv.net):
                    match = candidate
                    break
            if match is None:
                alone.append(inv)
            else:
                taken.add(match.id)
                twins.append((inv, match))

        print("=" * 60)
        print(f"{'فواتير التطبيق':<36}{len(app):>8}")
        print(f"{'  ليها توأم في a5 (هتتمسح)':<36}{len(twins):>8}")
        print(f"{'  مالهاش توأم (هتتساب)':<36}{len(alone):>8}")
        print("=" * 60)

        if twins:
            print("\nالتوائم — نفس اليوم ونفس السطور:")
            for ours, theirs in twins:
                print(f"   {ours.document_number:<14} ⇐ يمسح · يفضل ⇒ "
                      f"{theirs.document_number:<14}{theirs.net}")
        if alone:
            print("\nهتتساب (بيعات اتكتبت في التطبيق وحده):")
            for inv in alone:
                print(f"   {inv.document_number:<14}{inv.invoice_date}  {inv.net}")

        if not execute:
            print("\n[عرض فقط] مافيش حاجة اتمسحت. ضيف --yes للتنفيذ.")
            return

        for ours, _theirs in twins:
            document_edit_service.delete_sale(db, invoice_id=ours.id, actor_user_id=None)
        db.commit()
        print(f"\n✔ اتمسحت {len(twins)} فاتورة تطبيق مزدوجة.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
