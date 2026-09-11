"""نقل القيود القديمة لدفاترها وترقيمها — المرحلة ١ من إعادة الهيكلة على موديل أودو.

    python -m src.scripts.backfill_journals            # عرض بس، مابيكتبش حاجة
    python -m src.scripts.backfill_journals --yes      # التنفيذ

**المشكلة:** كل قيد في الدفتر اتكتب قبل ما فكرة «الدفتر» توجد، فأعمدة `journal_id`
و`state` و`number` بتبقى NULL على كل الصفوف القديمة. النظام شغّال كده (الكود بيعامل
`state IS NULL` على إنها «مرحّل»)، بس شاشة «دفتر المبيعات» بتطلع فاضية والقيد مالوش
رقم يتقال في التليفون.

**اللي بيحصل هنا:**

١. الدفاتر القياسية بتتزرع لو لسه مش موجودة (`journal_registry.ensure_seeded`).
٢. كل قيد بياخد دفتره من `entry_type` — الخريطة في `journal_registry._ROUTING`.
   النوع اللي مش في الخريطة بيروح «قيود متنوعة» (MISC) بدل ما يفضل بره الدفاتر.
٣. كل قيد بياخد رقمه في دفتره: الترتيب بتاريخ القيد ثم الـid، والترقيم بيتصفّر مع
   كل سنة — `INV/2025/00001`. الترتيب بالتاريخ مش بالـid عشان الأرقام تطلع بنفس
   ترتيب الورق؛ القيد اللي اتسجّل متأخر بتاريخ قديم بياخد رقمه في مكانه الصح.
٤. `state` بيتملى `posted` على كل القديم. المسودة مالهاش وجود قبل المرحلة دي.

**بيقيس ومابيصلّحش:** القيود غير المتوازنة بتتعدّ وبتتعرض (لحد ٢٠ منها) ومابيتعملهاش
حاجة. القاعدة الجديدة بترفض ترحيل قيد مش متوازن، بس القديم اتكتب أيام ما القاعدة دي
كانت مشالة — وتصحيحه قرار محاسبي مش قرار سكربت.

**بيتعاد بأمان:** القيد اللي معاه رقم خلاص بيتسكّت عنه، فالتشغيل التاني مابيغيّرش حاجة.
عدّاد الدفتر بيتظبط على أعلى رقم اتصرف، فالقيد الجديد بيكمّل من بعده مش من الأول.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.db import SessionLocal
from src.core.money import ZERO, to_money
from src.models.journal import Journal, JournalSequence
from src.models.ledger import Direction, EntryState, LedgerEntry
from src.services import journal_registry

SAMPLE = 20


def _effective_date(entry: LedgerEntry) -> date:
    """تاريخ القيد المحاسبي — `entry_date`، ووقت الإنشاء للقديم اللي مالوش واحد."""
    return entry.entry_date or entry.created_at.date()


def _sides(entry: LedgerEntry) -> tuple[Decimal, Decimal]:
    debit = sum(
        (to_money(ln.amount) for ln in entry.lines if ln.direction == Direction.debit), ZERO
    )
    credit = sum(
        (to_money(ln.amount) for ln in entry.lines if ln.direction == Direction.credit), ZERO
    )
    return to_money(debit), to_money(credit)


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        journal_registry.ensure_seeded(db)
        if execute:
            db.commit()
        journals = {j.code: j for j in db.scalars(select(Journal)).all()}
        print(f"الدفاتر: {len(journals)} — " + "، ".join(f"{j.code} {j.name}" for j in
                                                          sorted(journals.values(),
                                                                 key=lambda x: x.sort_order)))

        entries = db.scalars(
            select(LedgerEntry).options(selectinload(LedgerEntry.lines))
        ).all()
        print(f"\nالقيود في الدفتر: {len(entries)}")
        if not entries:
            print("مافيش قيود — مافيش حاجة تتنقل.")
            return

        # العدّاد بيبدأ من أعلى رقم اتصرف فعلاً، عشان الإعادة ماتديش رقم اتاخد قبل كده.
        counters: dict[tuple[int, int], int] = defaultdict(int)
        for row in db.scalars(select(JournalSequence)).all():
            counters[(row.journal_id, row.year)] = int(row.last_number or 0)

        already = sum(1 for e in entries if e.number)
        todo = [e for e in entries if not e.number]
        print(f"معاها رقم خلاص: {already} — محتاجة ترقيم: {len(todo)}")

        # الترتيب بالتاريخ ثم الـid: القيد المتأخر بتاريخ قديم بياخد رقمه في مكانه.
        todo.sort(key=lambda e: (_effective_date(e), e.id))

        per_journal: dict[str, int] = defaultdict(int)
        unknown_types: dict[str, int] = defaultdict(int)
        unbalanced: list[tuple[int, Decimal, Decimal]] = []
        first_last: dict[str, tuple[str, str]] = {}

        for entry in todo:
            code = journal_registry.journal_code_for(entry.entry_type)
            if not journal_registry.is_known_type(entry.entry_type):
                unknown_types[entry.entry_type] += 1
            journal = journals.get(code) or journals[journal_registry.FALLBACK_CODE]
            when = _effective_date(entry)
            key = (journal.id, when.year)
            counters[key] += 1
            number = journal_registry.format_number(journal.code, when.year, counters[key])

            debit, credit = _sides(entry)
            if debit != credit:
                unbalanced.append((entry.id, debit, credit))

            per_journal[journal.code] += 1
            prev = first_last.get(journal.code)
            first_last[journal.code] = ((prev[0] if prev else number), number)

            if execute:
                entry.journal_id = journal.id
                entry.number = number
                entry.state = EntryState.posted.value
                if entry.posted_at is None:
                    entry.posted_at = entry.created_at

        # القيود اللي معاها رقم بس حالتها لسه NULL — بتتظبط من غير ما ترقيمها يتلمس.
        state_only = [e for e in entries if e.number and not e.state]
        if execute:
            for entry in state_only:
                entry.state = EntryState.posted.value

        print("\nالتوزيع على الدفاتر:")
        for code in sorted(per_journal, key=lambda c: journals[c].sort_order):
            lo, hi = first_last[code]
            print(f"  {code:<5} {journals[code].name:<22} {per_journal[code]:>6}   {lo} → {hi}")

        if state_only:
            print(f"\nحالتها بس اتظبطت (كان معاها رقم): {len(state_only)}")

        if unknown_types:
            print("\n⚠ أنواع قيود مش في الخريطة — راحت «قيود متنوعة»:")
            for t, n in sorted(unknown_types.items(), key=lambda kv: -kv[1]):
                print(f"  {t}: {n}")

        if unbalanced:
            print(f"\n⚠ قيود غير متوازنة: {len(unbalanced)} — "
                  "السكربت ماغيّرش فيها حاجة، بس القاعدة الجديدة كانت هترفض ترحيلها.")
            for eid, d, c in unbalanced[:SAMPLE]:
                print(f"  قيد #{eid}: مدين {d} — دائن {c} — الفرق {to_money(abs(d - c))}")
            if len(unbalanced) > SAMPLE:
                print(f"  ... و{len(unbalanced) - SAMPLE} كمان")
        else:
            print("\n✔ كل القيود متوازنة.")

        if not execute:
            print("\n(عرض بس — ضيف --yes للتنفيذ)")
            return

        # العدّادات بتتكتب بعد ما كل الأرقام اتصرفت، عشان القيد الجديد يكمّل من بعدها.
        existing = {
            (r.journal_id, r.year): r for r in db.scalars(select(JournalSequence)).all()
        }
        for (journal_id, year), last in counters.items():
            row = existing.get((journal_id, year))
            if row is None:
                db.add(JournalSequence(journal_id=journal_id, year=year, last_number=last))
            else:
                row.last_number = max(int(row.last_number or 0), last)

        db.commit()
        print(f"\n✔ اتنقل {len(todo)} قيد لدفاترها، وعدّادات الترقيم اتظبطت.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv)
