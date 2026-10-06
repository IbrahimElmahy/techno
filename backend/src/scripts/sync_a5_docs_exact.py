"""مطابقة مستندات فرع مع a5 بالكامل — مش بالكمية بس (٢٠٢٦-١٠-٠٥، طلب «نسخة طبق الأصل»).

    python -m src.scripts.sync_a5_docs_exact --dir /opt/techno/a5factory --branch السادات --prefix FC-
    python -m src.scripts.sync_a5_docs_exact ... --yes

`audit_a5_doc_drift` بيقارن **كمية** كل صنف في المستند. ده بيكمّل عليه:

* **رأس الفاتورة/المرتجع:** التاريخ، الطرف (رقمه في a5)، الإجمالي والخصم والنقدي والآجل.
* **السطر بسعره:** (الصنف، الكمية، السعر، إجمالي السطر) — سعر اتعدّل في a5 بعد ما نقلنا
  المستند كان بيفضل عندنا بالقديم والكمية زي ما هي، فالمقارنة بالكمية ماتشوفهوش.
* **المستند اللي اتمسح من a5:** رقمه من a5 (`<بادئة><حرف><رقم>`) وموجود عندنا ومش
  موجود في التصدير ⇒ بيتشال من عندنا.

المختلف بيتهد بنفس `rebuild_a5_docs._demolish` ويتبني بـ`import_a5_docs` — نفس الكود اللي
بنى الباقي. القيود مابتتلمسش هنا: `import_a5_ledger` بعده بيربط المستند الجديد بقيده.

**مقفول على الفرع:** المستند عندنا لازم يكون في الفرع ده وببادئته، فالفروع التانية — اللي
فيها شغل مش في a5 — مابتتلمسش.
"""
from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict
from decimal import Decimal

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.core.money import to_money, to_qty
from src.models.org import Branch
from src.scripts import import_a5_docs
from src.scripts.audit_a5_doc_drift import TABLES, collect
from src.scripts.import_a5 import _clean, _money, _read, mine
from src.scripts.import_a5_docs import (
    H_BONS, H_CASH, H_CREDIT, H_DATE, H_GROSS, H_ID, H_KIND, KIND, L_CODE, L_NAME, L_PRICE,
    L_QTY, L_TOTAL, L_TYPE, _doc_key, _party_id,
)
from src.scripts.rebuild_a5_docs import _demolish
from src.services import customer_merge_service

# اللي بيشاور على المستند من برّه المزامنة: نقاط، كوبونات، مرتجع على فاتورة…
# الهدّ كان بيقع على أول واحد فيهم (نقاط فاتورة S14988 في أكتوبر). فبيتفكّوا قبل الهدّ
# ويرجعوا يتربطوا بالنسخة الجديدة بنفس الرقم — النقطة اللي اتكسبت ماتضيعش.
# (الجدول اللي بيشاور، العمود، جدول المستند)
REFS = (
    ("point_record", "sales_invoice_id", "sales_invoice"),
    ("coupon_redemption", "sales_invoice_id", "sales_invoice"),
    ("coupon_receipt_line", "sales_invoice_id", "sales_invoice"),
    ("item_serial", "sold_invoice_id", "sales_invoice"),
    ("reservation", "sales_invoice_id", "sales_invoice"),
    ("sales_return", "sales_invoice_id", "sales_invoice"),
    ("point_record", "sales_return_id", "sales_return"),
    ("purchase_return", "purchase_invoice_id", "purchase_invoice"),
)
# إجباريين (مابيتفكّوش): المستند اللي عليه واحد منهم بيتساب ويتقال.
HARD_REFS = (("sales_invoice_coupon", "invoice_id", "sales_invoice"),
             ("sales_invoice_expense", "invoice_id", "sales_invoice"))

# رأس a5 → (نوع السطر، حرف رقمنا)
HEAD = {"SALE": ("7", "S"), "SRET": ("2", "SR"), "BUY": ("1", "P"), "BRET": ("11", "PR")}

# الجدول عندنا وأعمدة الرأس اللي بتتقارن: (التاريخ، الطرف، النقدي، الآجل)
OURS = {
    "7": ("sales_invoice", "invoice_date", "customer_id", "cash_amount", "credit_amount"),
    "2": ("sales_return", "return_date", "customer_id", "cash_refund", "credit_reduction"),
    "1": ("purchase_invoice", "purchase_date", "supplier_id", "cash_amount", "credit_amount"),
    "11": ("purchase_return", "return_date", "supplier_id", None, None),
}


def _m(v) -> Decimal:
    return to_money(Decimal(str(v or 0)))


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        branch = db.scalars(select(Branch).where(Branch.name == branch_name)).one()
        bid = branch.id

        my_items = mine(db.scalars(select(import_a5_docs.Item)).all(), prefix)
        by_code = {i.code: i.id for i in my_items if i.code}
        by_name = {i.name: i.id for i in my_items}

        def item_of(r):
            return by_code.get(f"{prefix}{_clean(r[L_CODE])}") or by_name.get(_clean(r[L_NAME]))

        heads = {}
        for h in _read(os.path.join(folder, "a5_hdr.tsv")):
            if len(h) > H_CREDIT and h[H_KIND] in HEAD:
                t, tag = HEAD[h[H_KIND]]
                heads[f"{prefix}{tag}{h[H_ID].strip()}"] = (t, h)

        lines = defaultdict(list)
        for r in _read(os.path.join(folder, "a5_lines.tsv")):
            if len(r) > L_TOTAL and r[L_TYPE].strip() in OURS:
                t = r[L_TYPE].strip()
                lines[f"{prefix}{KIND[t][1]}{_doc_key(r).strip()}"].append(r)

        # الطرف بيتقارن برقمه في a5 لما الكارت عندنا مكتوب عليه (كود FC-A5-<رقم>)،
        # وإلا بالاسم — نفس ترتيب `Ctx.party`.
        cust_code = {c: n for c, n in db.execute(text(
            "select id, code from customer where branch_id=:b"), {"b": bid}).all()}
        cust_name = {c: n for c, n in db.execute(text(
            "select id, name from customer where branch_id=:b"), {"b": bid}).all()}
        supp_name = {c: n for c, n in db.execute(text(
            "select id, name from supplier where branch_id=:b"), {"b": bid}).all()}
        # الكارت المدموج («تكنو فلان» في «فلان»): الاستيراد بينزّل فاتورته على الكارت
        # اللي اتدمج فيه، فده مش فرق. من غيره كل فاتورة على كارت مدموج كانت هتتهد
        # وتتبني على نفس الكارت تاني (٦ في أكتوبر).
        by_a5 = {code: cid for cid, code in cust_code.items() if code}
        merged = customer_merge_service.final_targets(
            db.scalars(select(import_a5_docs.Customer)).all())

        reasons: dict[str, list[str]] = {}
        seen: set[str] = set()
        for t, (table, dcol, pcol, ccol, kcol) in OURS.items():
            tag = KIND[t][1]
            fk = TABLES[t][2]
            line_tbl = TABLES[t][1].__tablename__
            cols = f"id, document_number, {dcol}, {pcol}" + (f", {ccol}, {kcol}" if ccol else "")
            for row in db.execute(text(
                    f"select {cols} from {table} where branch_id=:b and document_number like :p"),
                    {"b": bid, "p": f"{prefix}{tag}%"}).all():
                rid, num = row[0], row[1]
                if not num[len(prefix) + len(tag):].isdigit():
                    continue
                seen.add(num)
                why: list[str] = []
                hit = heads.get(num)
                if hit is None or hit[0] != t:
                    reasons[num] = ["اتمسح من a5"]
                    continue
                h = hit[1]
                if str(row[2])[:10] != h[H_DATE][:10]:
                    why.append(f"تاريخ {row[2]} ← {h[H_DATE][:10]}")
                if ccol and (_m(row[4]) != _m(_money(h[H_CASH]))
                             or _m(row[5]) != _m(_money(h[H_CREDIT]))):
                    why.append(f"نقدي/آجل {row[4]}/{row[5]} ← {h[H_CASH]}/{h[H_CREDIT]}")
                pid = _party_id(h)
                if t in ("7", "2"):
                    code = cust_code.get(row[3]) or ""
                    want = by_a5.get(f"{prefix}A5-{pid}")
                    if want is not None and merged.get(want) == row[3]:
                        pass
                    elif pid and code.startswith(f"{prefix}A5-") and code != f"{prefix}A5-{pid}":
                        why.append(f"طرف {cust_name.get(row[3])} ← {_clean(h[4])}")
                theirs = Counter()
                for r in lines.get(num, []):
                    q = to_qty(_money(r[L_QTY]))
                    if q > 0:
                        theirs[(item_of(r), q, to_money(_money(r[L_PRICE])),
                                to_money(_money(r[L_TOTAL])))] += 1
                ours = Counter()
                for it, q, p, tot in db.execute(text(
                        f"select item_id, quantity, unit_price, line_total from {line_tbl} "
                        f"where {fk}=:i"), {"i": rid}).all():
                    ours[(it, to_qty(Decimal(str(q))), _m(p), _m(tot))] += 1
                if theirs != ours:
                    why.append("سطور (سعر/كمية/صنف)")
                if why:
                    reasons[num] = why

        # التحويلات والأذون: بالكمية (هو ده كل اللي فيها) — من نفس مسطرة الكشف.
        drift, _missing, _u = collect(db, folder, prefix)
        types = {}
        for d in drift:
            if d.a5_type in ("6", "3", "8"):
                reasons.setdefault(d.number, ["سطور (كمية)"])
                types[d.number] = d.a5_type
        for t, (head_cls, _l, _fk) in TABLES.items():
            if t not in ("6", "3", "8"):
                continue
            tag = KIND[t][1]
            a5_nums = {f"{prefix}{tag}{_doc_key(r).strip()}"
                       for r in _read(os.path.join(folder, "a5_lines.tsv"))
                       if len(r) > L_QTY and r[L_TYPE].strip() == t}
            for (num,) in db.execute(select(head_cls.document_number).where(
                    head_cls.document_number.like(f"{prefix}{tag}%"))).all():
                if num[len(prefix) + len(tag):].isdigit() and num not in a5_nums:
                    reasons.setdefault(num, ["اتمسح من a5"])
                    types[num] = t

        def type_of(num: str) -> str:
            if num in types:
                return types[num]
            tag = num[len(prefix):].rstrip("0123456789")
            return {"S": "7", "SR": "2", "P": "1", "PR": "11"}[tag]

        gone = [n for n, w in reasons.items() if w == ["اتمسح من a5"]]
        redo = [n for n in reasons if n not in gone]
        print(f"فرع {branch_name}: مستندات مختلفة {len(redo)} · اتمسحت من a5 {len(gone)}")
        for n in sorted(reasons):
            print(f"   {n:<14} {' · '.join(reasons[n])}")

        if not execute:
            print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0

        table_of = {"7": "sales_invoice", "2": "sales_return",
                    "1": "purchase_invoice", "11": "purchase_return"}
        detached: list[tuple[str, str, str, list[int]]] = []
        for n in list(reasons):
            tbl = table_of.get(type_of(n))
            if tbl is None:
                continue
            hid = db.execute(text(f"select id from {tbl} where document_number=:n and branch_id=:b"),
                             {"n": n, "b": bid}).scalar()
            if hid is None:
                continue
            hard = [rt for rt, rc, ht in HARD_REFS if ht == tbl and db.execute(text(
                f"select 1 from {rt} where {rc}=:i limit 1"), {"i": hid}).first()]
            if hard:
                print(f"   ⚠ {n} اتساب — عليه {', '.join(hard)} ومايتفكّش")
                del reasons[n]
                continue
            for rt, rc, ht in REFS:
                if ht != tbl:
                    continue
                ids = [i for (i,) in db.execute(text(
                    f"select id from {rt} where {rc}=:i"), {"i": hid}).all()]
                if ids:
                    db.execute(text(f"update {rt} set {rc}=null where id = any(:ids)"),
                               {"ids": ids})
                    detached.append((n, rt, rc, ids))
        db.flush()
        for n in reasons:
            nl, nm = _demolish(db, type_of(n), n)
            print(f"   اتشال {n}: {nl} سطر، {nm} حركة")
        db.commit()
        print("\n— إعادة البناء —")
        import_a5_docs.run(folder, execute=True, branch_name=branch_name, prefix=prefix)

        # ربط اللي اتفكّ بالنسخة الجديدة بنفس الرقم.
        for n, rt, rc, ids in detached:
            tbl = table_of[type_of(n)]
            new = db.execute(text(f"select id from {tbl} where document_number=:n and branch_id=:b"),
                             {"n": n, "b": bid}).scalar()
            if new is None:
                print(f"   ⚠ {n} مابقاش موجود (اتمسح من a5) — {len(ids)} صف في {rt} فاضل من غير مستند")
                continue
            db.execute(text(f"update {rt} set {rc}=:new where id = any(:ids)"),
                       {"new": new, "ids": ids})
            print(f"   اترجع ربط {len(ids)} صف في {rt} بـ{n}")
        db.commit()
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    folder = a[a.index("--dir") + 1] if "--dir" in a else "C:/pgtmp"
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    branch = a[a.index("--branch") + 1] if "--branch" in a else ""
    # أكتوبر من غير بادئة — فلازم `--prefix ""` تتكتب صريحة، مش تتنسي.
    if not branch or "--prefix" not in a:
        print("لازم --branch و--prefix — السكربت بيشتغل على فرع واحد بس.")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in a))
