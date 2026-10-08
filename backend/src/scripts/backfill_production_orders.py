from __future__ import annotations

import argparse
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import ZERO, to_qty
from src.models.manufacturing import (
    ManufactureOpType,
    ManufacturingOp,
    ProductionOrder,
    ProductionOrderMaterial,
    ProductionOrderProduct,
    ProductionState,
)
from src.models.stock import StockMovement
from src.models.user import User
from src.models.warehouse import Warehouse
from src.services.manufacturing_service import work_order_ref

SOURCE = "a5"


def run(*, execute: bool, prefix: str = "") -> None:
    db = SessionLocal()
    try:
        wh_branch = {w.id: w.branch_id for w in db.scalars(select(Warehouse)).all()}
        rows = db.execute(
            select(ManufacturingOp, StockMovement.movement_date, StockMovement.created_at)
            .outerjoin(StockMovement, StockMovement.id == ManufacturingOp.stock_movement_id)
        ).all()

        groups: dict[str, list] = defaultdict(list)
        for op, mv_date, mv_created in rows:
            groups[work_order_ref(op.document_number)].append(
                (op, mv_date or (mv_created.date() if mv_created else None)))

        done = {d for (d,) in db.execute(
            select(ProductionOrder.document_number)
            .where(ProductionOrder.imported_from == SOURCE)).all()}
        todo = {k: v for k, v in groups.items()
                if f"WO-{SOURCE.upper()}-{k}"[:24] not in done and k.startswith(prefix)}

        n_prod = sum(1 for op, _ in (ln for v in todo.values() for ln in v)
                     if op.op_type == ManufactureOpType.produce)
        n_lines = sum(len(v) for v in todo.values())
        print("المصدر:")
        print(f"   عمليات تصنيع متسجّلة   {len(rows):>7}")
        print(f"   أوامر شغل بعد اللمّ    {len(groups):>7}")
        print(f"   اتعملت قبل كده         {len(done):>7}")
        print(f"   هتتعمل دلوقتي          {len(todo):>7}")
        print(f"   سطور إنتاج             {n_prod:>7}")
        print(f"   سطور خامات             {n_lines - n_prod:>7}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        actor = db.scalars(select(User).order_by(User.id)).first()
        if actor is None:
            raise SystemExit("مافيش مستخدم في القاعدة.")

        made = 0
        for ref, lines in sorted(todo.items(), key=lambda kv: (
                min((d for _, d in kv[1] if d), default=None) or "", kv[0])):
            when = min((d for _, d in lines if d), default=None)
            branch = next((wh_branch.get(int(op.location_id)) for op, _ in lines
                           if wh_branch.get(int(op.location_id)) is not None), None)
            order = ProductionOrder(
                document_number=f"WO-{SOURCE.upper()}-{ref}"[:24],
                production_date=when, branch_id=branch,
                external_document_number=ref.rsplit("-", 1)[-1][:40],
                imported_from=SOURCE,
                state=ProductionState.done,
                statement1=None,
                material_cost=ZERO, expense_amount=ZERO, total_cost=ZERO,
                product_quantity=to_qty(0), material_quantity=to_qty(0),
                actor_user_id=actor.id,
            )
            db.add(order)
            db.flush()

            p_qty = to_qty(0)
            m_qty = to_qty(0)
            for op, _ in lines:
                wid = int(op.location_id)
                if op.op_type == ManufactureOpType.produce:
                    order.products.append(ProductionOrderProduct(
                        order_id=order.id, item_id=op.item_id, warehouse_id=wid,
                        planned_quantity=to_qty(0), quantity=to_qty(op.quantity),
                        unit_factor=to_qty(1),
                        stock_movement_id=op.stock_movement_id))
                    p_qty += to_qty(op.quantity)
                else:
                    order.materials.append(ProductionOrderMaterial(
                        order_id=order.id, product_line_id=None, item_id=op.item_id,
                        warehouse_id=wid, planned_quantity=to_qty(0),
                        quantity=to_qty(op.quantity), unit_factor=to_qty(1),
                        stock_movement_id=op.stock_movement_id))
                    m_qty += to_qty(op.quantity)
            order.product_quantity = p_qty
            order.material_quantity = m_qty
            made += 1
            if made % 200 == 0:
                db.flush()
                print(f"   … {made}/{len(todo)}")

        db.commit()
        print(f"\nاتعمل {made} أمر تشغيل. ولا حركة مخزون اتكتبت، ولا صف عملية اتمسح.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="لمّ حركة التصنيع المنقولة في أوامر تشغيل")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--prefix", default="", help="بادئة رقم العملية — FC- للسادات بس")
    a = ap.parse_args()
    run(execute=a.yes, prefix=a.prefix)


if __name__ == "__main__":
    main()
