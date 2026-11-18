from __future__ import annotations

import json
import sys
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import case, func, select, text

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.stock import ItemCostReset, LocationKind, StockDirection, StockMovement
from src.scripts.unify_item_names import _item_refs, merge_items
from src.services import audit_service, costing_service


def run(pairs: list[tuple[int, int]], *, execute: bool) -> None:
    db = SessionLocal()
    try:
        actor = db.scalar(text("select id from \"user\" where username = 'admin' limit 1")) \
            or db.scalar(text("select min(id) from \"user\""))
        signed = case((StockMovement.direction == StockDirection.in_, StockMovement.quantity),
                      else_=-StockMovement.quantity)
        items = {i.id: i for i in db.scalars(select(Item).where(
            Item.id.in_([x for p in pairs for x in p]))).all()}
        snapshot, targets = [], {}
        for lo, wi in pairs:
            a, b = items[lo], items[wi]
            n = db.scalar(select(func.count()).where(StockMovement.item_id == lo))
            print(f"#{lo} {a.code} «{a.name}» ({n} حركة) ⇐ يندمج في #{wi} {b.code} «{b.name}»")
            snapshot.append(dict(id=a.id, code=a.code, name=a.name, category=a.category,
                                 active=a.active, into=wi))
            if n:
                ids = [lo, wi]
                qty = {i: Decimal(str(q or 0)) for i, q in db.execute(
                    select(StockMovement.item_id, func.sum(signed))
                    .where(StockMovement.item_id.in_(ids),
                           StockMovement.location_kind == LocationKind.warehouse)
                    .group_by(StockMovement.item_id)).all()}
                costs = costing_service.known_costs(db, ids)
                tq = sum((qty.get(i, Decimal(0)) for i in ids), Decimal(0))
                tv = sum((qty.get(i, Decimal(0)) * costs.get(i, Decimal(0)) for i in ids), Decimal(0))
                if tq > 0:
                    targets[wi] = tv / tq
        if not execute:
            print("معاينة فقط — شغّل بـ --execute للتنفيذ")
            return
        refs = _item_refs(db)
        merges = []
        for lo, wi in pairs:
            merges.append(merge_items(db, refs, lo, wi))
            db.flush()
            db.execute(text("delete from item where id = :i"), {"i": lo})
        db.flush()
        resets = []
        for wi, cost in targets.items():
            row = ItemCostReset(item_id=wi, effective_date=date.today(), unit_cost=cost,
                                note="دمج أصناف مكررة: متوسط التكلفة قبل الدمج", actor_user_id=actor)
            db.add(row)
            db.flush()
            resets.append(row.id)
        path = f"/opt/backups/merge_item_pairs_{datetime.now():%Y%m%d-%H%M%S}.json"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(dict(items=snapshot, merges=merges, cost_resets=resets), fh, ensure_ascii=False)
        audit_service.record(db, action="items.merge_pairs", actor_user_id=actor,
                             entity_type="item", entity_id=None,
                             after={"pairs": pairs, "backup": path})
        db.commit()
        print(f"تم دمج {len(pairs)} صنف · نسخة الرجوع {path}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run([tuple(int(x) for x in a.split(":")) for a in args], execute="--execute" in sys.argv)
