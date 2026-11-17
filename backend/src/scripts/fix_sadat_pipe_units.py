from __future__ import annotations

import argparse
import json
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item, ItemUnit
from src.services import audit_service, uom_service

CONFIRMED: dict[str, int] = {
    "FC-J-03070": 3, "FC-J-03071": 3, "FC-J-03072": 3, "FC-J-03073": 3,
    "FC-J-03074": 3, "FC-J-03075": 3, "FC-J-03076": 3, "FC-J-03077": 3,
    "FC-P-01142": 4, "FC-P-01143": 4, "FC-P-01144": 4, "FC-P-01145": 4,
    "FC-P-01148": 4, "FC-P-01149": 4, "FC-P-01151": 4, "FC-P-01152": 4,
    "FC-P-01156": 4, "FC-P-01157": 4, "FC-P-01158": 4, "FC-P-01160": 4,
    "FC-P-01161": 4, "FC-P-01163": 4,
    "FC-W-02101": 6, "FC-W-02105": 6, "FC-W-02108": 6, "FC-W-02110": 6,
    "FC-W-02112": 6, "FC-W-02115": 6,
}


def run(*, execute: bool, actor: int | None, backup: str | None) -> None:
    db = SessionLocal()
    try:
        items = {i.code: i for i in db.scalars(select(Item).where(Item.code.in_(list(CONFIRMED))))}
        missing = sorted(set(CONFIRMED) - set(items))
        todo, done, skipped = [], [], []
        for code, length in CONFIRMED.items():
            item = items.get(code)
            if item is None:
                continue
            rows = db.scalars(select(ItemUnit).where(ItemUnit.item_id == item.id)).all()
            current = uom_service.meters_per_piece(item.unit_of_measure, rows)
            if uom_service.is_meter_unit(item.unit_of_measure) and current == Decimal(length):
                done.append(code)
                continue
            if item.unit_of_measure != uom_service.PIECE or rows:
                skipped.append((code, item.unit_of_measure, [r.name for r in rows]))
                continue
            todo.append((item, length))

        print(f"{'مطلوب':<10}{len(CONFIRMED):>5}")
        print(f"{'هيتصلّح':<10}{len(todo):>5}")
        print(f"{'متصلّح قبل كده':<10}{len(done):>5}")
        if missing:
            print("مش موجود:", ", ".join(missing))
        for code, uom, units in skipped:
            print(f"   اتخطّى {code}: الوحدة «{uom}» ووحدات بديلة {units}")
        for item, length in todo:
            print(f"   {item.code}  {item.name}: قطعة ← متر، القطعة = {length} متر")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        snapshot = [dict(id=i.id, code=i.code, unit_of_measure=i.unit_of_measure) for i, _ in todo]
        path = backup or f"/tmp/sadat_pipe_units_{datetime.now():%Y%m%d-%H%M%S}.json"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(snapshot, fh, ensure_ascii=False)
        for item, length in todo:
            before = item.unit_of_measure
            item.unit_of_measure = uom_service.METER
            db.flush()
            uom_service.apply_length(db, item, Decimal(length))
            audit_service.record(db, action="item.unit_label", actor_user_id=actor,
                                 entity_type="item", entity_id=item.id,
                                 before={"unit_of_measure": before},
                                 after={"unit_of_measure": item.unit_of_measure,
                                        "meters_per_piece": length,
                                        "reason": "مواسير السادات: الرصيد والسعر بالمتر"})
        db.commit()
        print(f"\nاتصلّح {len(todo)} صنف. النسخة: {path}")
    finally:
        db.close()


def restore(path: str, actor: int | None) -> None:
    db = SessionLocal()
    try:
        rows = json.load(open(path, encoding="utf-8"))
        for r in rows:
            item = db.get(Item, r["id"])
            if item is None:
                continue
            item.unit_of_measure = r["unit_of_measure"]
            for u in db.scalars(select(ItemUnit).where(ItemUnit.item_id == item.id)).all():
                db.delete(u)
            audit_service.record(db, action="item.unit_label", actor_user_id=actor,
                                 entity_type="item", entity_id=item.id,
                                 after={"unit_of_measure": item.unit_of_measure, "restored": True})
        db.commit()
        print(f"اترجع {len(rows)} صنف.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="مواسير السادات: الوحدة «متر» و«القطعة = N متر»")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--actor", type=int, default=None)
    ap.add_argument("--backup", default=None)
    ap.add_argument("--restore", default=None, help="ملف النسخة لإرجاع الوحدات")
    args = ap.parse_args()
    if args.restore:
        restore(args.restore, args.actor)
    else:
        run(execute=args.yes, actor=args.actor, backup=args.backup)


if __name__ == "__main__":
    main()
