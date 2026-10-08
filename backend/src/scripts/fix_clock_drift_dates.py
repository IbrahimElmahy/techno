from __future__ import annotations

import sys
from datetime import datetime, timedelta

from sqlalchemy import text

from src.core.db import SessionLocal

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
    return (ts.microsecond == 0 and ts.second == 0 and ts.minute == 0
            and ts.hour in (0, 12))


def _fits(seg: int, ts: datetime, floor: datetime) -> bool:
    _, lo, hi, off = SEGMENTS[seg]
    return lo <= ts <= hi and ts + timedelta(seconds=off) >= floor


def classify(rows: list[tuple[int, datetime]]) -> list[tuple[int, datetime, int | None]]:
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
        plan: list[tuple[str, int, datetime, datetime]] = []
        stray: list[tuple[str, int, datetime]] = []

        for table in _tables(db):
            rows = db.execute(text(
                f'select id, created_at from "{table}" order by id')).all()
            if not rows:
                continue
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
