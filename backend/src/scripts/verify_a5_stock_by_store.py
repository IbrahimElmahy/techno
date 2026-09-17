"""رصيد الصنف **في كل مخزن** عندنا مقابل a5 — قراءة بس.

    python -m src.scripts.verify_a5_stock_by_store --dir C:/pgtmp
    python -m src.scripts.verify_a5_stock_by_store --dir C:/pgtmp/aliaa --prefix AL-

`verify_a5_stock.py` بيقارن رصيد الصنف **في الشركة كلها**. ده بيقارن توزيعه: نفس
الإجمالي ممكن يتوزّع غلط على المخازن، والرقم الكلي يفضل مظبوط ومحدش ياخد باله — لحد
ما حد يدوّر على بضاعة في مخزن مكتوب إنها فيه.

**رصيد a5 لكل مخزن مشتق زي الكلي**: كل صف في `AzonDt` بيدخل لمخزن `StoreIn_name`
وبيخرج من `StoreOut_name`. الافتتاحي (`AznType = 0`) في `a5_open.tsv` والباقي في
`a5_lines.tsv`.

**والتحويل بيتعدّ مرة واحدة.** a5 بيكتب سطر التحويل مرتين (صف خروج وصف دخول بنفس
الصنف والكمية والمخزنين) — `import_a5_docs._transfer` بيطوي الزوج لسطر واحد، والمقارنة
لازم تطوي بنفس القاعدة وإلا كل تحويل بيتحسب بالضعف والفرق كله يبقى وهم.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read, mine
from src.scripts.import_a5_docs import (
    L_AZN,
    L_CODE,
    L_IN,
    L_JUST,
    L_NAME,
    L_OUT,
    L_QTY,
    L_TYPE,
)

ZERO = Decimal("0")


def _fold_transfers(rows: list[list[str]]) -> list[list[str]]:
    """نفس طيّ `_transfer`: الزوج المتطابق المتتالي جوّه الإذن الواحد بيتعدّ مرة."""
    by_doc: dict[str, list[list[str]]] = defaultdict(list)
    for r in rows:
        by_doc[r[L_AZN].strip()].append(r)
    out: list[list[str]] = []
    for _azn, rs in by_doc.items():
        ordered = sorted(rs, key=lambda r: int(r[L_JUST] or 0))
        i = 0
        while i < len(ordered):
            r = ordered[i]
            nxt = ordered[i + 1] if i + 1 < len(ordered) else None
            out.append(r)
            if (nxt is not None and _clean(nxt[L_CODE]) == _clean(r[L_CODE])
                    and _clean(nxt[L_NAME]) == _clean(r[L_NAME])
                    and _clean(nxt[L_IN]) == _clean(r[L_IN])
                    and _clean(nxt[L_OUT]) == _clean(r[L_OUT])
                    and _money(nxt[L_QTY]) == _money(r[L_QTY])):
                i += 2
            else:
                i += 1
    return out


def run(folder: str, prefix: str) -> int:
    db = SessionLocal()
    try:
        my_items = mine(db.scalars(select(Item)).all(), prefix)
        by_code = {i.code: i for i in my_items if i.code}
        by_name = {i.name: i for i in my_items}
        names = {i.id: i.name for i in my_items}

        def resolve(code: str, name: str) -> Item | None:
            return by_code.get(f"{prefix}{_clean(code)}") or by_name.get(_clean(name))

        wh = {w.name.strip(): w for w in db.scalars(select(Warehouse)).all()}
        wh_name = {w.id: w.name for w in wh.values()}

        # --- رصيد a5 لكل (صنف، مخزن) -----------------------------------------------
        theirs: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        unknown_store: dict[str, int] = defaultdict(int)
        unresolved = 0

        lines = [r for r in _read(os.path.join(folder, "a5_lines.tsv")) if len(r) > L_QTY]
        movement = [r for r in lines if r[L_TYPE].strip() != "6"]
        movement += _fold_transfers([r for r in lines if r[L_TYPE].strip() == "6"])

        for r in movement:
            it = resolve(r[L_CODE], r[L_NAME])
            if it is None:
                unresolved += 1
                continue
            q = Decimal(str(_money(r[L_QTY])))
            if q <= ZERO:
                continue
            for col, sign in ((L_IN, 1), (L_OUT, -1)):
                nm = _clean(r[col])
                if not nm:
                    continue
                w = wh.get(nm)
                if w is None:
                    unknown_store[nm] += 1
                    continue
                theirs[(it.id, w.id)] += q * sign

        # الافتتاحي: أعمدته غير — ٢/٣ المخزن، و٤/٥/٦ الكمية (أول قيمة مش صفر).
        for r in _read(os.path.join(folder, "a5_open.tsv")):
            if len(r) < 7:
                continue
            it = resolve(r[0], r[1])
            if it is None:
                unresolved += 1
                continue
            q = next((Decimal(str(_money(v))) for v in (r[4], r[5], r[6])
                      if _money(v) != ZERO), ZERO)
            if q <= ZERO:
                continue
            for idx, sign in ((2, 1), (3, -1)):
                nm = _clean(r[idx])
                if not nm:
                    continue
                w = wh.get(nm)
                if w is None:
                    unknown_store[nm] += 1
                    continue
                theirs[(it.id, w.id)] += q * sign

        # --- رصيدنا لكل (صنف، مخزن) ------------------------------------------------
        signed = func.sum(func.coalesce(StockMovement.quantity, 0))
        ours: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        for item_id, loc_id, direction, qty in db.execute(
            select(StockMovement.item_id, StockMovement.location_id,
                   StockMovement.direction, signed)
            .where(StockMovement.location_kind == LocationKind.warehouse,
                   StockMovement.item_id.in_([i.id for i in my_items]))
            .group_by(StockMovement.item_id, StockMovement.location_id,
                      StockMovement.direction)
        ).all():
            v = Decimal(str(qty or 0))
            ours[(item_id, loc_id)] += v if direction == StockDirection.in_ else -v

        keys = set(theirs) | set(ours)
        diff = [(k, theirs.get(k, ZERO), ours.get(k, ZERO))
                for k in keys if theirs.get(k, ZERO) != ours.get(k, ZERO)]
        diff.sort(key=lambda x: -abs(x[1] - x[2]))

        print(f"أزواج (صنف × مخزن): {len(keys)}")
        print(f"   مطابق              {len(keys) - len(diff)}")
        print(f"   مختلف              {len(diff)}")
        if unresolved:
            print(f"   سطور a5 مالهاش صنف {unresolved}")
        if unknown_store:
            print("\nمخازن في a5 مش عندنا:")
            for nm, n in sorted(unknown_store.items(), key=lambda x: -x[1]):
                print(f"   «{nm}» — {n} صف")

        if diff:
            gap = sum((a - b for _k, a, b in diff), ZERO)
            print(f"\nإجمالي الفرق (a5 − عندنا): {gap}")
            print("\nأكبر ٤٠ فرق:")
            for (item_id, loc_id), a, b in diff[:40]:
                print(f"   {names.get(item_id, item_id)[:30]:<32}"
                      f"{wh_name.get(loc_id, loc_id)[:18]:<20}"
                      f"a5={a:>11}  عندنا={b:>11}")
        return 1 if diff else 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    sys.exit(run(folder, prefix))
