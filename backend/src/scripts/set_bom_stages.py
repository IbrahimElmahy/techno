# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import re
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.bom import Bom, BomComponent
from src.models.catalog import Item
from src.models.manufacturing import ProductionOrder, ProductionOrderMaterial

STAGE_PRODUCTION = "production"
STAGE_QUALITY = "quality"

_QUALITY = re.compile(r"كرتون|كيس|اكياس|أكياس")


def stage_for(name: str) -> str:
    return STAGE_QUALITY if _QUALITY.search(name or "") else STAGE_PRODUCTION


def main() -> None:
    ap = argparse.ArgumentParser(description="ضبط مرحلة خامات الوصفات")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        names = {i.id: (i.name or "") for i in db.scalars(select(Item)).all()}
        comps = db.scalars(select(BomComponent)).all()
        boms = {b.id: b for b in db.scalars(select(Bom)).all()}

        changed: list[tuple[str, str, str, str]] = []
        per_item: dict[str, int] = defaultdict(int)
        for c in comps:
            want = stage_for(names.get(c.item_id, ""))
            if (c.stage or STAGE_PRODUCTION) == want:
                continue
            bom = boms.get(c.bom_id)
            changed.append((bom.name if bom else f"#{c.bom_id}",
                            names.get(c.item_id, f"#{c.item_id}"),
                            c.stage or STAGE_PRODUCTION, want))
            per_item[names.get(c.item_id, f"#{c.item_id}")] += 1
            if args.yes:
                c.stage = want

        untouched = [o for o in db.scalars(select(ProductionOrder).where(
            ProductionOrder.imported_from.is_(None))).all()
            if all(m.stock_movement_id is None for m in o.materials)]
        order_rows = 0
        for o in untouched:
            for m in o.materials:
                want = stage_for(names.get(m.item_id, ""))
                if (m.stage or STAGE_PRODUCTION) == want:
                    continue
                order_rows += 1
                if args.yes:
                    m.stage = want

        quality_items = sorted({n for n in per_item}
                               | {names.get(c.item_id, "") for c in comps
                                  if (c.stage or STAGE_PRODUCTION) == STAGE_QUALITY})
        print(f"{'سطور الوصفات':<34}{len(comps):>10,}")
        print(f"{'هتبقى تعبئة':<34}{len(changed):>10,}")
        print(f"{'سطور أوامر لسه ما اتصرفتش':<34}{order_rows:>10,}")
        if per_item:
            print(f"\n{'الصنف':<28}{'في كام وصفة':>14}")
            for name, n in sorted(per_item.items(), key=lambda kv: -kv[1]):
                print(f"{name:<28}{n:>14,}")
        print(f"\nأصناف التعبئة كلها ({len(quality_items)}): "
              + "، ".join(x for x in quality_items if x))

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتظبط {len(changed):,} سطر وصفة و{order_rows:,} سطر أمر.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
