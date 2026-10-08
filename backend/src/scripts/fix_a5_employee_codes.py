from __future__ import annotations

import csv
import os
import sys

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text

from src.core.db import SessionLocal, engine
from src.models.employee import Employee

RECODE: dict[str, tuple[str, str]] = {
    "EMP-0001": ("A5E-4", "أكتوبر"),
}

BUCKETS = (
    "EMP-0096",
    "EMP-0097",
    "EMP-0098",
    "EMP-0099",
    "EMP-0100",
    "EMP-0101",
    "EMP-0102",
    "EMP-0103",
)


def _emp_rows(folder: str) -> dict[str, str]:
    path = os.path.join(folder, "a5_emp.tsv")
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — شغّل a5_sync.ps1 -ExportOnly الأول.")
    out: dict[str, str] = {}
    with open(path, encoding="utf-8", newline="") as fh:
        for r in csv.reader(fh, delimiter="~"):
            if r and r[0] == "EMP" and len(r) > 2:
                out.setdefault((r[2] or "").strip(), r[1])
    return out


def _refs(db, emp_id: int) -> list[str]:
    insp = sa_inspect(engine)
    hits: list[str] = []
    for t in insp.get_table_names():
        for fk in insp.get_foreign_keys(t):
            if fk.get("referred_table") != "employee":
                continue
            col = fk["constrained_columns"][0]
            n = db.execute(text(f'SELECT count(*) FROM "{t}" WHERE {col} = :i'),
                           {"i": emp_id}).scalar()
            if n:
                hits.append(f"{t}.{col}={n}")
    return hits


def run(folder: str, *, execute: bool) -> None:
    by_name = _emp_rows(folder)
    db = SessionLocal()
    try:
        taken = {c for (c,) in db.execute(select(Employee.code)).all()}
        recode: list[tuple[Employee, str]] = []
        off: list[tuple[Employee, list[str]]] = []
        notes: list[str] = []

        for old, (new, _br) in RECODE.items():
            e = db.scalar(select(Employee).where(Employee.code == old))
            if e is None:
                notes.append(f"{old}: مش موجود — اتخطّى")
                continue
            a5id = by_name.get((e.name or "").strip())
            if a5id is None:
                notes.append(f"{old} «{e.name}»: مش في كشف a5 — اتخطّى")
                continue
            want = f"A5E-{a5id}"
            if want != new:
                notes.append(f"{old} «{e.name}»: a5 بيقول {want} والسكربت بيقول {new} — اتخطّى")
                continue
            if want in taken:
                notes.append(f"{old} «{e.name}»: {want} محجوز لحد تاني — اتخطّى")
                continue
            recode.append((e, want))

        for code in BUCKETS:
            e = db.scalar(select(Employee).where(Employee.code == code))
            if e is None:
                notes.append(f"{code}: مش موجود — اتخطّى")
                continue
            if not e.active:
                notes.append(f"{code} «{e.name}»: معطّل خلاص")
                continue
            off.append((e, _refs(db, e.id)))

        print(f"{'كود هيترجّع لكود a5':<34}{len(recode):>6}")
        for e, want in recode:
            print(f"   {e.code} → {want:<10} «{e.name}»")
        print(f"\n{'دلو هيتعطّل':<34}{len(off):>6}")
        for e, hits in off:
            print(f"   {e.code:<10} «{(e.name or '')[:26]:<26}» مراجع: {hits or 'مفيش'}")
        blocked = [e.code for e, hits in off if hits]
        if blocked:
            print(f"\n⚠ فيه مراجع على {blocked} — هيتساب زي ما هو.")
        if notes:
            print("\nملاحظات:")
            for n in notes:
                print("   •", n)
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for e, want in recode:
            e.code = want
        n_off = 0
        for e, hits in off:
            if hits:
                continue
            e.active = False
            n_off += 1
        db.commit()

        left = db.scalars(select(Employee).where(Employee.code.like("EMP-%"),
                                                 Employee.active.is_(True))).all()
        print(f"\n✔ اترجّع {len(recode)} كود · اتعطّل {n_off} دلو")
        print(f"   لسه بكود EMP- ونشط: {len(left)}")
        for e in left:
            print(f"      {e.code:<10} {e.name}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
