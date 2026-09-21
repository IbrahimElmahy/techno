# -*- coding: utf-8 -*-
"""الكمية الكسرية في حركة التصنيع — بترجع من a5.

    python -m src.scripts.fix_a5_fractional_manufacturing --dir /opt/techno/a5factory \
        --map /tmp/a5fix/a5_mfg_qty.tsv --branch السادات --prefix FC-
    python -m src.scripts.fix_a5_fractional_manufacturing --dir ... --map ... --yes

نفس علّة `fix_a5_fractional_quantities` — الكمية عند a5 في عمودين والتصدير أخد
الوحدات وساب الكسر — بس على حركة التصنيع (`AznType` ٤ و٩)، اللي بتدخل بسكربت
لوحدها. وفرع المصنع وحده هو اللي فيه كسور، و٢٬٤٠٤ سطر تصنيع متأثرين.

**وفيهم نوعين مختلفين تماماً:**

* **١٬٨١٩ سطر كميته ناقصة** — دخل بـ٢ وهو ٢٫١٠٩.
* **٥٨٥ سطر مادخلش خالص** — كميته أقل من وحدة (نص كيلو، عُشر لتر)، فالوحدات عنده
  **صفر** والكسر هو الكمية كلها. والاستيراد بيتخطّى أي سطر بصفر (`qty <= 0`)، فالخامة
  دي اتستهلكت في المصنع ومااتخصمتش من المخزن ولا مرة.

**والترقيم هو اللي بيربط.** عملية التصنيع عندنا رقمها `FC-MFG-<أمر التشغيل>-<ترتيب
السطر>`، والترتيب ده جاي من ترتيب سطور `a5_mfg.tsv` الأصلي. فإعادة تصدير الملف
بترتيب مختلف بتزحلق كل الأرقام. عشان كده السكربت بيقرا **نفس الملف الأصلي** عشان
يطلّع الأرقام، وبياخد الكمية المصحّحة من كشف مطابقة منفصل (`exp_mfg_qty.sql`)
مفتاحه (أمر التشغيل، النوع، كود الصنف، المخزنين، الكمية القديمة).

والترقيم بيعدّ **كل** السطور بما فيهم اللي بصفر، فالسطر اللي مادخلش رقمه محجوز له
وفاضي — وده اللي بيخلّي السطور الناقصة تتكتب برقمها الصح.

وكل تعديل بيمشي على العملية وحركتها مع بعض — الرصيد مشتق من الحركة مش من العملية.
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
from src.models.manufacturing import ManufactureOpType, ManufacturingOp
from src.models.org import Branch
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.user import User
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read
from src.scripts.import_a5_manufacturing import (
    CONSUME, M_AZN, M_CODE, M_DATE, M_IN, M_NAME, M_OUT, M_QTY, M_REF, M_TYPE,
    PRODUCE, _date)

ZERO = Decimal("0")

#: أعمدة كشف المطابقة `a5_mfg_qty.tsv`
(Q_TYPE, Q_REF, Q_CODE, Q_IN, Q_OUT, Q_OLD, Q_NEW) = range(7)


def _key(t: str, ref: str, code: str, sin: str, sout: str, qty: Decimal) -> tuple:
    return (_clean(t), _clean(ref), _clean(code), _clean(sin), _clean(sout), qty)


def main() -> None:
    ap = argparse.ArgumentParser(description="ترجيع الكمية الكسرية في التصنيع")
    ap.add_argument("--dir", required=True, help="مجلد فيه a5_mfg.tsv الأصلي")
    ap.add_argument("--map", required=True, help="كشف المطابقة a5_mfg_qty.tsv")
    ap.add_argument("--branch", default="السادات")
    ap.add_argument("--prefix", default="FC-")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=12)
    args = ap.parse_args()

    # ---------------------------------------------------------------- الكشف
    #
    # المفتاح بيتكرر أحياناً: نفس الصنف اتصرف مرتين في نفس الأمر من نفس المخزن بنفس
    # عدد الوحدات والكسر مختلف. بنسيب الكميات في **قايمة بترتيبها** وبناخد منها
    # واحدة ورا التانية — والتوزيع ده مايغيّرش الرصيد: الأمر والصنف والمخزن واحد،
    # فمجموع المصروف هو هو مهما اتبدّلت الكسور بين السطرين. اللي بيفرق بس هو أنهي
    # سطر شايل أنهي كسر، ومافيش في a5 حاجة تحسمها.
    fixes: dict[tuple, list] = defaultdict(list)
    for r in _read(args.map):
        if len(r) < 7:
            continue
        fixes[_key(r[Q_TYPE], r[Q_REF], r[Q_CODE], r[Q_IN], r[Q_OUT],
                   _money(r[Q_OLD]))].append(_money(r[Q_NEW]))
    taken: dict[tuple, int] = defaultdict(int)
    shared = 0

    # ------------------------------------------------- الملف الأصلي (الترقيم)
    rows = [r for r in _read(os.path.join(args.dir, "a5_mfg.tsv"))
            if len(r) >= 9 and r[M_TYPE] in (PRODUCE, CONSUME)]
    groups: dict[str, list[list[str]]] = defaultdict(list)
    for r in rows:
        groups[_clean(r[M_REF]) or f"AZN{_clean(r[M_AZN])}"].append(r)

    db = SessionLocal()
    try:
        branch = db.scalars(select(Branch).where(Branch.name == args.branch)).first()
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{args.branch}».")
        actor = db.scalars(select(User).order_by(User.id)).first()
        wh = {w.name: w for w in db.scalars(
            select(Warehouse).where(Warehouse.branch_id == branch.id)).all()}
        by_code = {i.code: i for i in db.scalars(select(Item)).all()}
        by_name: dict[str, Item] = {}
        for i in by_code.values():
            by_name.setdefault(i.name, i)

        updated: list[tuple] = []
        created: list[tuple] = []
        skipped: dict[str, int] = defaultdict(int)

        for ref, lines in sorted(groups.items(), key=lambda kv: kv[1][0][M_DATE]):
            for n, r in enumerate(lines, 1):
                old = _money(r[M_QTY])
                k = _key(r[M_TYPE], ref, r[M_CODE], r[M_IN], r[M_OUT], old)
                cands = fixes.get(k)
                if not cands:
                    continue
                seat = taken[k]
                if seat >= len(cands):
                    skipped["سطور أكتر من اللي في الكشف"] += 1
                    continue
                taken[k] = seat + 1
                if len(cands) > 1:
                    shared += 1
                new = to_qty(cands[seat])
                if new <= ZERO or new == to_qty(old):
                    continue

                doc = f"{args.prefix}MFG-{ref}-{n:03d}"
                produce = r[M_TYPE] == PRODUCE
                code, name = _clean(r[M_CODE]), _clean(r[M_NAME])
                item = by_code.get(f"{args.prefix}{code}") or by_name.get(name)
                if item is None:
                    skipped["صنف مش موجود"] += 1
                    continue
                w = wh.get(_clean(r[M_IN]) if produce else _clean(r[M_OUT]))
                if w is None:
                    skipped["مخزن مش موجود"] += 1
                    continue

                op = db.scalar(select(ManufacturingOp)
                               .where(ManufacturingOp.document_number == doc))

                # -------------------------------------------- سطر موجود: تعديل
                if op is not None:
                    if op.item_id != item.id:
                        # الرقم ده لصنف تاني — يبقى الترقيم مااتطابقش، وسيبه.
                        skipped["الرقم على صنف مختلف"] += 1
                        continue
                    if to_qty(op.quantity) != to_qty(old):
                        skipped["الكمية المسجّلة مش القديمة — اتعدّلت قبل كده"] += 1
                        continue
                    updated.append((doc, item.name, to_qty(op.quantity), new))
                    if args.yes:
                        op.quantity = new
                        if op.stock_movement_id:
                            mv = db.get(StockMovement, op.stock_movement_id)
                            if mv is not None:
                                mv.quantity = new
                            else:
                                skipped["الحركة المكتوبة على العملية مش موجودة"] += 1
                    continue

                # ------------------------------- سطر مادخلش أصلاً: يتكتب برقمه
                if to_qty(old) > ZERO:
                    # مش سطر صفر، يبقى غيابه سببه تاني (صنف/مخزن وقت الاستيراد).
                    skipped["العملية مش موجودة والكمية القديمة مش صفر"] += 1
                    continue
                created.append((doc, item.name, new))
                if not args.yes:
                    continue
                from src.services import stock_service

                new_op = ManufacturingOp(
                    document_number=doc,
                    op_type=ManufactureOpType.produce if produce else ManufactureOpType.consume,
                    item_id=item.id, location_kind=LocationKind.warehouse,
                    location_id=w.id, quantity=new, actor_user_id=actor.id)
                db.add(new_op)
                db.flush()
                mv = stock_service.post_movement(
                    db, item_id=item.id, location_kind=LocationKind.warehouse,
                    location_id=w.id,
                    movement_type="production_in" if produce else "consumption_out",
                    direction=StockDirection.in_ if produce else StockDirection.out,
                    quantity=new, actor_user_id=actor.id,
                    source_doc_type="manufacturing", source_doc_id=new_op.id,
                    allow_negative=True)
                # نفس سبب `import_a5_manufacturing`: العملية مالهاش عمود تاريخ،
                # ومن غير السطر ده شغل سنة بيتحط في يوم النهارده.
                mv.movement_date = _date(r[M_DATE]) or mv.movement_date
                new_op.stock_movement_id = mv.id

        print(f"{'عمليات كميتها اتصلّحت':<40}{len(updated):>8,}")
        if shared:
            print(f"{'  منهم بمفتاح مكرر (الرصيد واحد)':<40}{shared:>8,}")
        print(f"{'عمليات كانت ناقصة واتكتبت':<40}{len(created):>8,}")
        if skipped:
            print("\nاتخطّى:")
            for reason, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
                print(f"   {n:>6} × {reason}")

        if updated:
            print(f"\n{'المستند':<22}{'كان':>11}{'بقى':>11}  الصنف")
            for doc, nm, old_q, new_q in updated[: args.limit]:
                print(f"{doc:<22}{float(old_q):>11,.3f}{float(new_q):>11,.3f}  {nm[:34]}")
            if len(updated) > args.limit:
                print(f"   … و{len(updated) - args.limit:,} عملية تانية")
        if created:
            print(f"\n{'المستند':<22}{'الكمية':>11}  الصنف (كانت ناقصة خالص)")
            for doc, nm, q in created[: args.limit]:
                print(f"{doc:<22}{float(q):>11,.3f}  {nm[:34]}")
            if len(created) > args.limit:
                print(f"   … و{len(created) - args.limit:,} عملية تانية")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتصلّح {len(updated):,} واتكتب {len(created):,}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
