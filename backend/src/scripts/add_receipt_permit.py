from __future__ import annotations

import argparse
from datetime import date

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.user import User
from src.models.warehouse import Warehouse
from src.services import stock_permit_service, stock_service
from src.models.stock import LocationKind


def run(*, user: str, warehouse: str, branch_id: int, code: str, qty: str, on: date,
        notes: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        actor = db.scalar(select(User).where(User.username == user))
        wh = db.scalar(select(Warehouse).where(Warehouse.name == warehouse,
                                               Warehouse.branch_id == branch_id))
        item = db.scalar(select(Item).where(Item.code == code))
        if actor is None or wh is None or item is None:
            raise SystemExit("يوزر أو مخزن أو صنف مش موجود")
        before = stock_service.on_hand(db, item.id, LocationKind.warehouse, wh.id)
        print(f"{item.code} {item.name} في {wh.name}: {before} ← إضافة {qty} بتاريخ {on}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        p = stock_permit_service.create_permit(
            db, kind="receipt", warehouse_id=wh.id, lines=[{"item_id": item.id, "quantity": qty}],
            actor_user_id=actor.id, notes=notes, permit_date=on)
        db.commit()
        print(f"{p.document_number} — الرصيد بعد: "
              f"{stock_service.on_hand(db, item.id, LocationKind.warehouse, wh.id)}")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="إذن إضافة لصنف في مخزن")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--warehouse", required=True)
    ap.add_argument("--branch", type=int, required=True)
    ap.add_argument("--code", required=True)
    ap.add_argument("--qty", required=True)
    ap.add_argument("--date", default=str(date.today()))
    ap.add_argument("--notes", default="")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(user=a.user, warehouse=a.warehouse, branch_id=a.branch, code=a.code, qty=a.qty,
        on=date.fromisoformat(a.date), notes=a.notes, execute=a.yes)


if __name__ == "__main__":
    main()
