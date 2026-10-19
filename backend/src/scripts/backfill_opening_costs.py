from __future__ import annotations

import argparse
import os
from decimal import Decimal

from sqlalchemy import inspect, select, update

from src.core.db import SessionLocal, engine
from src.core.money import to_money
from src.models.catalog import Item
from src.models.org import Branch
from src.models.stock import StockDirection, StockMovement
from src.scripts.import_a5 import _clean, _money, _read, mine
from src.services.a5_item_map import A5ItemMap
from src.services.costing_service import OPENING_DOC

ZERO = Decimal(0)


def _file_costs(rows: list[list[str]], a5map: A5ItemMap):
    qty: dict[int, Decimal] = {}
    value: dict[int, Decimal] = {}
    unknown, uncosted = [], 0
    file_value = ZERO
    for r in rows:
        if len(r) < 9:
            continue
        q = _money(r[4]) or _money(r[5]) or _money(r[6])
        v = _money(r[8])
        if q <= 0:
            continue
        file_value += v
        it = a5map.find(r[0], r[1])
        if it is None:
            unknown.append(f"{_clean(r[1])} ({_clean(r[0])})")
            continue
        if v <= 0:
            uncosted += 1
            continue
        qty[it.id] = qty.get(it.id, ZERO) + q
        value[it.id] = value.get(it.id, ZERO) + v
    costs = {i: (value[i] / qty[i]).quantize(Decimal("0.0001")) for i in qty if qty[i] > 0}
    return costs, unknown, uncosted, file_value


def run(*, folder: str, branch_name: str, prefix: str, execute: bool) -> None:
    rows = _read(os.path.join(folder, "a5_open.tsv"))
    has_column = "unit_cost" in {c["name"] for c in inspect(engine).get_columns("stock_movement")}
    db = SessionLocal()
    try:
        branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{branch_name}»")
        items = mine(db.scalars(select(Item)).all(), prefix)
        costs, unknown, uncosted, file_value = _file_costs(rows, A5ItemMap(db, prefix, items))

        moves = db.execute(
            select(StockMovement.id, StockMovement.item_id, StockMovement.quantity)
            .where(StockMovement.source_doc_type == OPENING_DOC,
                   StockMovement.direction == StockDirection.in_,
                   StockMovement.branch_id == branch.id)).all()
        plan: dict[Decimal, list[int]] = {}
        valued, no_cost_qty, no_cost_items = ZERO, ZERO, set()
        for mv_id, item_id, q in moves:
            c = costs.get(item_id)
            if c is None:
                no_cost_items.add(item_id)
                no_cost_qty += Decimal(str(q))
                continue
            plan.setdefault(c, []).append(mv_id)
            valued += Decimal(str(q)) * c
        hits = sum(len(v) for v in plan.values())

        print(f"الفرع: {branch.name} · الملف: {folder}")
        print(f"   صفوف الملف                    {len(rows):>10,}")
        print(f"   قيمة رصيد أول المدة في a5      {to_money(file_value):>14,}")
        print(f"   أصناف مش لاقيينها عندنا        {len(unknown):>10,}")
        print(f"   صفوف من غير تكلفة في a5        {uncosted:>10,}")
        print(f"   حركات رصيد أول المدة عندنا      {len(moves):>10,}")
        print(f"   منها هتاخد تكلفة               {hits:>10,}")
        print(f"   منها مالهاش تكلفة في الملف      {len(moves) - hits:>10,}"
              f"  ({len(no_cost_items):,} صنف)")
        print(f"   القيمة بعد التعبئة             {to_money(valued):>14,}")
        for u in unknown[:10]:
            print(f"      ؟ {u}")
        if not has_column:
            print("\nعمود التكلفة على حركات المخزن مش موجود لسه — بيتعمل تلقائياً أول ما السيرفر"
                  " يشتغل بالنسخة الجديدة.")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return
        if not has_column:
            raise SystemExit("لا يمكن الكتابة قبل إضافة العمود.")
        for cost, ids in plan.items():
            db.execute(update(StockMovement).where(StockMovement.id.in_(ids))
                       .values(unit_cost=cost))
        db.commit()
        print(f"\nتم: {hits:,} حركة اتسجلت تكلفتها.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تكلفة رصيد أول المدة من ملف a5_open.tsv")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(folder=a.dir, branch_name=a.branch, prefix=a.prefix, execute=a.yes)


if __name__ == "__main__":
    main()
