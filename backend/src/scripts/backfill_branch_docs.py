from __future__ import annotations

from sqlalchemy import func, select, update

from src.core.db import SessionLocal
from src.models.coupon_receipt import CouponReceipt
from src.models.inspection import Inspection
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.stock import LocationKind, StockMovement
from src.models.user import User
from src.models.voucher import Voucher
from src.models.warehouse import Warehouse

FROM_MOVEMENTS = [
    (SalesInvoice, "sale"),
    (SalesReturn, "sale_return"),
    (PurchaseInvoice, "purchase"),
    (PurchaseReturn, "purchase_return"),
]

FROM_ACTOR = [
    (SalesInvoice, "actor_user_id"),
    (SalesReturn, "actor_user_id"),
    (PurchaseInvoice, "actor_user_id"),
    (PurchaseReturn, "actor_user_id"),
    (Voucher, "actor_user_id"),
    (CouponReceipt, "actor_user_id"),
    (Inspection, "rep_user_id"),
]


def _pending(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model)
                     .where(model.branch_id.is_(None))) or 0


def run() -> None:
    db = SessionLocal()
    try:
        warehouses = {w.id: w.branch_id for w in db.scalars(select(Warehouse)).all()}
        users = {u.id: u.branch_id for u in db.scalars(select(User)).all()}

        moves = db.scalars(select(StockMovement)
                           .where(StockMovement.branch_id.is_(None))).all()
        n = 0
        for mv in moves:
            kind = getattr(mv.location_kind, "value", mv.location_kind)
            branch = (warehouses.get(mv.location_id) if kind == LocationKind.warehouse.value
                      else users.get(mv.location_id) if kind == "rep" else None)
            if branch:
                mv.branch_id = branch
                n += 1
        db.flush()
        print(f"حركة مخزون: {n} من {len(moves)}")

        for model, doc_type in FROM_MOVEMENTS:
            rows = db.execute(
                select(StockMovement.source_doc_id,
                       func.min(StockMovement.branch_id).label("branch"))
                .where(StockMovement.source_doc_type == doc_type,
                       StockMovement.branch_id.isnot(None))
                .group_by(StockMovement.source_doc_id)
            ).all()
            n = 0
            for doc_id, branch in rows:
                if branch is None:
                    continue
                n += db.execute(
                    update(model).where(model.id == doc_id, model.branch_id.is_(None))
                    .values(branch_id=branch)
                ).rowcount or 0
            db.flush()
            print(f"{model.__tablename__} من الحركات: {n}")

        for model, actor_col in FROM_ACTOR:
            rows = db.scalars(select(model).where(model.branch_id.is_(None))).all()
            n = 0
            for row in rows:
                branch = users.get(getattr(row, actor_col, None))
                if branch:
                    row.branch_id = branch
                    n += 1
            db.flush()
            print(f"{model.__tablename__} من كاتبه: {n} (فاضل {_pending(db, model)})")

        db.commit()
        print("تم.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
