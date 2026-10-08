from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.org import Branch
from src.models.warehouse import Warehouse, WarehouseType
from src.scripts.import_a5 import _clean, _money, _read
from src.scripts.import_a5_docs import KIND, L_AZN, L_IN, L_NAME, L_OUT, L_QTY, L_TYPE


def run(folder: str, *, branch_name: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None:
            print(f"الفرع «{branch_name}» مش موجود.")
            return 2

        ours = {w.name.strip() for w in db.scalars(select(Warehouse)).all()}
        rows = defaultdict(int)
        qty: dict[str, Decimal] = defaultdict(Decimal)
        items: dict[str, set] = defaultdict(set)
        docs: dict[str, set] = defaultdict(set)

        for r in _read(os.path.join(folder, "a5_lines.tsv")):
            if len(r) <= L_QTY:
                continue
            q = Decimal(str(_money(r[L_QTY])))
            for col in (L_IN, L_OUT):
                nm = _clean(r[col])
                if not nm or nm in ours:
                    continue
                rows[nm] += 1
                qty[nm] += q
                items[nm].add(_clean(r[L_NAME]))
                docs[nm].add((r[L_TYPE].strip(), r[L_AZN].strip()))

        if not rows:
            print("كل مخازن a5 موجودة عندنا — مافيش حاجة تتعمل.")
            return 0

        print(f"مخازن في a5 ومش عندنا: {len(rows)}   (الفرع: {branch_name})\n")
        for nm, n in sorted(rows.items(), key=lambda x: -x[1]):
            kinds = defaultdict(int)
            for t, _a in docs[nm]:
                kinds[KIND.get(t, (t,))[0]] += 1
            what = " · ".join(f"{k} {v}" for k, v in sorted(kinds.items()))
            print(f"   «{nm}»")
            print(f"      {n} صف · {len(items[nm])} صنف · كمية {qty[nm]} · {what or '—'}")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            return 0

        for nm in rows:
            db.add(Warehouse(
                name=nm, warehouse_type=WarehouseType.branch, branch_id=branch.id,
                description="اتعمل من تصدير a5 — مخزن موجود عندهم وماكانش عندنا",
                active=True))
        db.commit()
        print(f"\nاتعمل {len(rows)} مخزن.")
        print("شغّل `rebuild_a5_docs` بعده عشان المستندات اللي اترفضت تنزل.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    if not branch:
        print("لازم --branch (اسم الفرع اللي المخزن يتبعه).")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, execute="--yes" in args))
