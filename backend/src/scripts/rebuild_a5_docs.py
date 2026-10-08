from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.stock import StockMovement
from src.scripts import import_a5_docs
from src.scripts.audit_a5_doc_drift import TABLES, collect

DOC_TYPE = {
    "7": "sales_invoice",
    "2": "sales_return",
    "1": "purchase_invoice",
    "11": "purchase_return",
    "6": "stock_transfer",
    "3": "stock_permit",
    "8": "stock_permit",
}


def _demolish(db, a5_type: str, number: str) -> tuple[int, int]:
    head_cls, line_cls, fk = TABLES[a5_type]
    head = db.scalar(select(head_cls).where(head_cls.document_number == number))
    if head is None:
        return 0, 0

    moves = db.scalars(
        select(StockMovement).where(
            StockMovement.source_doc_type == DOC_TYPE[a5_type],
            StockMovement.source_doc_id == head.id)).all()
    lines = db.scalars(select(line_cls).where(getattr(line_cls, fk) == head.id)).all()

    for ln in lines:
        db.delete(ln)
    db.flush()
    for mv in moves:
        db.delete(mv)
    db.flush()
    db.delete(head)
    db.flush()
    return len(lines), len(moves)


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        drift, missing, _unresolved = collect(db, folder, prefix)
        if not drift and not missing:
            print("مافيش مستند مختلف — كله زي a5.")
            return 0

        by_kind: dict[str, int] = defaultdict(int)
        for d in drift:
            by_kind[d.label] += 1
        print(f"مستندات هتتعاد: {len(drift)}")
        for k, n in sorted(by_kind.items(), key=lambda x: -x[1]):
            print(f"   {k:<18}{n:>5}")
        for d in drift:
            print(f"   {d.number:<14}{d.doc_date}  {d.label}")
        if missing:
            print(f"\nومستندات في a5 ومش عندنا خالص ({len(missing)}) — "
                  "الاستيراد هيحاول يعملها، وأي سبب تخطّي هيتقال في تقريره:")
            for label, number, dt in missing[:20]:
                print(f"   {number:<14}{dt}  {label}")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            return 0

        print("\n— الهدم —")
        total_lines = total_moves = 0
        for d in drift:
            n_lines, n_moves = _demolish(db, d.a5_type, d.number)
            total_lines += n_lines
            total_moves += n_moves
            print(f"   {d.number:<14} اتشال: {n_lines} سطر، {n_moves} حركة")
        db.commit()
        print(f"إجمالي: {total_lines} سطر، {total_moves} حركة مخزون")

        print("\n— إعادة البناء —")
        import_a5_docs.run(folder, execute=True, branch_name=branch_name, prefix=prefix)

        db.expire_all()

        drift2, missing2, _ = collect(db, folder, prefix)
        print(f"\nبعد الإعادة: مختلف {len(drift2)}   مش عندنا {len(missing2)}")
        for d in drift2:
            print(f"   لسه مختلف: {d.number} ({d.label})")
        return 0 if not drift2 else 1
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    if not branch:
        print("لازم --branch (اسم الفرع عندنا) — الاستيراد بيتعلّق بيه.")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in args))
