# -*- coding: utf-8 -*-
"""سطور تكلفتها المحفوظة **إجمالي السطر** مش تكلفة الوحدة.

`unit_cost` معناه تكلفة الوحدة — تكلفة البضاعة المباعة = `الكمية × unit_cost`. وفي
نقل a5 دخلت على بعض السطور قيمة إجمالية، فتكلفة البضاعة على السطر بتتحسب مضروبة في
الكمية مرة زيادة.

## الأصل في a5

فحصنا عمود بعمود في `AzonDt`: قيمنا بتطابق `a_AvPrice`، وde **إجمالي** (متوسط × كمية).
والتكلفة الحقيقية للوحدة عندهم في `EnshPrc`:

    Ord 6505  كمية ٢٠٠   a_AvPrice ١٬٦٦٠٫٠٠٥   EnshPrc ٨٫٣٠
    Ord 6452  كمية ١٠٠   a_AvPrice ٨٣٠٫٠٠٢     EnshPrc ٨٫٢٩
    Ord 6435  كمية  ٧٠   a_AvPrice ٥٨١٫٠٠٢     EnshPrc ٨٫٢٩

والسطر الأول عندنا كان مكتوب عليه تكلفة وحدة ١٬٦٦٠٫٠١ وسعر بيع ١٧٫٥٠ — يعني خسارة
٩٤ ضعف على بيعة مربحة.

## مين بيتصلّح ومين لأ

مش كل سطر — **اللي القسمة بتثبته وبس**. لكل صنف بنحسب سعر الشرا للوحدة من فواتير
الشرا بتاعته (`إجمالي ÷ كمية`)، وبنصلّح السطر لو:

* `unit_cost ÷ الكمية` قريّبة من سعر الشرا ده، **و**
* `unit_cost` نفسها بعيدة عنه.

يعني القسمة بتوصّل لرقم الصنف الحقيقي والقيمة الحالية لأ. على داتا العميل ده بيطلّع
١٬٣٣٨ سطر من ٣٦٬٣٨٣ — والـ٣٥٬٠٠٠ التانيين تكلفتهم صح وبتتساب. و٤٥ سطر لا ده ولا ده،
بيتسابوا ويتقال عليهم.

    python -m src.scripts.fix_line_unit_cost            # عرض بس
    python -m src.scripts.fix_line_unit_cost --apply    # بيكتب
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.catalog import Item
from src.models.purchasing import PurchaseInvoiceLine
from src.models.sales import SalesInvoiceLine

# السماحية حوالين سعر الشرا: نص السعر أو جنيه، أيهما أكبر. واسعة عن قصد — الهدف
# نفرّق بين «رقم الوحدة» و«الرقم × الكمية»، مش نطابق قرش بقرش.
def _tol(buy: Decimal) -> Decimal:
    return max(buy * Decimal("0.5"), Decimal("1"))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        buy = {
            iid: Decimal(str(total)) / Decimal(str(qty))
            for iid, total, qty in db.execute(
                select(PurchaseInvoiceLine.item_id,
                       func.sum(PurchaseInvoiceLine.line_total),
                       func.sum(PurchaseInvoiceLine.quantity))
                .where(PurchaseInvoiceLine.quantity > 0)
                .group_by(PurchaseInvoiceLine.item_id)
            ).all() if qty and Decimal(str(qty)) > 0
        }

        rows = db.scalars(
            select(SalesInvoiceLine)
            .where(SalesInvoiceLine.unit_cost > 0, SalesInvoiceLine.quantity > 1)
        ).all()

        fix, neither = [], []
        for ln in rows:
            ref = buy.get(ln.item_id)
            if ref is None or ref <= 0:
                continue
            qty = Decimal(str(ln.quantity))
            cost = Decimal(str(ln.unit_cost))
            per = cost / qty
            tol = _tol(ref)
            if abs(per - ref) <= tol and abs(cost - ref) > tol:
                fix.append((ln, to_money(per), ref))
            elif abs(cost - ref) > tol and abs(per - ref) > tol:
                neither.append((ln, ref))

        names = {i.id: f"{i.code} — {i.name}" for i in db.scalars(
            select(Item).where(Item.id.in_({l.item_id for l, _p, _r in fix} |
                                           {l.item_id for l, _r in neither}))).all()}
        by_item: dict[int, int] = {}
        for ln, _p, _r in fix:
            by_item[ln.item_id] = by_item.get(ln.item_id, 0) + 1

        print(f"سطور هتتصلّح: {len(fix)} | سطور لا ده ولا ده: {len(neither)}")
        print()
        print(f"{'الصنف':<34} {'سطور':>6} {'مثال: كان':>12} {'يبقى':>10} {'شرا الوحدة':>12}")
        seen = set()
        for ln, per, ref in sorted(fix, key=lambda f: -by_item[f[0].item_id]):
            if ln.item_id in seen:
                continue
            seen.add(ln.item_id)
            print(f"{names.get(ln.item_id, ln.item_id)[:34]:<34} {by_item[ln.item_id]:>6} "
                  f"{ln.unit_cost!s:>12} {per!s:>10} {to_money(ref)!s:>12}")
            if len(seen) >= 10:
                break
        if neither:
            print()
            print(f"⚠ {len(neither)} سطر لا القيمة ولا القسمة بتوصّل لسعر الشرا — بيتسابوا:")
            for ln, ref in neither[:5]:
                print(f"   {names.get(ln.item_id, ln.item_id)[:30]} كمية {ln.quantity} "
                      f"تكلفة {ln.unit_cost} وشرا الوحدة {to_money(ref)}")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        for ln, per, _ref in fix:
            ln.unit_cost = per
        db.commit()
        print()
        print(f"اتكتب: {len(fix)} سطر")
        left = db.scalar(select(func.count(SalesInvoiceLine.id)).where(
            SalesInvoiceLine.unit_cost > SalesInvoiceLine.unit_price * 3,
            SalesInvoiceLine.unit_price > 0))
        print(f"الباقي تكلفته أعلى من ٣ أضعاف سعر البيع: {left}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
