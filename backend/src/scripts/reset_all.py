from __future__ import annotations

import sys

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text

import src.models  # noqa: F401
from src.core.db import SessionLocal, engine

KEEP: set[str] = {
    "user", "role", "role_capability",
    "branch", "governorate", "head_office", "territory",
    "lookup_option", "sales_setting", "stock_setting", "payroll_setting",
    "department", "job_title", "cost_center", "voucher_key", "salary_component",
    "work_shift", "leave_type", "holiday", "payroll_scheme_version",
    "payroll_scheme_bracket",
    "coupon_type", "inspection_item_type",
    "alembic_version",
}

UNLINK = (
    "UPDATE salary_component SET account_id = NULL",
    "UPDATE voucher_key SET debit_account_id = NULL, credit_account_id = NULL",
    "UPDATE department SET manager_employee_id = NULL, cost_center_id = NULL",
    "UPDATE account SET parent_id = NULL",
    "UPDATE employee SET warehouse_id = NULL, department_id = NULL",
)


def _all_tables() -> list[str]:
    return sa_inspect(engine).get_table_names()


def _targets() -> list[str]:
    return [t for t in _all_tables() if t not in KEEP]


def _delete_group() -> list[str]:
    insp = sa_inspect(engine)
    tables = set(_all_tables())
    group: set[str] = set()
    frontier = [t for t in KEEP if t in tables]
    seen_sources: set[str] = set()
    while frontier:
        src = frontier.pop()
        if src in seen_sources:
            continue
        seen_sources.add(src)
        for fk in insp.get_foreign_keys(src):
            ref = fk.get("referred_table")
            if ref and ref not in KEEP and ref not in group:
                group.add(ref)
                frontier.append(ref)

    refs = {t: {fk.get("referred_table") for fk in insp.get_foreign_keys(t)} - {t}
            for t in group}
    order: list[str] = []
    remaining = set(group)
    while remaining:
        free = [t for t in sorted(remaining)
                if not any(t in refs[o] for o in remaining if o != t)]
        if not free:
            free = sorted(remaining)
        order.extend(free)
        remaining -= set(free)
    return order


def _count(db, name: str) -> int:
    return db.scalar(text(f'SELECT count(*) FROM "{name}"')) or 0


def run(*, execute: bool) -> None:
    if engine.dialect.name != "postgresql":
        print(f"✘ التخزين هنا «{engine.dialect.name}» مش postgresql — وقفت.")
        return

    targets = _targets()
    by_delete = _delete_group()
    by_truncate = [t for t in targets if t not in by_delete]

    db = SessionLocal()
    try:
        counts = {t: _count(db, t) for t in targets}
        counts = {t: n for t, n in counts.items() if n}
        total = sum(counts.values())

        print(f"هيتمسح {total:,} صف من {len(counts)} جدول:\n")
        for t, n in sorted(counts.items(), key=lambda kv: -kv[1])[:30]:
            how = "DELETE  " if t in by_delete else "TRUNCATE"
            print(f"   {how} {t:<34}{n:>10,}")
        if len(counts) > 30:
            print(f"   ... و{len(counts) - 30} جدول تاني")
        print(f"\nبـDELETE (عليهم مفتاح من جدول محفوظ): {'، '.join(by_delete) or '—'}")

        kept_counts = {t: _count(db, t) for t in sorted(KEEP & set(_all_tables()))}
        print("\nهيفضل:")
        for t, n in sorted(kept_counts.items()):
            print(f"   {t:<34}{n:>10,}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for sql in UNLINK:
            db.execute(text(sql))

        quoted = ", ".join(f'"{t}"' for t in by_truncate)
        db.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY"))
        for t in by_delete:
            db.execute(text(f'DELETE FROM "{t}"'))
            db.execute(text(
                f"SELECT setval(pg_get_serial_sequence('\"{t}\"', 'id'), 1, false)"))
        db.commit()

        left = sum(_count(db, t) for t in targets)
        print(f"\n✔ اتمسح. الفاضل في الجداول دي: {left}")
        bad = 0
        for t, n in sorted(kept_counts.items()):
            now = _count(db, t)
            mark = "✔" if now == n else "✘"
            bad += now != n
            print(f"{mark} {t}: {now} (كان {n})")
        if bad or left:
            print("\n✘ حاجة اتغيّرت مش المفروض تتغيّر — راجع قبل أي استيراد.")
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
