from __future__ import annotations

import argparse
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.role import RoleName
from src.models.stock import LocationKind
from src.models.transfer import TransferRoute
from src.models.user import User
from src.models.warehouse import Warehouse
from src.services import stock_service, transfer_service

TARGET = "مخزن الجودة"
PLAN = [
    ("FC-01100000262", "مخزن الجيوان"),
    ("FC-00600000055", "مخزن حقن البولى"),
    ("FC-0070006", "مخزن حقن قطع الصرف"),
    ("FC-01300000023", "مخزن مرتجعات الموردين"),
]
WH = LocationKind.warehouse


def _wh(db, name: str) -> Warehouse:
    w = db.scalar(select(Warehouse).where(Warehouse.name == name))
    if w is None:
        raise SystemExit(f"مافيش مخزن اسمه «{name}»")
    return w


def run(*, user: str, on: date, execute: bool) -> None:
    db = SessionLocal()
    try:
        actor = db.scalar(select(User).where(User.username == user))
        if actor is None:
            raise SystemExit(f"مافيش يوزر اسمه «{user}»")
        target = _wh(db, TARGET)
        todo = []
        for code, source_name in PLAN:
            item = db.scalar(select(Item).where(Item.code == code))
            source = _wh(db, source_name)
            short = -Decimal(str(stock_service.on_hand(db, item.id, WH, target.id)))
            have = Decimal(str(stock_service.on_hand(db, item.id, WH, source.id)))
            if short <= 0:
                print(f"{code:<16} {item.name:<34} مش سالب — تخطّي")
                continue
            if have < short:
                raise SystemExit(f"{code} {item.name}: المطلوب {short} والموجود في {source_name} {have}")
            todo.append((item, source, short))
            print(f"{code:<16} {item.name:<34} {short:>10} من {source_name} (فيه {have})")
        print(f"أذونات هتتعمل: {len(todo)} — بتاريخ {on}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for item, source, qty in todo:
            t = transfer_service.initiate(
                db, item_id=item.id, quantity=qty, route=TransferRoute.central_to_branch,
                source_kind=WH, source_id=source.id, dest_kind=WH, dest_id=target.id,
                initiated_by=actor.id, transfer_date=on,
                notes="تصحيح رصيد سالب في مخزن الجودة قبل الجرد المستمر")
            transfer_service.approve(db, transfer_id=t.id, approver_role=RoleName.system_admin,
                                     approver_branch_id=None, approver_user_id=actor.id,
                                     is_admin=True)
            print(f"{t.document_number} ← {item.code}")
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تحويل الأصناف السالبة في مخزن الجودة من مخازنها")
    ap.add_argument("--user", default="admin")
    ap.add_argument("--date", default=str(date.today()))
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(user=a.user, on=date.fromisoformat(a.date), execute=a.yes)


if __name__ == "__main__":
    main()
