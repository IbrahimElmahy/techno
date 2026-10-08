# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import csv
import os
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.lib import arabic
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read

ZERO = Decimal("0")
EPS = Decimal("0.005")


def main() -> None:
    ap = argparse.ArgumentParser(description="كشف الأصناف اللي مخازنها متبادلة")
    ap.add_argument("--dir", required=True, help="مجلد فيه a5_bal_store.tsv")
    ap.add_argument("--prefix", default="FC-", help="بادئة أكواد الفرع")
    ap.add_argument("--csv", help="تصدير الكشف")
    ap.add_argument("--limit", type=int, default=20)
    args = ap.parse_args()

    rows = _read(os.path.join(args.dir, "a5_bal_store.tsv"))
    if not rows:
        print("مالقيتش a5_bal_store.tsv")
        return

    db = SessionLocal()
    try:
        items = db.scalars(select(Item)).all()
        by_code = {i.code: i for i in items}
        by_name: dict[str, Item] = {}
        for i in items:
            by_name.setdefault(arabic.bare(i.name or ""), i)
        wh = {w.id: w for w in db.scalars(select(Warehouse)).all()}
        wh_by_name = {arabic.bare(w.name or ""): w for w in wh.values()}

        theirs: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        for r in rows:
            if len(r) < 4:
                continue
            it = (by_code.get(f"{args.prefix}{_clean(r[0])}")
                  or by_name.get(arabic.bare(_clean(r[1]))))
            w = wh_by_name.get(arabic.bare(_clean(r[2])))
            if it is None or w is None:
                continue
            theirs[(it.id, w.id)] += _money(r[3])

        ours: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        for iid, lid, direction, qty in db.execute(
            select(StockMovement.item_id, StockMovement.location_id,
                   StockMovement.direction, StockMovement.quantity)
            .where(StockMovement.location_kind == LocationKind.warehouse)
        ).all():
            q = Decimal(str(qty or 0))
            ours[(iid, lid)] += q if direction == StockDirection.in_ else -q

        scope_wh = {w for _i, w in theirs}
        scope_items = {i for i, _w in theirs}

        keys = {(i, w) for i, w in (set(theirs) | set(ours))
                if w in scope_wh and i in scope_items}
        diff_by_item: dict[int, list[tuple[int, Decimal, Decimal]]] = defaultdict(list)
        for iid, wid in keys:
            t, o = theirs.get((iid, wid), ZERO), ours.get((iid, wid), ZERO)
            if abs(t - o) > EPS:
                diff_by_item[iid].append((wid, t, o))

        swaps: list[dict] = []
        others: list[dict] = []
        for iid, places in diff_by_item.items():
            it = db.get(Item, iid)
            name = it.name if it else str(iid)
            gap = sum(t - o for _w, t, o in places)
            row_kind = swaps if abs(gap) <= EPS else others
            for wid, t, o in sorted(places, key=lambda p: -(abs(p[1] - p[2]))):
                row_kind.append({
                    "الصنف": name, "الكود": (it.code if it else ""),
                    "المخزن": wh[wid].name if wid in wh else f"#{wid}",
                    "عند a5": float(t), "عندنا": float(o), "الفرق": float(t - o),
                })

        n_items_swap = len({r["الصنف"] for r in swaps})
        n_items_other = len({r["الصنف"] for r in others})
        print(f"{'أصناف مخازنها متبادلة (الإجمالي مظبوط)':<44}{n_items_swap:>6}"
              f"   ({len(swaps)} سطر)")
        print(f"{'أصناف إجماليها نفسه مختلف (علّة تانية)':<44}{n_items_other:>6}"
              f"   ({len(others)} سطر)")

        def show(title: str, data: list[dict]) -> None:
            if not data:
                return
            print(f"\n=== {title} ===")
            print(f"{'الصنف':<34}{'المخزن':<26}{'عند a5':>12}{'عندنا':>12}{'الفرق':>12}")
            for r in data[: args.limit]:
                print(f"{r['الصنف'][:32]:<34}{r['المخزن'][:24]:<26}"
                      f"{r['عند a5']:>12,.0f}{r['عندنا']:>12,.0f}{r['الفرق']:>12,.0f}")
            if len(data) > args.limit:
                print(f"   … و{len(data) - args.limit} سطر تاني")

        show("مخازن متبادلة — تتصلّح بتحويل، والكمية الكلية مابتتغيّرش", swaps)
        show("إجمالي الصنف نفسه مختلف — حركة ناقصة أو زيادة", others)

        if args.csv:
            out = [{**r, "النوع": "مخازن متبادلة"} for r in swaps]
            out += [{**r, "النوع": "إجمالي مختلف"} for r in others]
            if out:
                with open(args.csv, "w", newline="", encoding="utf-8-sig") as fh:
                    w = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
                    w.writeheader()
                    w.writerows(out)
                print(f"\nاتكتب: {args.csv}  ({len(out)} سطر)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
