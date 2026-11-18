from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import ZERO, to_money
from src.lib import production
from src.models.manufacturing import ProductionOrder, ProductionState
from src.models.stock import ItemCostReset
from src.services import audit_service, costing_service
from src.services import manufacturing_production_service as svc

FREEZE = date(2026, 11, 1)


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        orders = db.scalars(select(ProductionOrder).where(
            ProductionOrder.imported_from == "a5", ProductionOrder.material_cost == 0,
            ProductionOrder.state == ProductionState.done).order_by(ProductionOrder.production_date)).all()
        products = {p.item_id for o in orders for p in o.products}
        frozen = costing_service.known_costs(db, products, as_of=date(2026, 10, 31))
        grand = ZERO
        for o in orders:
            costs = costing_service.known_costs(db, {m.item_id for m in o.materials},
                                                as_of=o.production_date)
            for m in o.materials:
                m.unit_cost = to_money(costs.get(m.item_id, ZERO))
                m.line_cost = production.line_cost(m.quantity, m.unit_cost)
            db.flush()
            by_line: dict[int, Decimal] = {}
            for m in o.materials:
                if m.product_line_id is not None:
                    by_line[m.product_line_id] = by_line.get(m.product_line_id, ZERO) + Decimal(str(m.line_cost))
            split_ids = set()
            for x in svc.material_split(db, o):
                split_ids.add(x["material_id"])
                by_line[x["product_line_id"]] = by_line.get(x["product_line_id"], ZERO) + Decimal(x["line_cost"])
            leftover = sum((Decimal(str(m.line_cost)) for m in o.materials
                            if m.product_line_id is None and m.id not in split_ids), ZERO)
            total_qty = sum((Decimal(str(p.quantity)) for p in o.products), ZERO)
            mat_total = ZERO
            for p in o.products:
                share = (leftover * Decimal(str(p.quantity)) / total_qty) if total_qty else ZERO
                p.material_cost = to_money(by_line.get(p.id, ZERO) + share)
                p.total_cost = to_money(p.material_cost + Decimal(str(p.expense_amount or 0)))
                p.unit_cost = production.unit_cost(p.total_cost, p.quantity)
                mat_total += p.material_cost
            o.material_cost = to_money(mat_total)
            o.total_cost = to_money(mat_total + Decimal(str(o.expense_amount or 0)))
            grand += o.material_cost
            print(f"{o.document_number} {o.production_date}: خامات {o.material_cost} "
                  f"(مش في نسب: {to_money(leftover)})")
        db.flush()
        resets = 0
        for item_id, cost in frozen.items():
            db.add(ItemCostReset(item_id=item_id, effective_date=FREEZE, unit_cost=cost,
                                 note="تثبيت تكلفة الجرد المستمر بعد تسعير أوامر إنتاج a5",
                                 actor_user_id=actor))
            resets += 1
        db.flush()
        audit_service.record(db, action="production_order.recost_a5", actor_user_id=actor,
                             entity_type="production_order", entity_id=None,
                             after={"orders": [o.document_number for o in orders],
                                    "material_cost": str(grand), "cost_resets": resets})
        print(f"أوامر: {len(orders)} · إجمالي الخامات {to_money(grand)} · تثبيت تكلفة {resets} صنف في {FREEZE}")
        if execute:
            db.commit()
            print("اتحفظ.")
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    actor_arg = next((a for a in sys.argv if a.startswith("--actor=")), "--actor=1")
    run(execute="--yes" in sys.argv, actor=int(actor_arg.split("=")[1]))
