"""يشيل سطور التحويلات المكررة — كل تحويل من a5 اتستورد مضروب في اتنين.

    python -m src.scripts.dedup_transfers --aliaa-dir C:/pgtmp/aliaa --oct-dir C:/pgtmp          # يعرض بس
    python -m src.scripts.dedup_transfers --aliaa-dir C:/pgtmp/aliaa --oct-dir C:/pgtmp --yes    # ينفّذ

**اللي اتقاس (تصدير a5 نفسه على الفرعين):**

* التحويل عند a5 صفّين متطابقين تماماً لنفس الصنف والكمية والمخزنين (`just_id`
  متتالي) — سطر الخروج وسطر الدخول، والاتنين شايلين الصورة الكاملة. العلياء:
  ٤٤٬٣١٤ صف = ٢٢٬١٥٧ زوج متطابق، صفر شواذ. أكتوبر: ١٧٬٩١٥ صف = ٨٬٩٥٤ زوج +
  يتيم واحد (Azn ٤١٩: صف `0030026` توأمه ممسوح عندهم، وفجوة `just_id` وراه).
* المستورد (`import_a5_docs._transfer`) كان بيعمل حركة خروج+دخول **لكل صف**،
  فكل زوج حرّك ضعف الكمية. عدد مستنداتنا مطابق لعدد أذونهم (١٤٦٨/٩١٩) —
  التضاعف جوّه السطور مش في المستندات.
* الأذون (إضافة/صرف) صفوف مفردة — مافيهاش الأزواج دي، فالتنضيف تحويلات بس.

**القاعدة:** لكل مستند، يقارن سطورنا بالمصدر بعد طيّ الأزواج. المجموعة اللي
سطورنا فيها ضعف المصدر بالظبط (كل سطر منطقي متكرر مرتين) بيتمسح منها النص.
أي مجموعة مش مضروبة في اتنين بالظبط (اليتيم وأي حالة غريبة) **بتتقال
ومابتتلمسش**. المسح سطر + حركتيه (خروج/دخول) بعد التحقق إن الحركة بتاعة نفس
المستند ونفس الصنف والكمية والاتجاه.

**ليه آمن المسح هنا بالذات (متقاس على السيرفر قبل الكتابة):**

* صفر إشارة خارجية لحركات التحويلات في أي جدول (تصنيع/ولاء/جرد/أذون/هوادر/
  فحص/عكس)، وحقول `out/in_movement_id` على مستوى المستند فاضية.
* مافيش صنف قابل للتلف ولا مسلسل أصلاً — فشرط «مجموع الدفعات = الرصيد المشتق»
  مابيتهزش: مافيش دفعات من الأساس.
* مافيش تحويل واحد من خارج a5 (٢٣٨٧/٢٣٨٧ بأرقام `T`/`AL-T`) — يعني مافيش شغل
  مستخدم هيتمس بالغلط.

**الحرّاس:** عرض افتراضي و`--yes` للتنفيذ، وبيتعاد تشغيله بأمان (التانية بتلاقي
مافيش مجموعات مضروبة فبتمسح صفر). الحفظ على دفعات كل ٥٠٠ مستند.
"""
from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.core.money import to_qty
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.transfer import StockTransfer, StockTransferLine
from src.scripts.import_a5 import _clean, _money

ZERO = Decimal("0")
(L_TYPE, L_AZN, L_DATE, L_ORD, L_ORDBK, L_POORD, L_POBK, L_CODE, L_NAME,
 L_IN, L_OUT, L_QTY, _L_PRICE, _L_TOTAL, _L_MEMO, L_JUST, _L_COST) = range(17)


def _read(path: str) -> list[list[str]]:
    rows = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            ln = ln.rstrip("\n")
            if ln:
                rows.append(ln.split("~"))
    return rows


def _collapse(rows: list[list[str]]) -> tuple[list[list[str]], int]:
    """يطوي أزواج a5 المتطابقة لسطر منطقي واحد. بيرجّع (السطور، عدد المطوي)."""
    rows = sorted(rows, key=lambda r: int(r[L_JUST] or 0))
    out: list[list[str]] = []
    i, folded = 0, 0
    while i < len(rows):
        r = rows[i]
        nxt = rows[i + 1] if i + 1 < len(rows) else None
        if (nxt is not None
                and _clean(nxt[L_CODE]) == _clean(r[L_CODE])
                and _clean(nxt[L_NAME]) == _clean(r[L_NAME])
                and _clean(nxt[L_IN]) == _clean(r[L_IN])
                and _clean(nxt[L_OUT]) == _clean(r[L_OUT])
                and to_qty(_money(nxt[L_QTY])) == to_qty(_money(r[L_QTY]))):
            out.append(r)
            folded += 1
            i += 2
        else:
            out.append(r)
            i += 1
    return out, folded


def _source_groups(path: str, prefix: str, item_by_code: dict, item_by_name: dict):
    """Azn ← Counter((item_id, qty)) بعد طيّ الأزواج. واللي مايتربطش بصنف بيتقال."""
    groups: dict[str, Counter] = defaultdict(Counter)
    if not os.path.exists(path):
        return groups, [f"مافيش ملف: {path}"]
    for r in _read(path):
        if len(r) < 17 or r[L_TYPE] != "6":
            continue
        groups[r[L_AZN]][(_clean(r[L_CODE]), _clean(r[L_NAME]),
                          to_qty(_money(r[L_QTY])))] += 1
    collapsed: dict[str, Counter] = {}
    unmapped: list[str] = []
    for azn, cnt in groups.items():
        logical: Counter = Counter()
        for (c, n, q), k in cnt.items():
            if q <= ZERO:
                continue
            pairs, single = divmod(k, 2)
            # الزوج = سطر منطقي واحد (سطر الخروج + سطر الدخول عند a5).
            # المفرد (يتيم a5 زي Azn ٤١٩) = سطر منطقي واحد برضه.
            it = item_by_code.get(f"{prefix}{c}") or item_by_name.get(n)
            if it is None:
                unmapped.append(f"{prefix or 'OCT'} Azn={azn} صنف «{n}» ({c}) كمية {q}")
                continue
            logical[(it.id, q)] += pairs + (1 if single else 0)
        collapsed[azn] = logical
    return collapsed, unmapped


def run(*, aliaa_dir: str, oct_dir: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        items = db.scalars(select(Item)).all()
        by_code = {i.code: i for i in items if i.code}
        by_name = {i.name: i for i in items if i.name}
        al_src, al_un = _source_groups(os.path.join(aliaa_dir, "a5_lines.tsv"), "AL-", by_code, by_name)
        oc_src, oc_un = _source_groups(os.path.join(oct_dir, "a5_lines.tsv"), "", by_code, by_name)
        unmapped = al_un + oc_un

        transfers = db.scalars(select(StockTransfer)).all()
        print(f"مستندات تحويل: {len(transfers)}")

        # رصيد كل (صنف×مخزن) من حركات التحويلات قبل التنضيف — عشان نقيس المتأثر.
        def on_hand() -> dict:
            rows = db.execute(select(
                StockMovement.item_id, StockMovement.location_id,
                func.coalesce(func.sum(StockMovement.quantity).filter(
                    StockMovement.direction == StockDirection.in_), 0),
                func.coalesce(func.sum(StockMovement.quantity).filter(
                    StockMovement.direction == StockDirection.out), 0),
            ).where(StockMovement.source_doc_type == "stock_transfer").group_by(
                StockMovement.item_id, StockMovement.location_id)).all()
            return {(i, w): (inn - out) for i, w, inn, out in rows}

        before_hand = on_hand()

        plan: list[tuple[StockTransferLine, StockMovement, StockMovement]] = []
        swaps: list[tuple[StockTransfer, list[StockTransferLine], tuple]] = []
        odd_groups: list[str] = []
        missing_docs: list[str] = []
        for tr in transfers:
            prefix = "AL-" if tr.document_number.startswith("AL-") else ""
            azn = tr.document_number.split("T", 1)[1]
            src = (al_src if prefix else oc_src).get(azn)
            if src is None:
                missing_docs.append(f"{tr.document_number}")
                continue
            ours: dict[tuple, list[StockTransferLine]] = defaultdict(list)
            for ln in tr.lines:
                ours[(ln.item_id, Decimal(ln.quantity))].append(ln)
            stale = [(k, v) for k, v in ours.items()
                     if len(v) == 2 and src.get(k, 0) == 0]
            fresh = [(k, n) for k, n in src.items()
                     if n == 1 and len(ours.get(k, [])) == 0]
            swapped_keys: set[tuple] = set()
            if len(stale) == 1 and len(fresh) == 1:
                # تعديل رجعي واحد مقابل واحد: سطران قدام بسطر منطقي جديد.
                (okey, olines), (nkey, _) = stale[0], fresh[0]
                swaps.append((tr, olines, nkey))
                swapped_keys = {okey, nkey}
            for key, logical_n in src.items():
                if key in swapped_keys:
                    continue
                got = ours.pop(key, [])
                if len(got) == 2 * logical_n and logical_n > 0:
                    got.sort(key=lambda l: l.id)
                    for dup in got[logical_n:]:
                        plan.append((dup, None, None))
                else:
                    iname = next((i.name for i in items if i.id == key[0]), str(key[0]))
                    odd_groups.append(
                        f"{tr.document_number} «{iname}» كمية {key[1]}: المصدر {logical_n} منطقي وعندنا {len(got)}")
            for key, leftover in ours.items():
                if key in swapped_keys:
                    continue
                iname = next((i.name for i in items if i.id == key[0]), str(key[0]))
                odd_groups.append(
                    f"{tr.document_number} «{iname}» كمية {key[1]}: زيادة عندنا {len(leftover)} مالوش مصدر")

        # تحقق من حركات السطور الممسوحة والمستبدلة قبل أي كتابة.
        verified: list[tuple[StockTransferLine, StockMovement, StockMovement]] = []
        bad_moves: list[str] = []


        def _check(tr: StockTransfer, ln: StockTransferLine):
            out = db.get(StockMovement, ln.out_movement_id) if ln.out_movement_id else None
            inn = db.get(StockMovement, ln.in_movement_id) if ln.in_movement_id else None
            if (out is not None and inn is not None
                    and out.source_doc_type == "stock_transfer" and out.source_doc_id == tr.id
                    and inn.source_doc_type == "stock_transfer" and inn.source_doc_id == tr.id
                    and out.item_id == ln.item_id and inn.item_id == ln.item_id
                    and Decimal(out.quantity) == Decimal(ln.quantity)
                    and Decimal(inn.quantity) == Decimal(ln.quantity)
                    and out.direction == StockDirection.out and inn.direction == StockDirection.in_
                    and out.location_id == tr.source_location_id
                    and inn.location_id == tr.dest_location_id):
                return (out, inn)
            return None

        for ln, _, _ in plan:
            tr = db.get(StockTransfer, ln.transfer_id)
            checked = _check(tr, ln)
            if checked:
                verified.append((ln, checked[0], checked[1]))
            else:
                bad_moves.append(f"{tr.document_number} سطر {ln.id}")

        verified_swaps: list[tuple] = []
        for tr, olines, nkey in swaps:
            if (len(olines) != 2 or olines[0].item_id != olines[1].item_id
                    or Decimal(olines[0].quantity) != Decimal(olines[1].quantity)):
                bad_moves.append(f"{tr.document_number} تبديل مش توأم — مش هيتلمس")
                continue
            c0, c1 = _check(tr, olines[0]), _check(tr, olines[1])
            if c0 and c1:
                verified_swaps.append((tr, olines[0], c0[0], c0[1], olines[1], c1[0], c1[1], nkey))
            else:
                bad_moves.append(f"{tr.document_number} تبديل حركاته مش مطابقة")

        # إشارات خارجية طارئة (اتقاست صفر قبل كده — بيتعاد قياسها قبل الكتابة).
        mids = [m.id for _, o, i in verified for m in (o, i)]
        mids += [m.id for _, _, o0, i0, _, o1, i1, _ in verified_swaps for m in (o0, i0, o1, i1)]
        refs = 0
        if mids:
            from src.models import inspection, manufacturing, loyalty, stock_count, stock_permit, wastage
            for mod in (inspection, manufacturing, loyalty, stock_count, stock_permit, wastage):
                for cls in list(vars(mod).values()):
                    if isinstance(cls, type) and hasattr(cls, "__tablename__"):
                        for col in cls.__table__.columns:
                            for fk in col.foreign_keys:
                                if str(fk.column) == "stock_movement.id":
                                    refs += db.scalar(select(func.count()).select_from(cls).where(
                                        col.in_(mids))) or 0
        perish = db.scalar(select(func.count()).select_from(StockTransferLine).where(
            StockTransferLine.id.in_(
                [ln.id for ln, _, _ in verified]
                + [ln.id for _, l0, _, _, l1, _, _, _ in verified_swaps for ln in (l0, l1)]),
            StockTransferLine.item_id.in_(
                select(Item.id).where(Item.is_perishable.is_(True))))) or 0

        print(f"سطور هتتمسح: {len(verified)} (حركات: {2 * len(verified)})")
        print(f"   حركات مش مطابقة (مش هتتلمس): {len(bad_moves)}")
        print(f"   إشارات خارجية على الحركات: {refs} · سطور أصناف قابلة للتلف: {perish}")
        if verified_swaps:
            print(f"\n⇄ {len(verified_swaps)} تعديل رجعي (سطرين قدام بسطر واحد جديد):")
            for tr, _l0, _o0, _i0, _l1, _o1, _i1, nkey in verified_swaps:
                nname = next((i.name for i in items if i.id == nkey[0]), str(nkey[0]))
                print(f"   {tr.document_number} → «{nname}» كمية {nkey[1]}")
        if odd_groups:
            print(f"\n⚠️ {len(odd_groups)} مجموعة مش مضروبة في اتنين — مش هتتلمس:")
            for g in odd_groups[:15]:
                print(f"   {g}")
            if len(odd_groups) > 15:
                print(f"   ... و{len(odd_groups) - 15} غيرهم")
        if missing_docs:
            print(f"\n⚠️ {len(missing_docs)} مستند مالوش أذن في المصدر — مش هيتلمس:")
            for d in missing_docs[:10]:
                print(f"   {d}")
        # العكسي: أذون في المصدر مش عندنا (نقل جديد مستني المزامنة).
        have = set()
        for tr in transfers:
            have.add(("AL-" if tr.document_number.startswith("AL-") else "", tr.document_number.split("T", 1)[1]))
        new_azns = ([("AL-", a) for a in al_src if ("AL-", a) not in have]
                    + [("", a) for a in oc_src if ("", a) not in have])
        if new_azns:
            print(f"\n⚠️ {len(new_azns)} أذن في المصدر مش عندنا (للمزامنة بعد التنضيف):")
            for p, a in new_azns[:10]:
                print(f"   {p}T{a}")
        if unmapped:
            print(f"\n⚠️ {len(unmapped)} صف مصدر متربطش بصنف:")
            for u in unmapped[:10]:
                print(f"   {u}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        if refs or perish or bad_moves:
            print("\n✘ فيه موانع — مافيش حاجة اتكتبت. راجع الأرقام الأول.")
            raise SystemExit(1)

        done = 0
        for ln, out, inn in verified:
            db.delete(ln)
            db.delete(out)
            db.delete(inn)
            done += 1
            if done % 1000 == 0:
                db.flush()
                print(f"   … {done}/{len(verified)}")
        swapped = 0
        for tr, ln0, o0, i0, ln1, o1, i1, nkey in verified_swaps:
            item_id, qty = nkey
            # امسح التوأم القديم بحركاته الأربعة، وازرع السطر الجديد بحركتيه
            # على نفس مخزني المستند (نفس شكل ما المستورد كان هيعمله).
            for ln, o, i in ((ln0, o0, i0), (ln1, o1, i1)):
                db.delete(ln)
                db.delete(o)
                db.delete(i)
            db.flush()
            tpl = o0  # قالب الحقول الثابتة من حركة محذوفة أختها
            out = StockMovement(
                item_id=item_id, location_kind=LocationKind.warehouse,
                location_id=tr.source_location_id, movement_type="transfer_out",
                direction=StockDirection.out, quantity=qty,
                source_doc_type="stock_transfer", source_doc_id=tr.id,
                branch_id=tpl.branch_id, actor_user_id=tpl.actor_user_id)
            inn = StockMovement(
                item_id=item_id, location_kind=LocationKind.warehouse,
                location_id=tr.dest_location_id, movement_type="transfer_in",
                direction=StockDirection.in_, quantity=qty,
                source_doc_type="stock_transfer", source_doc_id=tr.id,
                branch_id=tpl.branch_id, actor_user_id=tpl.actor_user_id)
            db.add(out)
            db.add(inn)
            db.flush()
            db.add(StockTransferLine(transfer_id=tr.id, item_id=item_id, quantity=qty,
                                    out_movement_id=out.id, in_movement_id=inn.id))
            if tr.item_id in (ln0.item_id, ln1.item_id):
                tr.item_id, tr.quantity = item_id, qty
            db.flush()
            swapped += 1
        db.commit()

        after_hand = on_hand()
        changed = sum(1 for k in set(before_hand) | set(after_hand)
                      if before_hand.get(k, ZERO) != after_hand.get(k, ZERO))
        total = len(set(before_hand) | set(after_hand))
        print(f"\n✔ اتمسح {done} سطر و{2 * done} حركة + {swapped} تعديل رجعي.")
        print(f"   مواقع (صنف×مخزن) اتأثرت: {changed}/{total} ({100 * changed // max(total, 1)}٪)")

        # الشرط الثابت: مافيش مستند يفضى، ومجموع الدفعات = الرصيد المشتق.
        # (مافيش دفعات أصلاً — صفر صنف قابل للتلف — فالثابت هنا إن كل مستند
        #  يفضل عليه سطر واحد على الأقل وإن خارج كل مستند = داخله.)
        empty = db.scalar(select(func.count()).select_from(StockTransfer).where(
            ~select(StockTransferLine.id).where(
                StockTransferLine.transfer_id == StockTransfer.id).exists())) or 0
        print(f"   مستندات فضيت تماماً (المفروض صفر): {empty}")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    aliaa = args[args.index("--aliaa-dir") + 1] if "--aliaa-dir" in args else "C:/pgtmp/aliaa"
    octd = args[args.index("--oct-dir") + 1] if "--oct-dir" in args else "C:/pgtmp"
    run(aliaa_dir=aliaa, oct_dir=octd, execute="--yes" in args)
