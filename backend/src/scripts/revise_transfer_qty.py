from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.transfer import StockTransfer, StockTransferLine
from src.models.user import User
from src.services import audit_service, stock_service, transfer_service


def run(*, doc: str, qty: Decimal, user: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        t = db.scalar(select(StockTransfer).where(StockTransfer.document_number == doc))
        if t is None:
            raise SystemExit(f"مافيش إذن رقم {doc}")
        if db.scalar(select(StockTransferLine.id).where(StockTransferLine.transfer_id == t.id)):
            raise SystemExit("الإذن فيه أكتر من سطر — السكربت للإذن ذو الصنف الواحد")
        actor = db.scalar(select(User).where(User.username == user))
        item = db.get(Item, t.item_id)

        def bal(kind, loc):
            return Decimal(str(stock_service.on_hand(db, item.id, kind, loc)))

        src, dst = (t.source_location_kind, t.source_location_id), (t.dest_location_kind, t.dest_location_id)
        print(f"{doc} {item.code} {item.name}: {t.quantity} ← {qty}")
        print(f"   المصدر قبل {bal(*src)}  الوجهة قبل {bal(*dst)}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        before = str(t.quantity)
        transfer_service.revise(db, transfer_id=t.id, lines=[(item.id, qty)],
                                actor_user_id=actor.id)
        audit_service.record(db, action="transfer.fix_qty", actor_user_id=None,
                             entity_type="stock_transfer", entity_id=t.id,
                             before={"quantity": before}, after={"quantity": str(qty)})
        db.flush()
        print(f"   المصدر بعد {bal(*src)}  الوجهة بعد {bal(*dst)}")
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تعديل كمية إذن تحويل معتمد بصنف واحد مع ترحيل الفرق")
    ap.add_argument("--doc", required=True)
    ap.add_argument("--qty", required=True)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(doc=a.doc, qty=Decimal(a.qty), user=a.user, execute=a.yes)


if __name__ == "__main__":
    main()
