"""يمشي دورة فاتورة البيع كاملة ويقول كل رقم طلع منين. قراءة بس.

    python -m src.scripts.trace_invoice SINV-000036
    python -m src.scripts.trace_invoice AL-S68689 --customer

الفاتورة ← بنودها ← حركتها المخزنية ← قيدها ← أثرها على كشف حساب التاجر ←
نقاطها في الجيبين ← كوبوناتها. وكل قسم بيتحقق من نفسه: مجموع السطور يساوي الصافي،
القيد متوازن، النقاط المحسوبة تساوي المسجّلة.

**الغرض إن الرقم يتشاف وهو بيتبني، مش وهو خلاص.** التقرير اللي بيقول «الرصيد كذا»
مابيبنيش ثقة؛ اللي بيبنيها إنك تشوف الرقم اتجمّع من أنهي سطور وبأي قاعدة، وتلاقي
الحاصل بيطابق المخزّن. واللي مايطابقش بيتقال بـ✗ جنبه.

`--customer` بتزوّد كشف التاجر كله: أرصدته، مديونيته المفتوحة، نقاطه، ومرتجعاته.
"""
from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import func, select

from src.core.money import ZERO, to_money
from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, LedgerEntry, LedgerLine
from src.models.loyalty import PointPurse, PointRecord, ProductPointValue
from src.models.sales import (
    SalesInvoice,
    SalesInvoiceCoupon,
    SalesInvoiceLine,
    SalesReturn,
)
from src.models.stock import StockDirection, StockMovement
from src.services import points_service, statement_service

LINE = "─" * 74


def _head(title: str) -> None:
    print()
    print(LINE)
    print(f"  {title}")
    print(LINE)


def _check(label: str, left, right, unit: str = "") -> bool:
    ok = to_money(left) == to_money(right)
    mark = "✔" if ok else "✗"
    print(f"   {mark} {label}: {to_money(left):,.2f}{unit}"
          f"{'' if ok else f'  ≠ المخزّن {to_money(right):,.2f}{unit}'}")
    return ok


def trace(number: str, *, with_customer: bool) -> int:
    db = SessionLocal()
    failures = 0
    try:
        inv = db.scalar(select(SalesInvoice).where(
            SalesInvoice.document_number == number))
        if inv is None:
            print(f"مافيش فاتورة رقمها {number}.")
            return 1
        cust = db.get(Customer, inv.customer_id) if inv.customer_id else None

        _head(f"المستند {inv.document_number}")
        print(f"   التاجر      : {cust.name if cust else '—'} (#{inv.customer_id})")
        print(f"   التاريخ     : {inv.invoice_date}")
        print(f"   المصدر      : {'التطبيق' if inv.client_uuid else 'a5 / الويب'}")
        print(f"   الإجمالي    : {to_money(inv.gross):,.2f}")
        print(f"   الخصم       : {inv.combined_pct}%")
        print(f"   الصافي      : {to_money(inv.net):,.2f}")
        print(f"   نقدي/آجل    : {to_money(inv.cash_amount):,.2f} / "
              f"{to_money(inv.credit_amount):,.2f}")

        # ── البنود ───────────────────────────────────────────────────────────
        _head("البنود — والربح على كل سطر")
        lines = db.scalars(select(SalesInvoiceLine).where(
            SalesInvoiceLine.invoice_id == inv.id)).all()
        items = {i.id: i for i in db.scalars(select(Item).where(
            Item.id.in_([ln.item_id for ln in lines] or [-1]))).all()}
        total_lines = ZERO
        total_cost = ZERO
        print(f"   {'الصنف':<30}{'كمية':>9}{'سعر':>11}{'صافي':>13}{'تكلفة':>12}{'ربح':>12}")
        for ln in lines:
            item = items.get(ln.item_id)
            net = to_money(ln.line_total or 0)
            qty = Decimal(str(ln.quantity or 0))
            cost = to_money(Decimal(str(ln.unit_cost or 0)) * qty)
            total_lines += net
            total_cost += cost
            name = (item.name if item else f"#{ln.item_id}")[:28]
            print(f"   {name:<30}{qty:>9,.0f}{to_money(ln.unit_price):>11,.2f}"
                  f"{net:>13,.2f}{cost:>12,.2f}{net - cost:>12,.2f}")
        print(f"   {'':<30}{'':>9}{'':>11}{'―' * 12:>13}{'―' * 11:>12}{'―' * 11:>12}")
        print(f"   {'المجموع':<30}{'':>9}{'':>11}{total_lines:>13,.2f}"
              f"{total_cost:>12,.2f}{total_lines - total_cost:>12,.2f}")
        print()
        # الخصم بيتحسب على مجموع السطور، فالصافي المخزّن لازم يطابق.
        failures += 0 if _check("مجموع السطور = صافي الفاتورة", total_lines, inv.net) else 1

        # ── المخزن ───────────────────────────────────────────────────────────
        _head("الحركة المخزنية — كل سطر خرج من فين")
        moves = db.scalars(select(StockMovement).where(
            StockMovement.source_doc_type == "sales_invoice",
            StockMovement.source_doc_id == inv.id)).all()
        if not moves:
            print("   مافيش حركة مخزنية على المستند ده.")
        out_by_item: dict[int, Decimal] = {}
        for m in moves:
            sign = 1 if m.direction == StockDirection.in_ else -1
            out_by_item[m.item_id] = out_by_item.get(m.item_id, ZERO) + sign * Decimal(
                str(m.quantity))
            item = items.get(m.item_id)
            print(f"   {(item.name if item else str(m.item_id))[:30]:<32}"
                  f"{'خرج' if sign < 0 else 'دخل':<6}{Decimal(str(m.quantity)):>9,.0f}"
                  f"   {m.location_kind.value if m.location_kind else ''} #{m.location_id}")
        print()
        for ln in lines:
            moved = -out_by_item.get(ln.item_id, ZERO)
            want = Decimal(str(ln.quantity or 0)) * Decimal(str(ln.unit_factor or 1))
            if moved != want:
                print(f"   ✗ {(items.get(ln.item_id).name if items.get(ln.item_id) else '')[:28]}"
                      f": اتباع {want} واتحرّك {moved}")
                failures += 1
        if moves:
            print(f"   ✔ كل بند اتحرّك بكميته ({len(lines)} بند)")

        # ── القيد ────────────────────────────────────────────────────────────
        _head("القيد — الطرفين والتوازن")
        if inv.ledger_entry_id is None:
            print("   مافيش قيد. " + ("صافي الفاتورة صفر، فمافيش فلوس تتقيّد — ده صح."
                                       if to_money(inv.net) == ZERO
                                       else "✗ الفاتورة عليها فلوس ومن غير قيد!"))
            if to_money(inv.net) != ZERO:
                failures += 1
        else:
            entry = db.get(LedgerEntry, inv.ledger_entry_id)
            jlines = db.scalars(select(LedgerLine).where(
                LedgerLine.entry_id == entry.id)).all()
            accounts = {a.id: a for a in db.scalars(select(Account).where(
                Account.id.in_([j.account_id for j in jlines]))).all()}
            debit = credit = ZERO
            print(f"   قيد #{entry.id} · {entry.entry_date} · {entry.description or ''}")
            print(f"   {'الحساب':<40}{'مدين':>14}{'دائن':>14}")
            for j in jlines:
                acc = accounts.get(j.account_id)
                amount = to_money(j.amount)
                is_debit = j.direction.value == "debit"
                debit += amount if is_debit else ZERO
                credit += ZERO if is_debit else amount
                name = (acc.name if acc and acc.name else f"#{j.account_id}")[:38]
                print(f"   {name:<40}{amount if is_debit else 0:>14,.2f}"
                      f"{0 if is_debit else amount:>14,.2f}")
            print()
            failures += 0 if _check("مدين = دائن", debit, credit) else 1
            # **المستحق = المقبوض + الآجل، مش = طرف القيد.**
            #
            # التاجر اللي دفع زيادة بيقيّد الفرق لصالحه: فاتورة ٨٬١٤٨٫٥٠ ودفع
            # ٨٬١٥٠ بتنزل ٨٬١٥٠ على الخزنة و١٫٥٠ دائن على حسابه — فطرف القيد
            # ٨٬١٥٠ وهو أكبر من الفاتورة، وده صح. القاعدة اللي بتمسك الحالتين
            # هي دي: المقبوض + الآجل = الصافي + الضريبة.
            failures += 0 if _check(
                "المقبوض + الآجل = الصافي + الضريبة",
                to_money(inv.cash_amount) + to_money(inv.credit_amount),
                to_money(inv.net) + to_money(inv.tax_amount)) else 1

        # ── النقاط ───────────────────────────────────────────────────────────
        _head("النقاط — المحسوب مقابل المسجّل")
        values = {p.item_id: Decimal(str(p.point_value)) for p in db.scalars(
            select(ProductPointValue).where(
                ProductPointValue.item_id.in_([ln.item_id for ln in lines] or [-1]))).all()}
        earned = ZERO
        for ln in lines:
            value = values.get(ln.item_id)
            qty = Decimal(str(ln.quantity or 0))
            item = items.get(ln.item_id)
            if value is None:
                print(f"   {(item.name if item else '')[:32]:<34}"
                      f"{qty:>8,.0f} × (مالوش قيمة نقطة)")
                continue
            earned += value * qty
            print(f"   {(item.name if item else '')[:32]:<34}"
                  f"{qty:>8,.0f} × {value:>8} = {value * qty:>10,.3f}")
        recorded = db.scalar(select(func.coalesce(func.sum(PointRecord.delta), 0)).where(
            PointRecord.sales_invoice_id == inv.id))
        print()
        failures += 0 if _check("النقاط المحسوبة = المسجّلة في الدفتر",
                                earned, recorded, " نقطة") else 1
        if cust:
            purses = points_service.purse_balances(db, cust.id)
            print(f"   رصيد التاجر: معاينات {purses['inspection']:,.3f} · "
                  f"كوبونات {purses['coupon']:,.3f}")

        # ── الكوبونات ────────────────────────────────────────────────────────
        _head("الكوبونات المصروفة مع الفاتورة")
        coupons = db.scalars(select(SalesInvoiceCoupon).where(
            SalesInvoiceCoupon.invoice_id == inv.id)).all()
        if not coupons:
            print("   مافيش دفاتر اتصرفت على المستند ده.")
        for c in coupons:
            print(f"   {c.coupon_kind or '—':<14}من {c.serial_from or '—'} "
                  f"إلى {c.serial_to or '—'}   العدد {c.count or '—'}")

        # ── كشف التاجر ───────────────────────────────────────────────────────
        if with_customer and cust:
            _head(f"كشف حساب {cust.name}")
            accs = db.scalars(select(CustomerAccount).where(
                CustomerAccount.customer_id == cust.id)).all()
            ids = [a.account_id for a in accs if a.account_id]
            if not ids:
                print("   مالوش حساب ذمم.")
            else:
                due, overdue, aging = statement_service.due_summary(db, account_ids=ids)
                print(f"   مطلوب منه        : {aging.debit_open:>14,.2f}")
                print(f"   دفعات مقدّمة     : {aging.credit_open:>14,.2f}")
                print(f"   الصافي المستحق   : {due:>14,.2f}")
                print(f"   منه متأخر        : {overdue:>14,.2f}")
            rets = db.scalars(select(SalesReturn).where(
                SalesReturn.customer_id == cust.id).order_by(
                SalesReturn.return_date.desc()).limit(5)).all()
            if rets:
                print("\n   آخر مرتجعاته:")
                for r in rets:
                    linked = ("مربوط بفاتورة" if r.sales_invoice_id
                              else "مستقل — مش مربوط بفاتورة")
                    print(f"     {r.document_number:<14}{r.return_date}"
                          f"{to_money(r.value):>12,.2f}   {linked}")

        print()
        print(LINE)
        print(f"   النتيجة: {'✔ كل الفحوص عدّت' if not failures else f'✗ {failures} فحص وقع'}")
        print(LINE)
        return 1 if failures else 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        raise SystemExit("استعمال: python -m src.scripts.trace_invoice <رقم المستند> [--customer]")
    raise SystemExit(trace(args[0], with_customer="--customer" in args))
