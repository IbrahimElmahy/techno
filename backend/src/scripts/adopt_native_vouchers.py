"""السند اللي اتسجّل في نظامنا **وفي a5** — بيفضل سندنا ويتشال نسخة a5 المكررة (٢٠٢٦-١٠-٠٦).

    python -m src.scripts.adopt_native_vouchers --branch السادات --prefix FC-          # يعرض بس
    python -m src.scripts.adopt_native_vouchers --branch السادات --prefix FC- --yes    # ينفّذ

الفروع شغّالة على النظامين مع بعض: الموظف بيعمل سند القبض عندنا وبيعمله في a5 كمان. المزامنة
بتجيب نسخة a5 (قيد برقم `a5:<بادئة><رقم>`) فالتحصيل بيتقيّد مرتين والعميل رصيده بيقل بالضعف.
اتقاس في السادات: `manager3` سجّل ١٠ سندات (٧٤٬١٠٠ قبض و٦٠٬٤٥٠ صرف) واتكرروا كلهم.

**القاعدة:** سند نظامنا هو اللي بيفضل — ليه رقم وورقة وممكن يكون اتطبع واتسلّم. قيد a5
المقابل بيتعرف بنفس اليوم ونفس حساب الطرف ونفس المبلغ ونفس الاتجاه، وقيد a5 لازم يكون سطرين
بس (خزنة + طرف). لو اتلاقى **واحد بالظبط**: قيد a5 بيتشال، وسندنا بياخد رقمه (`external_ref`) —
فالمزامنة الجاية بتشوف الرقم موجود وماتجيبوش تاني، و`rebuild_a5_ledger` بيلاقيه بنفس المبلغ.
أكتر من واحد أو صفر ⇒ بيتقال ومابيتلمسش.

مافيش مستند a5 بيتلمس (القيد ده سند/قيد حر في a5، مالوش فاتورة).
"""
from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.ledger import LedgerEntry, LedgerLine
from src.models.org import Branch


def run(*, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        bid = db.scalar(select(Branch.id).where(Branch.name == branch_name))
        tag = f"a5:{prefix}"
        native = db.scalars(select(LedgerEntry).where(
            LedgerEntry.branch_id == bid, LedgerEntry.external_ref.is_(None),
            LedgerEntry.entry_type.in_(("receipt", "payment", "expense")),
            LedgerEntry.reverses_entry_id.is_(None))).all()
        if not native:
            print("مافيش سندات من نظامنا في الفرع ده.")
            return 0
        lines_of: dict[int, list[LedgerLine]] = defaultdict(list)
        for ln in db.scalars(select(LedgerLine).where(
                LedgerLine.entry_id.in_([e.id for e in native]))):
            lines_of[ln.entry_id].append(ln)
        taken: set[int] = set()
        plan: list[tuple[LedgerEntry, LedgerEntry]] = []
        for e in native:
            ls = lines_of.get(e.id, [])
            if len(ls) != 2:
                continue
            sig = sorted((ln.account_id, ln.direction.value, str(ln.amount)) for ln in ls)
            cands = db.execute(text("""
                select e.id from ledger_entry e
                where e.branch_id = :b and e.entry_date = :d and e.external_ref like :p
                  and (select count(*) from ledger_line l where l.entry_id = e.id) = 2"""),
                {"b": bid, "d": e.entry_date, "p": tag + "%"}).scalars().all()
            hits = []
            for cid in cands:
                if cid in taken:
                    continue
                cl = db.execute(text(
                    "select account_id, direction, amount from ledger_line where entry_id=:i"),
                    {"i": cid}).all()
                if sorted((a, str(getattr(d, "value", d)), str(m)) for a, d, m in cl) == sig:
                    hits.append(cid)
            if len(hits) == 1:
                taken.add(hits[0])
                plan.append((e, db.get(LedgerEntry, hits[0])))
            else:
                print(f"  · قيد #{e.id} ({e.entry_type} {e.entry_date}) — {len(hits)} قيد a5 مطابق، اتساب")
        print(f"فرع {branch_name}: سندات نظامنا {len(native)} · ليها نسخة a5 مكررة {len(plan)}")
        for e, a in plan:
            amt = max(lines_of[e.id], key=lambda x: x.amount).amount
            print(f"   #{e.id} {e.entry_type} {e.entry_date} {amt}  ⇐  {a.external_ref} «{(a.description or '')[:50]}»")
        if not execute or not plan:
            if plan:
                print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0
        for e, a in plan:
            ref = a.external_ref
            db.execute(text("""delete from partial_reconcile where debit_line_id in
                (select id from ledger_line where entry_id=:i) or credit_line_id in
                (select id from ledger_line where entry_id=:i)"""), {"i": a.id})
            db.execute(text("delete from ledger_line_distribution where line_id in "
                            "(select id from ledger_line where entry_id=:i)"), {"i": a.id})
            db.execute(text("delete from ledger_line where entry_id=:i"), {"i": a.id})
            db.execute(text("delete from ledger_entry where id=:i"), {"i": a.id})
            db.flush()
            e.external_ref = ref
        db.commit()
        print(f"\n✔ {len(plan)} سند من نظامنا خد رقم قيد a5، والنسخة المكررة اتشالت.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    branch = a[a.index("--branch") + 1] if "--branch" in a else ""
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    if not branch or "--prefix" not in a:
        print("لازم --branch و--prefix.")
        sys.exit(2)
    sys.exit(run(branch_name=branch, prefix=prefix, execute="--yes" in a))
