# -*- coding: utf-8 -*-
"""السطر اللي كميته أقل من وحدة — دخل صفر فاتشال، والمستند كله فضل غلط.

    python -m src.scripts.fix_a5_missing_subunit_lines --dir /tmp/a5fix --prefix FC-
    python -m src.scripts.fix_a5_missing_subunit_lines --dir ... --prefix FC- --yes

---------------------------------------------------------------------------
**ليه السكربت ده موجود، و`fix_a5_fractional_quantities` ماكفاش.**

التصدير القديم كان بياخد `n_count_unit` وحده فالكسر بيضيع. والسطر اللي كميته **أقل
من وحدة** (٠٫٩ لفة، ٠٫٥٥ كيس) وحداته **صفر**، والاستيراد بيتخطّى أي سطر بصفر — يعني
السطر ده مادخلش أصلاً.

و`fix_a5_fractional_quantities` بيطابق **بالترتيب جوّه المستند**، وبيسيب أي مستند
عدد سطوره مش زي a5 — عن قصد، لأن التخمين ساعتها بيحطّ كمية صنف على صنف تاني. لكن
المستند اللي فيه سطر ناقص **عدده مختلف بالتعريف**، فبيتخطّى كله: لا السطر الناقص
بيتكتب، **ولا باقي سطوره بتتصلّح**. فاتورة فيها ٠٫٩ لفة ناقصة بيفضل فيها كمان «خام
بولى بروبلين ٤٩» وهو ٤٩٫٦٥.

المقاس: **١٥ مستند** (١٤ فاتورة بيع وإذن إضافة) فيهم **١٨ سطر ناقص**، وفروقهم
كانت آخر ٧ أصناف مختلفة عن a5 بعد لحاق التصنيع.

---------------------------------------------------------------------------
**والمطابقة هنا بكود الصنف مش بالترتيب** — ودي الحاجة الوحيدة اللي بتخلّي المستند
الناقص قابل للإصلاح أصلاً. وبشروط، أي واحد فيهم يسقط يخلّي المستند يتساب:

* الكود مايتكررش في سطور a5 ولا في سطورنا — التكرار معناه إن الكود مش مفتاح.
* سطورنا **جزء من** سطور a5. سطر عندنا مش عند a5 معناه إن حاجة تانية حصلت، والسكربت
  ده مالوش دعوة بيها.
* السطر الناقص كميته **أقل من واحد صحيح** — ده سبب غيابه. أي كمية أكبر معناها إن
  الاستيراد سابه لسبب تاني (صنف أو مخزن مش موجود) والكتابة ساعتها بتخفي المشكلة.
* الفرق على السطر الموجود **أقل من وحدة** — نفس حارس السكربت الأصلي: أكبر من كده
  يبقى المطابقة وقعت على سطر تاني.

**ورأس المستند مابيتلمسش.** الإجمالي والخصم والضريبة بتتقرا من رأس a5 وقت النقل، مش
من مجموع السطور — يعني الرقم في الفاتورة كان مظبوط من الأول، اللي كان ناقص هو السطر
وحركته. وإذن الإضافة وحده ليه `total_cost` مجموع سطوره، فبيتزوّد بتكلفة السطر الجديد.

**والأنواع اللي ليها بنّاء هنا نوعين بس** — فاتورة البيع وإذن المخزن — لأن دول اللي
الداتا فيهم. أي نوع تاني بيظهر في الكشف على إنه **محتاج بنّاء**، مابيتخمّنش: سطر
مردود أو شرا له أعمدته وحركته، وكتابته بالقياس بتحط رقم في مكان غلط بصمت.
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money, to_qty
from src.lib import discounts
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse
from src.scripts.fix_a5_fractional_quantities import SPECS, _fold_transfer, _load_specs
from src.scripts.import_a5 import _clean, _money, _read
from src.scripts.import_a5_docs import (
    L_CODE, L_COST, L_DATE, L_IN, L_JUST, L_OUT, L_PRICE, L_QTY, L_TOTAL, L_TYPE,
    _date, _doc_key)

ZERO = Decimal("0")


def _add_sale_line(db, head, item, wh, qty, price, total, cost, actor_id):
    """سطر فاتورة بيع + حركته — نفس اللي `import_a5_docs._sale` بيكتبه بالحرف."""
    from src.models.sales import SalesInvoiceLine
    from src.services import stock_service

    mv = stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse, location_id=wh.id,
        movement_type="sale", direction=StockDirection.out, quantity=qty,
        source_doc_type="sales_invoice", source_doc_id=head.id,
        actor_user_id=actor_id, allow_negative=True)
    db.add(SalesInvoiceLine(
        invoice_id=head.id, item_id=item.id, quantity=qty, unit_price=price,
        line_total=total, discount_pct=discounts.implied_pct(qty * price, total),
        location_kind=LocationKind.warehouse, location_id=wh.id,
        unit_cost=cost or None))
    return mv


def _add_permit_line(db, head, item, wh, qty, price, total, cost, actor_id):
    """سطر إذن مخزن + حركته. الاتجاه من نوع الإذن نفسه مش من الملف."""
    from src.models.stock_permit import PermitKind, StockPermitLine
    from src.services import stock_service

    receipt = head.kind == PermitKind.receipt
    mv = stock_service.post_movement(
        db, item_id=item.id, location_kind=LocationKind.warehouse, location_id=wh.id,
        movement_type="permit",
        direction=StockDirection.in_ if receipt else StockDirection.out,
        quantity=qty, source_doc_type="stock_permit", source_doc_id=head.id,
        actor_user_id=actor_id, allow_negative=True)
    db.add(StockPermitLine(permit_id=head.id, item_id=item.id, quantity=qty,
                           line_cost=total, stock_movement_id=mv.id))
    # الإذن وحده إجماليه مجموع سطوره — مش جاي من رأس a5 زي الفاتورة.
    head.total_cost = to_money(Decimal(str(head.total_cost or 0)) + total)
    return mv


#: نوع المستند عندنا → بنّاء السطر الناقص.
BUILDERS = {"sales_invoice": _add_sale_line, "stock_permit": _add_permit_line}

#: نوع a5 → العمود اللي فيه المخزن. نفس اللي `import_a5_docs` ماشي عليه: البضاعة
#: الخارجة بتتقرا من `StoreOut` والداخلة من `StoreIn`.
STORE_COL = {"7": L_OUT, "2": L_IN, "1": L_IN, "11": L_OUT, "6": L_OUT}


def main() -> None:
    ap = argparse.ArgumentParser(description="كتابة السطور اللي كميتها أقل من وحدة")
    ap.add_argument("--dir", required=True, help="مجلد فيه a5_lines.tsv (التصدير المصحّح)")
    ap.add_argument("--prefix", default="FC-")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=40)
    args = ap.parse_args()

    _load_specs()
    rows = _read(os.path.join(args.dir, "a5_lines.tsv"))
    if not rows:
        raise SystemExit("مالقيتش a5_lines.tsv")

    by_doc: dict[tuple[str, str], list[list[str]]] = defaultdict(list)
    for r in rows:
        t = _clean(r[L_TYPE])
        if t in SPECS:
            by_doc[(t, _doc_key(r))].append(r)

    db = SessionLocal()
    try:
        from src.models.user import User
        actor = db.scalars(select(User).order_by(User.id)).first()
        by_code = {i.code: i for i in db.scalars(select(Item)).all()}
        wh_by_name = {w.name: w for w in db.scalars(select(Warehouse)).all()}

        created: list[tuple] = []
        fixed: list[tuple] = []
        docs: set[str] = set()
        skipped: dict[str, int] = defaultdict(int)

        for (t, key), a5_rows in by_doc.items():
            letter, HeadM, LineM, fk, doc_type = SPECS[t]
            doc_no = f"{args.prefix}{letter}{key}"
            head = db.scalar(select(HeadM).where(HeadM.document_number == doc_no))
            if head is None:
                continue
            src = (_fold_transfer(a5_rows) if t == "6"
                   else sorted(a5_rows, key=lambda r: int(r[L_JUST] or 0)))
            wanted = [r for r in src if to_qty(_money(r[L_QTY])) > ZERO]
            ours = db.scalars(select(LineM).where(fk == head.id)
                              .order_by(LineM.id)).all()
            if len(wanted) == len(ours):
                continue          # ده شغل `fix_a5_fractional_quantities`

            # --- الشروط اللي بتخلّي المطابقة بالكود مسموحة -------------------
            a5_by_item: dict[int, list[list[str]]] = defaultdict(list)
            unknown = False
            for r in wanted:
                it = by_code.get(f"{args.prefix}{_clean(r[L_CODE])}")
                if it is None:
                    unknown = True
                    break
                a5_by_item[it.id].append(r)
            if unknown:
                skipped["صنف مش موجود عندنا"] += 1
                continue
            if any(len(v) > 1 for v in a5_by_item.values()):
                skipped["كود متكرر في سطور a5 — مش مفتاح"] += 1
                continue
            ours_by_item: dict[int, list] = defaultdict(list)
            for ln in ours:
                ours_by_item[ln.item_id].append(ln)
            if any(len(v) > 1 for v in ours_by_item.values()):
                skipped["كود متكرر في سطورنا — مش مفتاح"] += 1
                continue
            if set(ours_by_item) - set(a5_by_item):
                skipped["عندنا سطر مش عند a5 — حاجة تانية حصلت"] += 1
                continue
            if doc_type not in BUILDERS:
                skipped[f"محتاج بنّاء سطر ({doc_type})"] += 1
                continue
            store_col = STORE_COL.get(t, L_IN)

            # --- (١) الموجود: الكسر بيرجع، (٢) الناقص: بيتكتب ----------------
            moves: dict[int, list[StockMovement]] = defaultdict(list)
            for mv in db.scalars(select(StockMovement)
                                 .where(StockMovement.source_doc_type == doc_type,
                                        StockMovement.source_doc_id == head.id)
                                 .order_by(StockMovement.id)).all():
                moves[mv.item_id].append(mv)

            bad = False
            plan_fix: list[tuple] = []
            plan_new: list[tuple] = []
            for iid, a5_lines in a5_by_item.items():
                r = a5_lines[0]
                new_qty = to_qty(_money(r[L_QTY]))
                mine = ours_by_item.get(iid)
                if mine:
                    old_qty = to_qty(mine[0].quantity)
                    if new_qty == old_qty:
                        continue
                    if abs(new_qty - old_qty) >= 1:
                        bad = True
                        break
                    plan_fix.append((mine[0], old_qty, new_qty))
                else:
                    # غيابه سببه إن وحداته صفر. أي كمية ≥ ١ يبقى السبب تاني.
                    if new_qty >= 1:
                        bad = True
                        break
                    plan_new.append((r, new_qty))
            if bad:
                skipped["فرق أكبر من وحدة — مطابقة مشكوك فيها"] += 1
                continue
            if not plan_fix and not plan_new:
                continue

            docs.add(doc_no)
            for ln, old_qty, new_qty in plan_fix:
                fixed.append((doc_no, ln.item_id, old_qty, new_qty))
                if not args.yes:
                    continue
                ln.quantity = new_qty
                if hasattr(ln, "discount_pct") and getattr(ln, "unit_price", None) is not None:
                    gross = to_money(new_qty * Decimal(str(ln.unit_price)))
                    ln.discount_pct = discounts.implied_pct(gross, ln.line_total)
                # الرصيد مشتق من الحركة، مش من السطر — فالاتنين بيتحرّكوا مع بعض.
                ids = [getattr(ln, f, None) for f in
                       ("out_movement_id", "in_movement_id", "stock_movement_id")]
                ids = [i for i in ids if i]
                if ids:
                    for mv_id in ids:
                        mv = db.get(StockMovement, mv_id)
                        if mv is not None:
                            mv.quantity = new_qty
                        else:
                            skipped["الحركة المكتوبة على السطر مش موجودة"] += 1
                else:
                    lst = moves.get(ln.item_id, [])
                    if lst:
                        lst[0].quantity = new_qty
                    else:
                        skipped["السطر مالقاش حركته"] += 1

            for r, qty in plan_new:
                it = by_code[f"{args.prefix}{_clean(r[L_CODE])}"]
                w = wh_by_name.get(_clean(r[store_col]))
                if w is None:
                    skipped["مخزن مش موجود"] += 1
                    continue
                created.append((doc_no, it.name, qty, w.name))
                if not args.yes:
                    continue
                mv = BUILDERS[doc_type](
                    db, head, it, w, qty, to_money(_money(r[L_PRICE])),
                    to_money(_money(r[L_TOTAL])), to_money(_money(r[L_COST])),
                    actor.id)
                # زي `import_a5_manufacturing`: من غير السطر ده شغل سنة بيتحط في
                # يوم النهارده، وكل تقرير بيقرا التاريخ بيغلط.
                mv.movement_date = _date(r[L_DATE]) or mv.movement_date

        print(f"{'سطور كانت ناقصة خالص':<40}{len(created):>8,}")
        print(f"{'سطور كسرها رجع في نفس المستندات':<40}{len(fixed):>8,}")
        print(f"{'مستندات متأثرة':<40}{len(docs):>8,}")
        if skipped:
            print("\nاتخطّى:")
            for reason, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
                print(f"   {n:>6} × {reason}")
        if created:
            print(f"\n{'المستند':<14}{'الكمية':>11}  الصنف / المخزن")
            for doc_no, nm, qty, wname in created[: args.limit]:
                print(f"{doc_no:<14}{float(qty):>11,.4f}  {nm[:28]} · {wname[:20]}")
            if len(created) > args.limit:
                print(f"   … و{len(created) - args.limit} سطر تاني")
        if fixed:
            print(f"\n{'المستند':<14}{'كان':>11}{'بقى':>11}  الصنف")
            for doc_no, iid, o, n in fixed[: args.limit]:
                it = db.get(Item, iid)
                nm = it.name if it else str(iid)
                print(f"{doc_no:<14}{float(o):>11,.4f}{float(n):>11,.4f}  {nm[:30]}")
            if len(fixed) > args.limit:
                print(f"   … و{len(fixed) - args.limit} سطر تاني")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتكتب {len(created):,} سطر واتصلّح {len(fixed):,}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
