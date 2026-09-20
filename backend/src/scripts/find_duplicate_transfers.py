# -*- coding: utf-8 -*-
"""التحويل اللي اتسجّل مرتين — مرة في a5 ومرة عندنا.

    python -m src.scripts.find_duplicate_transfers            # عرض بس
    python -m src.scripts.find_duplicate_transfers --reverse  # بيعكس نسختنا

**المشكلة.** النظامين اشتغلوا مع بعض أيام النقل: أمين المخزن عمل التحويل في a5
(واتنقل عندنا مع الاستيراد برقم `AL-T…`)، **وكمان** اتكتب عندنا برقم `TRF-…` في
نفس اليوم. الحركة الواحدة بقت حركتين، والمخزن بيقول كمية أكبر من اللي فيه.

اتشاف على «كرنك٢٥ لحام بجلبين تكنووو» في مخزن السياره ( ب ): من ١٠ سبتمبر دخل
بالتحويل ١٦٠ قطعة واتباع ٧٥، والرصيد طلع ١٠٤ — والكارت نفسه سليم، السلسلة مش
مكسورة ولا مرة. الخلل في الداتا مش في الحساب.

**التطابق لازم يكون تام.** الصنف والكمية والمصدر والوجهة واليوم. أي اختلاف في
واحد منهم معناه إنهم تحويلين مختلفين فعلاً — أمين المخزن ممكن ينقل نفس الصنف
مرتين في يوم واحد لسببين مختلفين، وده شغل حقيقي مش تكرار.

**وبنعكس نسختنا إحنا، مش بتاعة a5.** a5 هو اللي العميل بيشتغل عليه دلوقتي وهو
المرجع اللي بنقيس عليه صحة النقل؛ لو شِلنا صفّه نبقى غيّرنا المرجع. ونسختنا
بتتعكس مش بتتمسح — حركة مرآة بتفضل في السجل، فاللي يبص بعدين يعرف إيه اللي حصل
وليه، ويقدر يرجّعه.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from typing import Any

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.transfer import StockTransfer, StockTransferLine, TransferStatus


def _lines(db, t: StockTransfer) -> list[tuple[int, str]]:
    """(صنف، كمية) مرتّبة — بصمة محتوى الإذن."""
    rows = db.scalars(select(StockTransferLine)
                      .where(StockTransferLine.transfer_id == t.id)).all()
    if rows:
        return sorted((r.item_id, str(r.quantity)) for r in rows)
    # إذن قديم بصنف واحد على الرأس.
    return [(t.item_id, str(t.quantity))] if t.item_id else []


def _fingerprint(db, t: StockTransfer) -> tuple:
    return (
        str(t.transfer_date),
        (t.source_location_kind.value if hasattr(t.source_location_kind, "value")
         else t.source_location_kind), t.source_location_id,
        (t.dest_location_kind.value if hasattr(t.dest_location_kind, "value")
         else t.dest_location_kind), t.dest_location_id,
        tuple(_lines(db, t)),
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reverse", action="store_true",
                    help="اعكس نسختنا (TRF-) من كل زوج متطابق")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        all_t = db.scalars(select(StockTransfer)).all()
        by_print: dict[tuple, list[StockTransfer]] = defaultdict(list)
        for t in all_t:
            if t.status == TransferStatus.rejected:
                continue
            by_print[_fingerprint(db, t)].append(t)

        dupes: list[tuple[Any, Any]] = []
        for _fp, group in by_print.items():
            ours = [t for t in group if (t.document_number or "").startswith("TRF-")]
            a5 = [t for t in group if (t.document_number or "").startswith("AL-T")]
            if not ours or not a5:
                continue
            # زوج بزوج: لو عندنا اتنين وa5 واحد، واحد بس هو التكرار.
            for mine, theirs in zip(ours, a5):
                dupes.append((mine, theirs))

        print(f"{'إجمالي التحويلات':<28}{len(all_t):,}")
        print(f"{'أزواج متطابقة تماماً':<28}{len(dupes):,}")
        if not dupes:
            print("\nمافيش تكرار بتطابق تام.")
            return

        print(f"\n{'بتاعنا':<16}{'بتاع a5':<16}{'التاريخ':<13}"
              f"{'من':>5}{'إلى':>6}{'أصناف':>8}{'كمية':>12}  الحالة")
        total_qty = 0.0
        for mine, theirs in dupes:
            ls = _lines(db, mine)
            qty = sum(float(q) for _i, q in ls)
            total_qty += qty
            print(f"{mine.document_number:<16}{theirs.document_number:<16}"
                  f"{str(mine.transfer_date):<13}{mine.source_location_id:>5}"
                  f"{mine.dest_location_id:>6}{len(ls):>8}{qty:>12,.0f}  "
                  f"{getattr(mine.status, 'value', mine.status)}")
        print(f"\n{'إجمالي الكمية المكررة':<28}{total_qty:,.0f}")

        # ---------------------------------------------------------------- سطر بسطر
        #
        # **التطابق على مستوى الورقة مابيمسكش كل حاجة.** ورقتين ممكن يتفقوا في سطر
        # ويختلفوا في باقي السطور — أمين المخزن جمّع تحويلات اليوم في ورقة واحدة
        # عندنا، وa5 قسّمها. الصنف اللي اتنقل مرتين بيبان هنا بس.
        #
        # وده **تقرير**: إلغاء ورقة كاملة عشان سطر واحد فيها مكرر غلط — باقي
        # السطور شغل حقيقي. القرار لصاحب الشغل، والسكربت بيوريه الصورة.
        line_key: dict[tuple, list[Any]] = defaultdict(list)
        for t in all_t:
            if t.status == TransferStatus.rejected:
                continue
            for item_id, qty in _lines(db, t):
                line_key[(str(t.transfer_date), t.source_location_id,
                          t.dest_location_id, item_id, qty)].append(t)
        line_dupes = []
        for k, group in line_key.items():
            ours = [g for g in group if (g.document_number or "").startswith("TRF-")]
            a5 = [g for g in group if (g.document_number or "").startswith("AL-T")]
            for mine, theirs in zip(ours, a5):
                line_dupes.append((k, mine, theirs))

        if line_dupes:
            from src.models.catalog import Item

            print(f"\n\n=== سطور مكررة (نفس الصنف والكمية واليوم والمسار) — "
                  f"{len(line_dupes)} سطر ===")
            print(f"{'بتاعنا':<16}{'بتاع a5':<16}{'التاريخ':<13}{'كمية':>8}  الصنف")
            tot = 0.0
            for (day, _s, _d, item_id, qty), mine, theirs in sorted(
                    line_dupes, key=lambda x: x[0][0]):
                it = db.get(Item, item_id)
                tot += float(qty)
                print(f"{mine.document_number:<16}{theirs.document_number:<16}"
                      f"{day:<13}{float(qty):>8,.0f}  {it.name if it else item_id}")
            print(f"\n{'إجمالي الكمية المكررة في السطور':<34}{tot:,.0f}")

        # ------------------------------------------------- تغطية كل ورقة بتاعتنا
        #
        # **السؤال اللي بيحسم:** الورقة بتاعتنا سطورها كلها ليها توأم في a5 ولا لأ؟
        #
        # التطابق على مستوى الورقة مابيمسكش غير اللي اتكتب بنفس التقسيم. لكن أمين
        # المخزن جمّع تحويلات اليوم في ورقة واحدة عندنا وa5 قسّمها لتلاتة — فالورقة
        # اللي **كل** سطورها ليها توأم هي نفس الشحنة بترتيب تاني، وإلغاؤها بيرجّع
        # الرصيد لحقيقته. واللي فيها سطر واحد من غير توأم فيها شغل حقيقي، ومابتتلمسش.
        covered: dict[int, tuple[Any, int, int, float, set]] = {}
        for t in all_t:
            if not (t.document_number or "").startswith("TRF-"):
                continue
            if t.status == TransferStatus.rejected:
                continue
            ls = _lines(db, t)
            if not ls:
                continue
            hits = 0
            twins: set = set()
            qty_dupe = 0.0
            for item_id, qty in ls:
                grp = line_key.get((str(t.transfer_date), t.source_location_id,
                                    t.dest_location_id, item_id, qty), [])
                a5 = [g for g in grp if (g.document_number or "").startswith("AL-T")]
                if a5:
                    hits += 1
                    qty_dupe += float(qty)
                    twins.update(g.document_number for g in a5)
            covered[t.id] = (t, hits, len(ls), qty_dupe, twins)

        full = [v for v in covered.values() if v[1] == v[2]]
        part = [v for v in covered.values() if 0 < v[1] < v[2]]
        none = [v for v in covered.values() if v[1] == 0]
        print(f"\n\n=== أوراقنا (TRF-) وتغطيتها في a5 ===")
        print(f"{'مغطّاة بالكامل (تكرار مؤكد)':<34}{len(full):>4}")
        print(f"{'مغطّاة جزئياً (فيها شغل أصلي)':<34}{len(part):>4}")
        print(f"{'مالهاش توأم خالص (شغل أصلي)':<34}{len(none):>4}")
        if full:
            print(f"\n{'الورقة':<16}{'التاريخ':<13}{'سطور':>6}{'كمية':>10}  توأمها في a5")
            for t, hits, total, qty, twins in sorted(
                    full, key=lambda v: str(v[0].transfer_date)):
                print(f"{t.document_number:<16}{str(t.transfer_date):<13}"
                      f"{total:>6}{qty:>10,.0f}  {'، '.join(sorted(twins))}")
            print(f"\n{'إجمالي الكمية المكررة':<34}"
                  f"{sum(v[3] for v in full):,.0f}")
        if part:
            print(f"\n--- مغطّاة جزئياً — **مابتتلمسش**، فيها سطور مالهاش توأم ---")
            for t, hits, total, qty, _tw in sorted(
                    part, key=lambda v: str(v[0].transfer_date)):
                print(f"{t.document_number:<16}{str(t.transfer_date):<13}"
                      f"  {hits} من {total} سطر مكرر ({qty:,.0f} قطعة)")

        if not args.reverse:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --reverse للتنفيذ.")
            return

        from src.services import transfer_service

        # الإلغاء على الأوراق **المغطّاة بالكامل** — دي اللي كل سطر فيها له توأم.
        targets = [v[0] for v in full]
        done = failed = 0
        for mine in targets:
            try:
                # `cancel` مش `delete`: البضاعة بترجع لمصدرها والإذن بيفضل في
                # السجل مكتوب عليه «ملغي» والسبب. الحذف بيشيل الأثر، واللي يبص
                # بعد شهر مايعرفش إن الكمية دي كانت موجودة وليه راحت.
                transfer_service.cancel(
                    db, transfer_id=mine.id, actor_user_id=1,
                    reason="اتسجّل مرتين — نسخة a5 هي المعتمدة")
                done += 1
            except Exception as exc:  # noqa: BLE001
                failed += 1
                print(f"   ✗ {mine.document_number}: {exc}")
        db.commit()
        print(f"\n   ✓ اتعكس {done}، فشل {failed}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
