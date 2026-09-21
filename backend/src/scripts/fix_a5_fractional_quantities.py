# -*- coding: utf-8 -*-
"""الكمية الكسرية اللي ضاعت في النقل — بترجع من a5.

    python -m src.scripts.fix_a5_fractional_quantities --dir /opt/techno/a5factory --prefix FC-
    python -m src.scripts.fix_a5_fractional_quantities --dir ... --prefix FC- --yes

**المشكلة.** a5 بيكتب الكمية في عمودين: `n_count_unit` الوحدات الصحيحة،
`n_count_single` الباقي بالوحدة الصغيرة، و`item_units` معامل التحويل بينهم. الصنف
اللي بالكيلو ومعامله ١٠٠٠ بيتكتب «١٩ و٢٥٠» يعني **١٩٫٢٥ كيلو**.

واستعلام التصدير كان بياخد `n_count_unit` وحده. فالكسر اتشال من كل سطر فيه كسر، ومن
غير ما حد ياخد باله: إجمالي السطر (`a_price`) بييجي من a5 صح، فالفاتورة بتقول رقم
مظبوط وكميتها ناقصة. فاتورة `FC-S10780` دخلت عندنا ١٩ بينما إجماليها ٢٬٠٩٨٫٢٥ =
١٩٫٢٥ × ١٠٩.

**وفرع المصنع (السادات) وحده هو المتأثر** — ٣٬٠٥٣ سطر فيهم كسر. العلياء وأكتوبر صفر،
بيبيعوا بالقطعة.

**الإصلاح على Postgres بتاعنا وحده.** a5 مصدر بنقرا منه، والتصدير اتصلّح في
`deploy/a5_sql/exp_lines.sql` عشان اللي جاي يدخل صح. السكربت ده بيصلّح اللي دخل غلط.

**والمطابقة بالترتيب جوّه المستند.** الاستيراد بيقرا سطور a5 مرتّبة بـ`just_id` وبيكتبها
بنفس الترتيب، فسطرنا رقم ٣ هو سطر a5 رقم ٣. والمستند اللي عدد سطوره مش متساوي
مابيتلمسش وبيتقال في الكشف — أي تخمين هنا بيحطّ كمية صنف على صنف تاني.

وكل تعديل بيمشي على تلات حتت مع بعض: كمية السطر، ونسبة الخصم المستنتجة منها
(`implied_pct` بتقارن الكمية × السعر بالإجمالي، والكمية الغلط كانت بتطلّع نسبة غلط)،
**وحركة المخزن** — الرصيد مشتق منها، فسطر يتصلّح وحركته لأ يعني فاتورة بتقول حاجة
والمخزن بيقول حاجة تانية.
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
from src.models.stock import StockMovement
from src.scripts.import_a5 import _clean, _money, _read
from src.scripts.import_a5_docs import (
    L_CODE, L_IN, L_JUST, L_NAME, L_OUT, L_QTY, L_TYPE, _doc_key)

ZERO = Decimal("0")

#: نوع a5 → (بادئة رقم المستند عندنا، موديل الرأس، موديل السطر، عمود الربط)
SPECS: dict[str, tuple] = {}


def _load_specs() -> None:
    from src.models.purchasing import (
        PurchaseInvoice, PurchaseInvoiceLine, PurchaseReturn, PurchaseReturnLine)
    from src.models.sales import (
        SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine)
    from src.models.stock_permit import StockPermit, StockPermitLine
    from src.models.transfer import StockTransfer, StockTransferLine

    SPECS.update({
        "7": ("S", SalesInvoice, SalesInvoiceLine, SalesInvoiceLine.invoice_id, "sales_invoice"),
        "2": ("SR", SalesReturn, SalesReturnLine, SalesReturnLine.return_id, "sales_return"),
        "1": ("P", PurchaseInvoice, PurchaseInvoiceLine, PurchaseInvoiceLine.invoice_id,
              "purchase_invoice"),
        "11": ("PR", PurchaseReturn, PurchaseReturnLine, PurchaseReturnLine.return_id,
               "purchase_return"),
        "6": ("T", StockTransfer, StockTransferLine, StockTransferLine.transfer_id,
              "stock_transfer"),
        "3": ("RC", StockPermit, StockPermitLine, StockPermitLine.permit_id, "stock_permit"),
        "8": ("IS", StockPermit, StockPermitLine, StockPermitLine.permit_id, "stock_permit"),
    })


def _fold_transfer(rows: list[list[str]]) -> list[list[str]]:
    """a5 بيكتب سطر التحويل مرتين — صف خروج وصف دخول — والاستيراد بيطويهم لسطر واحد.

    نفس الخوارزم بالحرف من `import_a5_docs._transfer`: الصفّين المتتاليين اللي
    بنفس الصنف والكمية والمخزنين بيبقوا سطر، والمفرد بياخد سطره. من غير الطيّ ده
    عدد سطور a5 بيطلع ضعف عدد سطورنا وكل إذن تحويل بيتخطّى.
    """
    ordered = sorted(rows, key=lambda r: int(r[L_JUST] or 0))
    out: list[list[str]] = []
    i = 0
    while i < len(ordered):
        r = ordered[i]
        nxt = ordered[i + 1] if i + 1 < len(ordered) else None
        out.append(r)
        i += 2 if (nxt is not None
                   and _clean(nxt[L_CODE]) == _clean(r[L_CODE])
                   and _clean(nxt[L_NAME]) == _clean(r[L_NAME])
                   and _clean(nxt[L_IN]) == _clean(r[L_IN])
                   and _clean(nxt[L_OUT]) == _clean(r[L_OUT])
                   and _money(nxt[L_QTY]) == _money(r[L_QTY])) else 1
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="ترجيع الكمية الكسرية من a5")
    ap.add_argument("--dir", required=True, help="مجلد التصدير (فيه a5_lines.tsv)")
    ap.add_argument("--prefix", default="FC-", help="بادئة أرقام مستندات الفرع")
    ap.add_argument("--yes", action="store_true", help="نفّذ التعديل")
    ap.add_argument("--limit", type=int, default=25, help="حجم العيّنة في الكشف")
    args = ap.parse_args()

    path = os.path.join(args.dir, "a5_lines.tsv")
    rows = _read(path)
    if not rows:
        print(f"مالقيتش سطور في {path} — شغّل التصدير الأول.")
        return

    _load_specs()

    # سطور a5 متجمّعة بمستندها، بنفس ترتيب الملف (التصدير بيرتّب بـjust_id).
    by_doc: dict[tuple[str, str], list[list[str]]] = defaultdict(list)
    for r in rows:
        t = _clean(r[L_TYPE])
        if t not in SPECS:
            continue
        by_doc[(t, _doc_key(r))].append(r)

    db = SessionLocal()
    try:
        from src.models.catalog import Item
        by_code_id = {i.code: i.id for i in db.scalars(select(Item)).all()}
        changed: list[tuple] = []
        skipped: dict[str, int] = defaultdict(int)
        docs_touched = 0

        for (t, key), a5_rows in by_doc.items():
            letter, HeadM, LineM, fk, doc_type = SPECS[t]
            doc_no = f"{args.prefix}{letter}{key}"
            head = db.scalar(select(HeadM).where(HeadM.document_number == doc_no))
            if head is None:
                skipped["مستند مش موجود عندنا"] += 1
                continue

            # سطور a5 اللي الاستيراد بيتخطّاها (كمية صفر) مابتوصلش عندنا أصلاً،
            # والتحويل بيتطوي زي ما الاستيراد طواه.
            src_rows = _fold_transfer(a5_rows) if t == "6" else sorted(
                a5_rows, key=lambda r: int(r[L_JUST] or 0))
            wanted = [r for r in src_rows if to_qty(_money(r[L_QTY])) > ZERO]
            ours = db.scalars(select(LineM).where(fk == head.id)
                              .order_by(LineM.id)).all()
            if len(wanted) != len(ours):
                skipped[f"عدد السطور مختلف ({doc_type})"] += 1
                continue

            # **والترتيب لازم يطابق الصنف، مش العدد بس.**
            #
            # `fix_a5_missing_subunit_lines` بيكتب السطر اللي كان ناقص، وبياخد **آخر
            # رقم** في المستند مهما كان مكانه عند a5. فالمستند اللي كان ناقص سطر بقى
            # عدده مظبوط وترتيبه مش مظبوط — والمزاوجة بالترتيب ساعتها بتحطّ كمية
            # صنف على صنف تاني. والحارس القديم (فرق أقل من وحدة) مابيمسكهاش لما
            # الصنفين كميتهم قريبة.
            if any(_clean(r[L_CODE]) and ln.item_id != by_code_id.get(
                       f"{args.prefix}{_clean(r[L_CODE])}")
                   for r, ln in zip(wanted, ours)):
                skipped[f"ترتيب السطور مش زي a5 ({doc_type})"] += 1
                continue

            # حركات المخزن بتاعة المستند، مجمّعة بالصنف وبترتيب كتابتها — نفس ترتيب
            # السطور، فالسطر التاني من صنف مكرر بيلاقي حركته التانية.
            moves: dict[int, list[StockMovement]] = defaultdict(list)
            for mv in db.scalars(select(StockMovement)
                                 .where(StockMovement.source_doc_type == doc_type,
                                        StockMovement.source_doc_id == head.id)
                                 .order_by(StockMovement.id)).all():
                moves[mv.item_id].append(mv)
            used: dict[int, int] = defaultdict(int)

            doc_dirty = False
            for r, ln in zip(wanted, ours):
                new_qty = to_qty(_money(r[L_QTY]))
                old_qty = to_qty(ln.quantity)
                seat = used[ln.item_id]
                used[ln.item_id] += 1
                if new_qty == old_qty:
                    continue

                # حارس: الكمية الجديدة لازم تكون نفس القديمة + كسر. أي فرق أكبر من
                # واحد صحيح معناه إن المطابقة وقعت على سطر تاني — ساعتها نسيب.
                if abs(new_qty - old_qty) >= 1:
                    skipped["فرق أكبر من وحدة — مطابقة مشكوك فيها"] += 1
                    continue

                changed.append((doc_no, ln.item_id, old_qty, new_qty))
                doc_dirty = True
                if not args.yes:
                    continue

                ln.quantity = new_qty
                # الخصم المستنتج بيتحسب من الكمية — الكمية الغلط كانت بتطلّع نسبة غلط.
                if hasattr(ln, "discount_pct") and getattr(ln, "unit_price", None) is not None:
                    gross = to_money(new_qty * Decimal(str(ln.unit_price)))
                    ln.discount_pct = discounts.implied_pct(gross, ln.line_total)
                # الرصيد مشتق من الحركة، مش من السطر.
                #
                # والسطر اللي ماسك حركته برقمها (`out_movement_id` في التحويل،
                # `stock_movement_id` في الإذن) بيتصلّح بيه — ده رابط صريح، أدقّ من
                # أي ترتيب. والتحويل ليه **حركتين**: خروج من المصدر ودخول للوجهة،
                # والاتنين لازم يتحرّكوا مع بعض وإلا الرصيد بينط في مخزن من غير التاني.
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
                    # فاتورة ومردود: حركة واحدة لكل سطر، والمطابقة بالترتيب جوّه الصنف.
                    mv_list = moves.get(ln.item_id, [])
                    if seat < len(mv_list):
                        mv_list[seat].quantity = new_qty
                    else:
                        skipped["السطر مالقاش حركته"] += 1
            if doc_dirty:
                docs_touched += 1

        print(f"{'سطور فيها كسر ضايع':<34}{len(changed):>8,}")
        print(f"{'مستندات متأثرة':<34}{docs_touched:>8,}")
        if skipped:
            print("\nاتخطّى:")
            for reason, n in sorted(skipped.items(), key=lambda kv: -kv[1]):
                print(f"   {n:>6} × {reason}")

        if changed:
            print(f"\n{'المستند':<16}{'الصنف':>8}{'كان':>12}{'بقى':>12}")
            for doc_no, item_id, old, new in changed[: args.limit]:
                print(f"{doc_no:<16}{item_id:>8}{float(old):>12,.3f}{float(new):>12,.3f}")
            if len(changed) > args.limit:
                print(f"   … و{len(changed) - args.limit:,} سطر تاني")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتصلّح {len(changed):,} سطر في {docs_touched:,} مستند.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
