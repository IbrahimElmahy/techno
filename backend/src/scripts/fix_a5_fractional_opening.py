# -*- coding: utf-8 -*-
"""الكمية الكسرية في الرصيد الافتتاحي — بترجع من a5.

    python -m src.scripts.fix_a5_fractional_opening --dir /tmp/a5fix --prefix FC-
    python -m src.scripts.fix_a5_fractional_opening --dir ... --prefix FC- --yes

آخر حتة من نفس العلّة: التصدير كان بياخد `n_count_unit` وحده وبيسيب الكسر اللي في
`n_count_single`. الشرح الكامل في `fix_a5_fractional_quantities`.

الافتتاحي أبسط من غيره — **حركة واحدة لكل (صنف × مخزن)** بنوع مستند `a5_opening`،
فالمطابقة عليهم مباشرةً من غير أي ترقيم ولا ترتيب. والسكربت بيعيد نفس قراءة
`import_a5_phase2`: أول قيمة مش صفر من التلات أعمدة، والسالب حركة خروج.

بيتشغّل على `a5_open.tsv` **المعاد تصديره بالاستعلام المصحّح**.
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_qty
from src.models.catalog import Item
from src.models.stock import StockDirection, StockMovement
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read

OPENING_DOC = "a5_opening"
ZERO = Decimal("0")


def main() -> None:
    ap = argparse.ArgumentParser(description="ترجيع الكسر في الرصيد الافتتاحي")
    ap.add_argument("--dir", required=True, help="مجلد فيه a5_open.tsv المعاد تصديره")
    ap.add_argument("--prefix", default="FC-")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=30)
    args = ap.parse_args()

    opens = _read(os.path.join(args.dir, "a5_open.tsv"))
    if not opens:
        print("مالقيتش a5_open.tsv")
        return

    db = SessionLocal()
    try:
        by_code = {i.code: i for i in db.scalars(select(Item)).all()}
        by_name: dict[str, Item] = {}
        for i in by_code.values():
            by_name.setdefault(i.name, i)
        wh_by_name = {w.name: w for w in db.scalars(select(Warehouse)).all()}

        # حركة الافتتاحي لكل (صنف × مخزن) — دي اللي بتتصلّح.
        moves: dict[tuple[int, int], StockMovement] = {}
        for mv in db.scalars(select(StockMovement)
                             .where(StockMovement.source_doc_type == OPENING_DOC)
                             .order_by(StockMovement.id)).all():
            moves.setdefault((mv.item_id, mv.location_id), mv)

        seen: set[tuple[int, int]] = set()
        changed: list[tuple] = []
        skipped: dict[str, int] = defaultdict(int)

        for r in opens:
            if len(r) < 7:
                continue
            code, name = _clean(r[0]), _clean(r[1])
            it = by_code.get(f"{args.prefix}{code}") or by_name.get(name)
            if it is None:
                skipped["صنف مش موجود"] += 1
                continue
            wh = wh_by_name.get(_clean(r[2]) or _clean(r[3]))
            if wh is None:
                skipped["مخزن مش موجود"] += 1
                continue
            if (it.id, wh.id) in seen:
                # نفس قاعدة الاستيراد: أول سطر للزوج هو اللي دخل، والباقي اتخطّى.
                continue
            qty = _money(r[4]) or _money(r[5]) or _money(r[6])
            if qty == 0:
                continue
            seen.add((it.id, wh.id))

            mv = moves.get((it.id, wh.id))
            if mv is None:
                skipped["مالهاش حركة افتتاحية عندنا"] += 1
                continue
            new = to_qty(abs(qty))
            old = to_qty(mv.quantity)
            if new == old:
                continue
            if abs(new - old) >= 1:
                skipped["فرق أكبر من وحدة — مطابقة مشكوك فيها"] += 1
                continue
            want_out = qty < 0
            if (mv.direction == StockDirection.out) != want_out:
                skipped["اتجاه الحركة مختلف"] += 1
                continue
            changed.append((it.name, wh.name, old, new))
            if args.yes:
                mv.quantity = new

        print(f"{'أرصدة افتتاحية اتصلّحت':<34}{len(changed):>8,}")
        if skipped:
            print("\nاتخطّى:")
            for reason, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
                print(f"   {n:>6} × {reason}")
        if changed:
            print(f"\n{'كان':>12}{'بقى':>12}  الصنف — المخزن")
            for nm, store, old, new in changed[: args.limit]:
                print(f"{float(old):>12,.3f}{float(new):>12,.3f}  {nm[:32]} — {store[:22]}")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتصلّح {len(changed):,} رصيد افتتاحي.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
