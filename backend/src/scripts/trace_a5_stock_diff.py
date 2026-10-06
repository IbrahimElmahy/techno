"""يتتبّع فروق المخزون (صنف × مخزن) بين a5 وعندنا لحد نوع الحركة — قراءة بس (٢٠٢٦-١٠-٠٦).

    python -m src.scripts.trace_a5_stock_diff --dir /opt/techno/a5factory --prefix FC-

`verify_a5_stock_by_store` بيقول «فيه فرق» بس. ده بياخد كل زوج مختلف ويحط جنب بعض:
حركات a5 مقسومة بالنوع (افتتاحي، بيع، شرا، تحويل، إذن…) ومجموعها، وحركاتنا مقسومة
بمصدرها (`source_doc_type`) ومجموعها — فالفرق بيبان جاي من أنهي نوع.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read, mine
from src.scripts.import_a5_docs import KIND, L_CODE, L_IN, L_NAME, L_OUT, L_QTY, L_TYPE, _doc_key
from src.scripts.verify_a5_stock_by_store import _fold_transfers

ZERO = Decimal("0")


def run(folder: str, prefix: str) -> int:
    db = SessionLocal()
    try:
        my = mine(db.scalars(select(Item)).all(), prefix)
        by_code = {i.code: i for i in my if i.code}
        by_name = {i.name: i for i in my}

        def resolve(code, name):
            return by_code.get(f"{prefix}{_clean(code)}") or by_name.get(_clean(name))

        wh = {w.name.strip(): w for w in db.scalars(select(Warehouse)).all()}
        wname = {w.id: w.name for w in wh.values()}

        theirs: dict[tuple, Decimal] = defaultdict(Decimal)
        detail: dict[tuple, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
        docs: dict[tuple, list[str]] = defaultdict(list)
        lines = [r for r in _read(os.path.join(folder, "a5_lines.tsv")) if len(r) > L_QTY]
        mv = [r for r in lines if r[L_TYPE].strip() != "6"]
        mv += _fold_transfers([r for r in lines if r[L_TYPE].strip() == "6"])
        for r in mv:
            it = resolve(r[L_CODE], r[L_NAME])
            q = Decimal(str(_money(r[L_QTY])))
            if it is None or q <= ZERO:
                continue
            t = r[L_TYPE].strip()
            label = KIND.get(t, (t,))[0]
            for col, sign in ((L_IN, 1), (L_OUT, -1)):
                w = wh.get(_clean(r[col]))
                if w is None:
                    continue
                k = (it.id, w.id)
                theirs[k] += q * sign
                detail[k][label] += q * sign
                docs[k].append(f"{KIND.get(t, ('', t))[1]}{_doc_key(r).strip()}:{q * sign}")
        for r in _read(os.path.join(folder, "a5_open.tsv")):
            if len(r) < 7:
                continue
            it = resolve(r[0], r[1])
            q = next((Decimal(str(_money(v))) for v in (r[4], r[5], r[6]) if _money(v) != ZERO), ZERO)
            if it is None or q <= ZERO:
                continue
            for idx, sign in ((2, 1), (3, -1)):
                w = wh.get(_clean(r[idx]))
                if w is None:
                    continue
                k = (it.id, w.id)
                theirs[k] += q * sign
                detail[k]["افتتاحي"] += q * sign

        ours: dict[tuple, Decimal] = defaultdict(Decimal)
        ours_d: dict[tuple, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
        for item_id, loc, src, d, q in db.execute(text("""
                select item_id, location_id, coalesce(source_doc_type, movement_type::text), direction::text, sum(quantity)
                from stock_movement where location_kind::text ilike 'warehouse' and item_id = any(:ids)
                group by 1, 2, 3, 4"""), {"ids": [i.id for i in my]}).all():
            v = Decimal(str(q)) * (1 if str(d).lower().startswith("in") else -1)
            ours[(item_id, loc)] += v
            ours_d[(item_id, loc)][src] += v

        names = {i.id: i.name for i in my}
        keys = [k for k in set(theirs) | set(ours) if theirs.get(k, ZERO) != ours.get(k, ZERO)]
        keys.sort(key=lambda k: -abs(theirs.get(k, ZERO) - ours.get(k, ZERO)))
        print(f"أزواج مختلفة: {len(keys)}\n")
        for k in keys:
            a, b = theirs.get(k, ZERO), ours.get(k, ZERO)
            print(f"■ {names.get(k[0])} — {wname.get(k[1])}   a5={a}  عندنا={b}  الفرق={a - b}")
            print("    a5:    " + " · ".join(f"{n}={v}" for n, v in sorted(detail[k].items())))
            print("    عندنا: " + " · ".join(f"{n}={v}" for n, v in sorted(ours_d[k].items())))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    folder = a[a.index("--dir") + 1]
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    sys.exit(run(folder, prefix))
