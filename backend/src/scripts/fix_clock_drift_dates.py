"""ساعة السيرفر رجعت لورا ٤ أيام، وكل صف اتكتب في الفترة دي تاريخه غلط. درايَ-رن بالافتراضي.

    python -m src.scripts.fix_clock_drift_dates
    python -m src.scripts.fix_clock_drift_dates --yes

---------------------------------------------------------------------------
**المشكلة.** بطارية ساعة اللوحة في `A5SERVER` ماتت، والساعة الداخلية واقفة على
`2026-09-10 08:59`. الكهربا بتقطع، الجهاز بيقوم من غير إغلاق سليم (`Kernel-Power 41`
في كل مرة)، وويندوز بياخد الوقت من الساعة الواقفة دي — فالسيرفر بيرجع لـ١٠ سبتمبر
مهما كان اليوم الحقيقي. وخدمة الوقت مابتظبّطهاش غير لما تقدر توصل لسيرفر NTP، وده
بيحصل بعد ساعات أو بعد يوم.

النتيجة **مش انحراف واحد** — تلات نوبات، كل واحدة بين قيامة بعد انقطاع وبين أول مرة
الـNTP وصل بعدها. المقادير مقروءة من سجل أحداث ويندوز نفسه (`Time-Service` حدث ٥٢
بيكتب فرق التصحيح بالثانية) فمحدش قدّرها بالعين:

| النوبة | الساعة كانت بتقول | الحقيقي | الفرق |
|---|---|---|---|
| EA | ١٠ سبتمبر ٠٨:٥٩ ← ١٩:٥٧ | ١٢ سبتمبر ٠٩:٠٣ ← ٢٠:٠١ | ١٧٣٬٠٦٦ ث (يومين و٤ دقايق) |
| EB | ١٠ سبتمبر ٠٨:٥٩ ← ١٨:١٨ | ١٣ سبتمبر ٠٨:٥٨ ← ١٨:١٧ | ٢٥٩٬١٥٩ ث (٣ أيام ناقص ٤١ ثانية) |
| EC | ١٠ سبتمبر ٠٨:٥٩ ← ١٢ سبتمبر ١٤:١٩ | ١٤ سبتمبر ٠٨:٤١ ← ١٦ سبتمبر ١٤:٠١ | ٣٤٤٬٥٠١ ث (٤ أيام ناقص ١٨ دقيقة) |

وبين النوبات الساعة كانت مظبوطة — من ١٢ سبتمبر ٢٠:٠١ لحد ٢٣:٠١، ومن ١٣ سبتمبر ١٨:١٧
لحد ٢٣:٥١. فالفترة مش متصلة، ومافيش «اطرح ٤ أيام من كل حاجة».

**اتقاس على قاعدة الإنتاج: ٦٬٦٢٧ صف في ١١ جدول.** أكبرهم `stock_movement` (٤٬٧٦٠)،
`ledger_entry` (٨٢٢)، `audit_log_entry` (٤٩٧)، `sales_invoice` (٣٨٧)،
`stock_transfer` (١١٦).

**والغلط ده بيتشاف.** `created_at` مش عمود إداري هنا — الفلترة شغّالة عليه:
`sales.py:904,968,1079` (كشف الفواتير وملخص المبيعات والمرتجعات)،
`stocktake.py:65` (الرصيد بتاريخ معيّن — بيجمّع الحركات اللي `created_at` بتاعها قبل
اليوم)، `item_profile_service.py:363` (كارت الصنف)، `commission_service.py:130`
(عمولة المندوب بالفترة)، `audit.py:58` (شاشة السجل). يعني إذن تحويل اتعمل ١٦ سبتمبر
بيظهر في رصيد ١٢ سبتمبر، وبيع يوم ١٥ مابيدخلش في ملخص يوم ١٥.

**اللي مش متأثر: التواريخ اللي مصدرها مش الساعة.** `entry_date` على القيد (٨٢٢ من
٨٢٢ متعبّي) و`invoice_date` على الفاتورة جايين من a5 أو من المتصفح، فميزان المراجعة
وكشف الحساب وتاريخ الفاتورة كلهم صح. اللي غلط هو «الصف ده اتكتب امتى» بس. وكله جوّه
سبتمبر — مافيش مستند بيعدّي على شهر تاني.

**والدليل إن الحساب صح مش استنتاج.** العميل كتب ٤ سندات قبض بإيده في الفترة دي،
و`voucher_date` فيهم جاي من المتصفح (جهاز العميل ساعته مظبوطة) مش من السيرفر. بعد
التصحيح كل سند بيقع على تاريخه بالظبط:

    RCV-000001  ١٠ سبتمبر ١٨:٣٠ → ١٢ سبتمبر ١٨:٣٤   وتاريخ السند ١٢ سبتمبر ✔
    RCV-000002  ١٠ سبتمبر ١٣:١٦ → ١٣ سبتمبر ١٣:١٦   وتاريخ السند ١٣ سبتمبر ✔
    RCV-000003  ١١ سبتمبر ١٤:٤٦ → ١٥ سبتمبر ١٤:٢٧   وتاريخ السند ١٥ سبتمبر ✔
    RCV-000004  ١٢ سبتمبر ١٢:١٩ → ١٦ سبتمبر ١٢:٠١   وتاريخ السند ١٦ سبتمبر ✔

٤ من ٤. ونفس الشيء على القيود المقابلة لهم (`entry_date` ١٢/١٣/١٥/١٦).

**ليه المشي بالـid مش بالساعة لوحدها.** النوبات التلاتة بتقرا نفس التواريخ تقريباً
(كلهم بيبتدوا من ١٠ سبتمبر ٠٨:٥٩)، فالتاريخ المخزّن لوحده مابيقولش النوبة. الـid
بيقول: بيزيد مع الوقت الحقيقي مهما الساعة قالت إيه. فالسكربت بيمشي بالـid وبينتقل
للنوبة اللي بعدها أول ما الصف مايركبش على اللي هو فيها — إما لأن التاريخ برّه مداها،
أو لأن التصحيح هيرجّع الوقت لورا عن الصف اللي قبله. والقفزة مابتتاخدش على صف واحد
لوحده؛ بيتأكد من الصف اللي بعده كمان، عشان صف شاذ مايقلبش باقي الجدول.

⛔ **وبيسيب التواريخ المزروعة زي ما هي.** `backdate_a5_documents` بيحطّ تاريخ المستند
+ ١٢ ظهراً بالظبط، و`earn_points_backfill` بيحطّ نص الليل بالظبط. دول تواريخ مستندات
مكتوبة بإيدنا مش قراءة ساعة، والسكربت بيتخطّى أي صف ساعته `00:00:00.000000` أو
`12:00:00.000000`. من غير الحارس ده كان هيزوّد ٤ أيام على ١٥٧ صف نقاط و٤٠٠ مستند a5
مؤرّخين صح.

والصف اللي مايركبش على أي نوبة بيتقال **ومايتلمسش** — في الإنتاج ده صف واحد
(`audit_log_entry#198`، طلب بيع فشل بـ409 يوم ١٠ سبتمبر ٢١:١١، والساعة كانت لسه
مظبوطة ساعتها). الجهل مش سبب للتعديل.

⚠️ **والتعديل ده مالوش رجوع** — القيمة القديمة مش متخزّنة في مكان تاني. عشان كده
درايَ-رن بالافتراضي، والأرقام بتتطبع جدول جدول قبل أي كتابة.

⛔ **وده بيصلّح الداتا مش السبب.** طول ما بطارية اللوحة ميتة و`w32time` مش مضمونة،
أول انقطاع كهربا جاي هيرجّع الساعة لـ١٠ سبتمبر تاني والمشكلة هتتكرر من أولها.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta

from sqlalchemy import text

from src.core.db import SessionLocal

# (الاسم، أول قراءة ساعة في الفترة، آخر قراءة، الثواني اللي تتزاد)
#
# الحدود جاية من سجل أحداث ويندوز مش من الداتا: القيامة بتدّي أول قراءة
# (`Kernel-General 12`)، وتصحيح الـNTP بيدّي آخر قراءة والفرق بالثانية
# (`Kernel-General 1` + `Time-Service 52`). الفترات المظبوطة بينهم مكتوبة كمان عشان
# المشي بالـid يعرف يعدّي عليها.
SEGMENTS: list[tuple[str, datetime, datetime, int]] = [
    ("سليم (قبل العطل)", datetime(2000, 1, 1),            datetime(2026, 9, 10, 18, 0, 0),   0),
    ("EA  ١٢ سبتمبر",    datetime(2026, 9, 10, 8, 59, 15), datetime(2026, 9, 10, 19, 57, 5),  173066),
    ("سليم ١٢ سبتمبر",   datetime(2026, 9, 12, 20, 1, 31), datetime(2026, 9, 12, 23, 1, 3),   0),
    ("EB  ١٣ سبتمبر",    datetime(2026, 9, 10, 8, 59, 29), datetime(2026, 9, 10, 18, 18, 6),  259159),
    ("سليم ١٣ سبتمبر",   datetime(2026, 9, 13, 18, 17, 25), datetime(2026, 9, 13, 23, 51, 10), 0),
    ("EC  ١٤–١٦ سبتمبر", datetime(2026, 9, 10, 8, 59, 44), datetime(2026, 9, 12, 14, 19, 46), 344501),
    ("سليم (بعد الضبط)", datetime(2026, 9, 16, 14, 1, 28), datetime(2030, 1, 1),              0),
]


def _planted(ts: datetime) -> bool:
    """تاريخ مزروع بإيدنا مش قراءة ساعة — نص الليل أو ١٢ ظهراً بالثانية والميكرو."""
    return (ts.microsecond == 0 and ts.second == 0 and ts.minute == 0
            and ts.hour in (0, 12))


def _fits(seg: int, ts: datetime, floor: datetime) -> bool:
    _, lo, hi, off = SEGMENTS[seg]
    return lo <= ts <= hi and ts + timedelta(seconds=off) >= floor


def classify(rows: list[tuple[int, datetime]]) -> list[tuple[int, datetime, int | None]]:
    """(id، التاريخ المخزّن) بترتيب الـid → (id، التاريخ، رقم النوبة أو None لو مش راكب)."""
    out: list[tuple[int, datetime, int | None]] = []
    seg, floor = 0, datetime(2000, 1, 1)
    for i, (row_id, ts) in enumerate(rows):
        if _planted(ts):
            out.append((row_id, ts, None))
            continue
        pick = None
        for cand in range(seg, len(SEGMENTS)):
            if not _fits(cand, ts, floor):
                continue
            if cand > seg:
                # قفزة لنوبة جديدة مابتتاخدش على صف واحد: الصف اللي بعده لازم يركب
                # عليها هي أو على اللي بعدها. صف شاذ لوحده بيفضل بره ومايقلبش الجدول.
                nxt = rows[i + 1] if i + 1 < len(rows) else None
                after = ts + timedelta(seconds=SEGMENTS[cand][3])
                if nxt is not None and not any(
                        _fits(s, nxt[1], after) for s in range(cand, len(SEGMENTS))):
                    continue
            pick = cand
            break
        if pick is None:
            out.append((row_id, ts, None))
            continue
        seg, floor = pick, ts + timedelta(seconds=SEGMENTS[pick][3])
        out.append((row_id, ts, pick))
    return out


def _tables(db) -> list[str]:
    """كل جدول فيه `created_at` و`id` — الجرد مش قايمة مكتوبة بالإيد عشان مايفوتش جدول."""
    return [r[0] for r in db.execute(text("""
        select c.table_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_name = c.table_name and t.table_schema = c.table_schema
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and c.column_name = 'created_at'
          and exists (select 1 from information_schema.columns c2
                      where c2.table_schema = 'public' and c2.table_name = c.table_name
                        and c2.column_name = 'id')
        order by 1""")).all()]


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        plan: list[tuple[str, int, datetime, datetime]] = []   # (جدول، id، من، لـ)
        stray: list[tuple[str, int, datetime]] = []

        for table in _tables(db):
            rows = db.execute(text(
                f'select id, created_at from "{table}" order by id')).all()
            if not rows:
                continue
            # (النوبة، أول id، آخر id، العدد، أول تاريخ، آخر تاريخ)
            runs: list[list] = []
            hit = 0
            for row_id, ts, seg in classify([(r[0], r[1]) for r in rows]):
                off = SEGMENTS[seg][3] if seg is not None else 0
                if off:
                    plan.append((table, row_id, ts, ts + timedelta(seconds=off)))
                    hit += 1
                elif seg is None and not _planted(ts):
                    stray.append((table, row_id, ts))
                if runs and runs[-1][0] == seg:
                    runs[-1][2], runs[-1][3], runs[-1][5] = row_id, runs[-1][3] + 1, ts
                else:
                    runs.append([seg, row_id, row_id, 1, ts, ts])
            if not hit:
                continue
            print(f"\n{table}: {hit} صف")
            for seg, first, last, count, lo, hi in runs:
                if seg is None or not SEGMENTS[seg][3]:
                    continue
                name, _, _, off = SEGMENTS[seg]
                shift = timedelta(seconds=off)
                print(f"   {name:<18} id {first}..{last}  ({count} صف)   "
                      f"{lo:%m-%d %H:%M} .. {hi:%m-%d %H:%M}  →  "
                      f"{lo + shift:%m-%d %H:%M} .. {hi + shift:%m-%d %H:%M}")

        total = len(plan)
        moved_day = sum(1 for _t, _i, a, b in plan if a.date() != b.date())
        moved_month = sum(1 for _t, _i, a, b in plan if a.month != b.month)
        print(f"\n{'=' * 70}")
        print(f"إجمالي الصفوف: {total}   بتغيّر اليوم: {moved_day}   "
              f"بتغيّر الشهر: {moved_month}")
        print(f"{'=' * 70}")

        if stray:
            print(f"\nصفوف مش راكبة على أي نوبة — **مااتلمستش**: {len(stray)}")
            for table, row_id, ts in stray[:20]:
                print(f"   {table}#{row_id}   {ts}")

        if not total:
            print("مافيش حاجة تتصلّح.")
            return 0

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ — **والتعديل مالوش رجوع**.")
            return 0

        for table, row_id, _old, new in plan:
            db.execute(text(f'update "{table}" set created_at = :ts where id = :id'),
                       {"ts": new, "id": row_id})
        db.commit()
        print(f"\nاتظبط {total} صف.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
