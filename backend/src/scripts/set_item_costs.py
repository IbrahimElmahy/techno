from __future__ import annotations

import argparse
from datetime import date
from decimal import Decimal

import openpyxl
from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.stock import ItemCostReset
from src.services import audit_service, costing_service


def _rows(path: str):
    ws = openpyxl.load_workbook(path, data_only=True).active
    header = None
    for row in ws.iter_rows(values_only=True):
        if header is None:
            if "الكود" in row and "التكلفة الصحيحة" in row:
                header = row
            continue
        rec = dict(zip(header, row))
        if rec.get("الكود") and rec.get("التكلفة الصحيحة") is not None:
            yield str(rec["الكود"]).strip(), Decimal(str(rec["التكلفة الصحيحة"])), rec.get("الصنف")


def run(*, path: str, effective: date, note: str, skip: set[str], execute: bool) -> None:
    db = SessionLocal()
    try:
        plan = []
        for code, cost, name in _rows(path):
            if code in skip:
                print(f"تخطّي {code} ({name})")
                continue
            item = db.scalar(select(Item).where(Item.code == code))
            if item is None:
                raise SystemExit(f"مافيش صنف بالكود {code} ({name})")
            before = costing_service.average_cost(db, item.id)
            plan.append((item, cost, before))
            print(f"{code:<16} {item.name:<32} {before:>10} ← {cost}")
        print(f"عدد الأصناف: {len(plan)} — من تاريخ {effective}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for item, cost, before in plan:
            db.add(ItemCostReset(item_id=item.id, effective_date=effective, unit_cost=cost,
                                 note=note))
            audit_service.record(db, action="item.cost_reset", actor_user_id=None,
                                 entity_type="item", entity_id=item.id,
                                 before={"unit_cost": str(before)},
                                 after={"unit_cost": str(cost), "effective_date": str(effective)})
        db.commit()
        for item, cost, _ in plan:
            now = costing_service.average_cost(db, item.id)
            if now != cost:
                print(f"تنبيه: {item.code} تكلفته الآن {now} (اتغيرت بحركة بعد {effective})")
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تصحيح تكلفة أصناف من ملف إكسل (الكود + التكلفة الصحيحة)")
    ap.add_argument("--file", required=True)
    ap.add_argument("--date", required=True, help="تاريخ بدء التكلفة الجديدة YYYY-MM-DD")
    ap.add_argument("--note", default="تكلفة معتمدة من المحاسب")
    ap.add_argument("--skip", default="", help="أكواد مستبعدة مفصولة بفاصلة")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(path=a.file, effective=date.fromisoformat(a.date), note=a.note,
        skip={c.strip() for c in a.skip.split(",") if c.strip()}, execute=a.yes)


if __name__ == "__main__":
    main()
