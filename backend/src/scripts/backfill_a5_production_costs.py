# -*- coding: utf-8 -*-
"""تكلفة أوامر التشغيل المنقولة — بتيجي من a5، مش من متوسط النهارده.

    python -m src.scripts.backfill_a5_production_costs --map /tmp/a5fix/a5_mfg_cost.tsv
    python -m src.scripts.backfill_a5_production_costs --map ... --yes

---------------------------------------------------------------------------
**ليه كانت فاضية.** تصدير التصنيع الأصلي (`a5_mfg.tsv`) فيه كمية ومخزن وبس، فالـ٢٠٢
أمر المنقولين دخلوا بتكلفة صفر — والشاشة بتقول «منقول بغير تكلفة» عشان الصفر مايتقريش
على إنه إنتاج مجاني.

**بس a5 مسجّل التكلفة فعلاً**، في عمودين على سطر التصنيع نفسه: `item_price` تكلفة
الوحدة و`a_price` إجمالي السطر. `exp_mfg_cost.sql` بيطلّعهم مجمّعين.

**ولازم تيجي من هناك مش من عندنا.** حساب متوسط النهارده وحطّه على إنتاج حصل من سنة
بيطلّع رقم **يبان صح وتاريخه كداب**: الخامة اللي اتشرت بعدها بضعف السعر بتخلّي تشغيلة
قديمة تبان خسرانة، وكل تقرير ربح بعدها تخمين. الرقم اللي في a5 هو اللي المصنع اشتغل
بيه ساعتها.

---------------------------------------------------------------------------
**والمطابقة بـ(الأمر، النوع، الصنف) — مش بترتيب السطر.**

ترتيب `a5_mfg.tsv` هو اللي رقّم العمليات عندنا (`FC-MFG-<ref>-<n>`)، وأي كشف بيتطابق
بالترتيب بيبقى رهينة إن الملف يتصدّر بنفس الترتيب. المفتاح هنا مالوش علاقة بالترتيب:
قيمة وكمية كل صنف في كل أمر، وتكلفة الوحدة بتتقسّم منهم.

**وبتتضرب في كميتنا إحنا مش كمية a5.** الاتنين المفروض واحد (اتطابقوا بعد إصلاح
الكسور)، بس لو اختلفوا فالمخزون عندنا اتحرك بكميتنا — فالتكلفة لازم تتبعه، وإلا
الورقة بتقول قيمة مش قد البضاعة اللي دخلت فعلاً.

⛔ **التكلفة بس.** ولا كمية بتتغيّر، ولا حركة مخزون بتتكتب أو تتعدّل.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import ZERO, to_money
from src.lib import production
from src.models.catalog import Item
from src.models.manufacturing import ProductionOrder
from src.scripts.import_a5 import _clean, _money, _read

#: أعمدة `a5_mfg_cost.tsv`
(C_TYPE, C_REF, C_CODE, C_VALUE, C_QTY) = range(5)

PRODUCE, CONSUME = "4", "9"


def main() -> None:
    ap = argparse.ArgumentParser(description="تكلفة أوامر التشغيل المنقولة من a5")
    ap.add_argument("--map", required=True, help="كشف التكلفة a5_mfg_cost.tsv")
    ap.add_argument("--prefix", default="FC-", help="بادئة أكواد الفرع")
    ap.add_argument("--source", default="a5", help="قيمة `imported_from`")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    # (أمر، نوع، كود) -> تكلفة الوحدة
    unit_cost: dict[tuple[str, str, str], Decimal] = {}
    for r in _read(args.map):
        if len(r) < 5:
            continue
        qty = _money(r[C_QTY])
        if qty <= ZERO:
            continue
        unit_cost[(_clean(r[C_REF]), _clean(r[C_TYPE]), _clean(r[C_CODE]))] = (
            _money(r[C_VALUE]) / qty)
    if not unit_cost:
        raise SystemExit("الكشف فاضي — اتأكد من الملف.")

    db = SessionLocal()
    try:
        codes = {i.id: (i.code or "") for i in db.scalars(select(Item)).all()}
        orders = db.scalars(select(ProductionOrder)
                            .where(ProductionOrder.imported_from == args.source)
                            .order_by(ProductionOrder.id)).all()

        done: list[tuple] = []
        missing: dict[str, int] = defaultdict(int)
        prefix_len = len(args.prefix)

        for o in orders:
            # `WO-A5-FC-MFG-3537` → `3537`
            ref = (o.document_number or "").rsplit("-", 1)[-1]
            by_line: dict[int, Decimal] = {}

            for m in o.materials:
                code = codes.get(m.item_id, "")
                bare = code[prefix_len:] if code.startswith(args.prefix) else code
                u = unit_cost.get((ref, CONSUME, bare))
                if u is None:
                    missing["خامة مالهاش تكلفة في الكشف"] += 1
                    continue
                if args.yes:
                    m.unit_cost = to_money(u)
                    m.line_cost = production.line_cost(m.quantity, m.unit_cost)
                cost = production.line_cost(m.quantity, to_money(u))
                if m.product_line_id is not None:
                    by_line[m.product_line_id] = by_line.get(m.product_line_id, ZERO) + cost

            material_cost = ZERO
            for p in o.products:
                code = codes.get(p.item_id, "")
                bare = code[prefix_len:] if code.startswith(args.prefix) else code
                u = unit_cost.get((ref, PRODUCE, bare))
                if u is None:
                    missing["منتج مالوش تكلفة في الكشف"] += 1
                    continue
                # **تكلفة المنتج من a5 مباشرةً.** خامات الأمر المنقول مش منسوبة لمنتج
                # (المصدر مابيقولش مين لمين)، فجمعها على المنتج مستحيل — وa5 حاسبها
                # وكاتبها على سطر الإنتاج نفسه.
                total = production.line_cost(p.quantity, to_money(u))
                if args.yes:
                    p.unit_cost = to_money(u)
                    p.material_cost = to_money(by_line.get(p.id, total))
                    p.total_cost = to_money(total)
                material_cost += total

            if material_cost > ZERO:
                done.append((o.document_number, to_money(material_cost)))
                if args.yes:
                    o.material_cost = to_money(material_cost)
                    o.total_cost = to_money(material_cost + o.expense_amount)

        print(f"{'أوامر منقولة':<34}{len(orders):>10,}")
        print(f"{'تكلفتها اتحسبت':<34}{len(done):>10,}")
        if missing:
            print("\nمالقيتش تكلفة لـ:")
            for reason, n in sorted(missing.items(), key=lambda kv: -kv[1]):
                print(f"   {n:>6} × {reason}")
        if done:
            total = sum((v for _d, v in done), ZERO)
            print(f"\n{'إجمالي التكلفة':<34}{float(total):>14,.2f} ج.م")
            print(f"\n{'المستند':<24}{'التكلفة':>16}")
            for doc, v in done[: args.limit]:
                print(f"{doc:<24}{float(v):>16,.2f}")
            if len(done) > args.limit:
                print(f"   … و{len(done) - args.limit:,} أمر تاني")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتحسبت تكلفة {len(done):,} أمر.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
