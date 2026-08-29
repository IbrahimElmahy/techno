"""تعبئة فرع المستندات القديمة — تتشغّل مرة باليد.

المستندات المكتوبة قبل عزل الفروع `branch_id` بتاعها NULL، وبتتشاف من كل الفروع لحد ما
تتعبّى. السكربت ده بيعبّيها من مصادرها الحقيقية بالترتيب:

1. **حركة المخزون** — من مكانها: المخزن بيقول فرعه، والعهدة بتقول فرع المندوب.
2. **الفواتير والمرتجعات** — من حركاتها، وده الأصدق: البضاعة اتحركت في مكان، والمكان بيتبع
   فرع. الفاتورة اللي مالهاش حركة (فاتورة كوبونات مثلاً) بترجع لفرع اللي كتبها.
3. **السندات والاستلامات والمعاينات** — من فرع اللي كتبها، مالهاش مكان.

مابيتشغّلش عند الإقلاع عن قصد: ده بيمرّ على كل مستند في القاعدة، وده شغل مرة واحدة مش شغل
كل مرة يقوم فيها السيرفر. وبيتعاد تشغيله بأمان — بيمسّ اللي `branch_id` بتاعه NULL بس.

    python -m src.scripts.backfill_branch_docs
"""
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

# (المستند، نوع المصدر في حركة المخزون)
FROM_MOVEMENTS = [
    (SalesInvoice, "sale"),
    (SalesReturn, "sale_return"),
    (PurchaseInvoice, "purchase"),
    (PurchaseReturn, "purchase_return"),
]

# المستندات اللي مالهاش حركة مخزون — بترجع لفرع اللي كتبها.
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

        # ١) حركة المخزون من مكانها.
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

        # ٢) المستندات من حركاتها.
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

        # ٣) الباقي من فرع اللي كتبه.
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
