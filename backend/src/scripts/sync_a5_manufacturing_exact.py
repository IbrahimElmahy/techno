from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.org import Branch
from src.models.warehouse import Warehouse
from src.scripts import backfill_production_orders, import_a5_manufacturing as imp
from src.scripts.import_a5 import _clean, _money, _read


def _expected(db, folder: str, branch_id: int, prefix: str) -> dict[str, dict[str, tuple]]:
    rows = [r for r in _read(os.path.join(folder, "a5_mfg.tsv"))
            if len(r) >= 9 and r[imp.M_TYPE] in (imp.PRODUCE, imp.CONSUME)]
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        groups[_clean(r[imp.M_REF]) or f"AZN{_clean(r[imp.M_AZN])}"].append(r)
    wh = {w.name: w.id for w in db.scalars(select(Warehouse).where(Warehouse.branch_id == branch_id))}
    by_code = {i.code: i.id for i in db.scalars(select(Item)) if i.code}
    by_name: dict[str, int] = {}
    for i in db.scalars(select(Item)):
        by_name.setdefault(i.name, i.id)
    out: dict[str, dict[str, tuple]] = {}
    for ref, lines in groups.items():
        want = {}
        for n, r in enumerate(lines, 1):
            qty = _money(r[imp.M_QTY])
            if qty <= 0:
                continue
            item = by_code.get(f"{prefix}{_clean(r[imp.M_CODE])}") or by_name.get(_clean(r[imp.M_NAME]))
            produce = r[imp.M_TYPE] == imp.PRODUCE
            loc = wh.get(_clean(r[imp.M_IN]) if produce else _clean(r[imp.M_OUT]))
            if item is None or loc is None:
                continue
            want[f"{prefix}MFG-{ref}-{n:03d}"] = (
                "produce" if produce else "consume", item, loc, Decimal(str(qty)).quantize(Decimal("0.001")))
        out[ref] = want
    return out


def _demolish(db, prefix: str, ref: str) -> int:
    ids = [i for (i,) in db.execute(text(
        "select id from production_order where document_number = :d"),
        {"d": f"WO-A5-{prefix}MFG-{ref}"[:24]}).all()]
    for t in ("production_order_receipt", "production_order_material", "production_order_product"):
        db.execute(text(f"delete from {t} where order_id = any(:i)"), {"i": ids})
    db.execute(text("delete from production_order where id = any(:i)"), {"i": ids})
    mv = [m for (m,) in db.execute(text(
        "select stock_movement_id from manufacturing_op where document_number like :p"),
        {"p": f"{prefix}MFG-{ref}-%"}).all() if m]
    n = db.execute(text("delete from manufacturing_op where document_number like :p"),
                   {"p": f"{prefix}MFG-{ref}-%"}).rowcount
    db.execute(text("delete from stock_movement where id = any(:i)"), {"i": mv})
    return n


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        branch = db.scalars(select(Branch).where(Branch.name == branch_name)).one()
        want = _expected(db, folder, branch.id, prefix)
        have: dict[str, dict[str, tuple]] = defaultdict(dict)
        for doc, t, item, loc, qty in db.execute(text("""
                select o.document_number, o.op_type::text, o.item_id, o.location_id, o.quantity
                from manufacturing_op o join warehouse w on w.id = o.location_id
                where o.document_number like :p and w.branch_id = :b"""),
                {"p": f"{prefix}MFG-%", "b": branch.id}).all():
            ref = doc[len(prefix) + 4:].rsplit("-", 1)[0]
            have[ref][doc] = (t, item, loc, Decimal(str(qty)).quantize(Decimal("0.001")))

        redo = sorted(r for r in want if r in have and want[r] != have[r])
        nums = [int(r) for r in want if r.isdigit()]
        floor = min(nums) if nums else 0
        gone = sorted(r for r in have if r not in want and r.isdigit() and int(r) >= floor)
        print(f"فرع {branch_name}: أوامر a5 {len(want)} · عندنا {len(have)} · "
              f"اتعدّلت {len(redo)} · اتمسحت من a5 {len(gone)} · مش عندنا {len(set(want) - set(have))}")
        for r in redo:
            print(f"   اتعدّل: {r}")
        for r in gone:
            print(f"   اتمسح: {r}")
        if not execute:
            print("عرض فقط — `--yes` للتنفيذ.")
            return 0
        for r in redo + gone:
            print(f"   اتشال {r}: {_demolish(db, prefix, r)} عملية")
        db.commit()
    finally:
        db.close()
    imp.run(folder, execute=True, branch_name=branch_name, prefix=prefix)
    backfill_production_orders.run(execute=True, prefix=prefix)
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    folder = a[a.index("--dir") + 1] if "--dir" in a else ""
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    branch = a[a.index("--branch") + 1] if "--branch" in a else ""
    if not folder or not branch or not prefix:
        print("لازم --dir و--branch و--prefix.")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in a))
