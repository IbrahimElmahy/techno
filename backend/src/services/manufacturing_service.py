"""Manufacturing service (T028–T029). FR-013–016.

Two independent stock ops (no linkage, no BOM, no money). Each reversible via an explicit reverse
that posts a mirror stock movement (reverse-once).
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.bom import Bom, BomComponent
from src.models.catalog import Item, ItemKind
from src.models.manufacturing import (
    ManufactureOpType,
    ManufacturingOp,
    ManufacturingOrder,
    ManufacturingOrderConsumption,
)
from src.models.stock import LocationKind, StockDirection
from src.services import audit_service, stock_service


class ManufacturingError(Exception):
    pass


def _doc_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(ManufacturingOp)) or 0
    return f"MFG-{n + 1:06d}"


def _order_doc_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(ManufacturingOrder)) or 0
    return f"MO-{n + 1:06d}"


def _op(db, *, op_type, item_id, location_kind, location_id, quantity, movement_type, direction,
        actor_user_id, reverses_op_id=None) -> ManufacturingOp:
    op = ManufacturingOp(
        document_number=_doc_number(db), op_type=op_type, item_id=item_id,
        location_kind=location_kind, location_id=location_id, quantity=Decimal(quantity),
        stock_movement_id=0, reverses_op_id=reverses_op_id, actor_user_id=actor_user_id,
    )
    db.add(op)
    db.flush()
    mv = stock_service.post_movement(
        db, item_id=item_id, location_kind=location_kind, location_id=location_id,
        movement_type=movement_type, direction=direction, quantity=Decimal(quantity),
        actor_user_id=actor_user_id, source_doc_type="manufacturing", source_doc_id=op.id,
    )
    op.stock_movement_id = mv.id
    db.flush()
    audit_service.record(db, action=f"manufacturing.{op_type.value}", actor_user_id=actor_user_id,
                         entity_type="manufacturing_op", entity_id=op.id)
    return op


def consume(db, *, item_id, location_kind, location_id, quantity, actor_user_id) -> ManufacturingOp:
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.raw_material:
        raise ManufacturingError("Consume requires a raw material.")
    return _op(db, op_type=ManufactureOpType.consume, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="consumption_out",
               direction=StockDirection.out, actor_user_id=actor_user_id)


def produce(db, *, item_id, location_kind, location_id, quantity, actor_user_id) -> ManufacturingOp:
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.product:
        raise ManufacturingError("Produce requires a product.")
    return _op(db, op_type=ManufactureOpType.produce, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="production_in",
               direction=StockDirection.in_, actor_user_id=actor_user_id)


def reverse_op(db, *, op_id: int, actor_user_id: int) -> ManufacturingOp:
    """Reverse a consume/produce: mirror stock movement + a linked reversal op (reverse-once)."""
    original = db.get(ManufacturingOp, op_id)
    if original is None:
        raise ManufacturingError("Manufacturing op not found.")
    if original.reverses_op_id is not None:
        raise ManufacturingError("A reversal op is itself not re-reversible.")
    if db.scalar(select(ManufacturingOp).where(ManufacturingOp.reverses_op_id == op_id)) is not None:
        raise ManufacturingError("Op already reversed (reverse-once).")
    # Mirror the underlying movement (consume↔return-to-stock, produce↔remove); no-negative applies.
    mirror = stock_service.reverse_movement(
        db, original_id=original.stock_movement_id, actor_user_id=actor_user_id,
        movement_type=f"reverse_{original.op_type.value}",
    )
    rev = ManufacturingOp(
        document_number=_doc_number(db), op_type=original.op_type, item_id=original.item_id,
        location_kind=original.location_kind, location_id=original.location_id,
        quantity=original.quantity, stock_movement_id=mirror.id, reverses_op_id=op_id,
        actor_user_id=actor_user_id,
    )
    db.add(rev)
    db.flush()
    audit_service.record(db, action="manufacturing.reverse", actor_user_id=actor_user_id,
                         entity_type="manufacturing_op", entity_id=rev.id,
                         before={"op": op_id})
    return rev


# ---------------------------------------------------------------------------
# Bill of materials (recipes) — 012-manufacturing-bom.
# ---------------------------------------------------------------------------
def _validate_recipe(db: Session, *, product_id: int, output_quantity, components) -> None:
    product = db.get(Item, product_id)
    if product is None or product.kind != ItemKind.product:
        raise ManufacturingError("A recipe's output must be a product.")
    if to_qty(output_quantity) <= to_qty(0):
        raise ManufacturingError("Recipe output quantity must be positive.")
    if not components:
        raise ManufacturingError("A recipe needs at least one raw-material component.")
    seen: set[int] = set()
    for item_id, qty in components:
        if item_id in seen:
            raise ManufacturingError("A raw material appears more than once in the recipe.")
        seen.add(item_id)
        comp = db.get(Item, item_id)
        if comp is None or comp.kind != ItemKind.raw_material:
            raise ManufacturingError("Recipe components must be raw materials.")
        if to_qty(qty) <= to_qty(0):
            raise ManufacturingError("Each component quantity must be positive.")


def create_bom(
    db: Session, *, product_id: int, name: str, output_quantity, components, actor_user_id: int
) -> Bom:
    """Create a recipe. Deactivates any prior active recipe for the same product (one active each)."""
    _validate_recipe(db, product_id=product_id, output_quantity=output_quantity,
                     components=components)
    for prior in db.scalars(
        select(Bom).where(Bom.product_id == product_id, Bom.active.is_(True))
    ).all():
        prior.active = False
    bom = Bom(product_id=product_id, name=name, output_quantity=to_qty(output_quantity), active=True)
    db.add(bom)
    db.flush()
    for item_id, qty in components:
        db.add(BomComponent(bom_id=bom.id, item_id=item_id, quantity=to_qty(qty)))
    db.flush()
    audit_service.record(db, action="bom.create", actor_user_id=actor_user_id,
                         entity_type="bom", entity_id=bom.id, after={"product_id": product_id})
    return bom


def update_bom(
    db: Session, *, bom_id: int, name: str, output_quantity, components, actor_user_id: int
) -> Bom:
    """Replace a recipe's name/output/components in place (recipes are master data, editable)."""
    bom = db.get(Bom, bom_id)
    if bom is None:
        raise ManufacturingError("Recipe not found.")
    _validate_recipe(db, product_id=bom.product_id, output_quantity=output_quantity,
                     components=components)
    bom.name = name
    bom.output_quantity = to_qty(output_quantity)
    for comp in list(bom.components):
        db.delete(comp)
    db.flush()
    for item_id, qty in components:
        db.add(BomComponent(bom_id=bom.id, item_id=item_id, quantity=to_qty(qty)))
    db.flush()
    audit_service.record(db, action="bom.update", actor_user_id=actor_user_id,
                         entity_type="bom", entity_id=bom.id)
    return bom


def deactivate_bom(db: Session, *, bom_id: int, actor_user_id: int) -> Bom:
    bom = db.get(Bom, bom_id)
    if bom is None:
        raise ManufacturingError("Recipe not found.")
    bom.active = False
    db.flush()
    audit_service.record(db, action="bom.deactivate", actor_user_id=actor_user_id,
                         entity_type="bom", entity_id=bom.id)
    return bom


def list_boms(db: Session, *, product_id: int | None = None, active_only: bool = False):
    stmt = select(Bom)
    if product_id is not None:
        stmt = stmt.where(Bom.product_id == product_id)
    if active_only:
        stmt = stmt.where(Bom.active.is_(True))
    return db.scalars(stmt.order_by(Bom.id.desc())).all()


def get_bom(db: Session, bom_id: int) -> Bom | None:
    return db.get(Bom, bom_id)


def active_bom_for(db: Session, product_id: int) -> Bom | None:
    return db.scalar(select(Bom).where(Bom.product_id == product_id, Bom.active.is_(True)))


# ---------------------------------------------------------------------------
# Manufacturing orders — recipe-driven, linked consume + produce (reverse-once).
# ---------------------------------------------------------------------------
def create_order(
    db: Session,
    *,
    product_id: int,
    quantity,
    location_kind: LocationKind,
    location_id: int,
    bom_id: int | None = None,
    actor_user_id: int,
) -> ManufacturingOrder:
    """Consume the product's recipe components (scaled) and produce the product in one document.

    Cost per component = base qty consumed × raw material purchase_price (0 if unpriced). No-negative
    stock is enforced on every consumption; if a component is short, the whole order fails.
    """
    qty = to_qty(quantity)
    if qty <= to_qty(0):
        raise ManufacturingError("Produced quantity must be positive.")
    product = db.get(Item, product_id)
    if product is None or product.kind != ItemKind.product:
        raise ManufacturingError("A manufacturing order produces a product.")
    bom = db.get(Bom, bom_id) if bom_id is not None else active_bom_for(db, product_id)
    if bom is None:
        raise ManufacturingError("No recipe found for this product. Create a recipe first.")
    if bom.product_id != product_id:
        raise ManufacturingError("Recipe does not belong to this product.")
    if not bom.components:
        raise ManufacturingError("Recipe has no components.")

    scale = qty / to_qty(bom.output_quantity)

    order = ManufacturingOrder(
        document_number=_order_doc_number(db), product_id=product_id, bom_id=bom.id,
        location_kind=location_kind, location_id=location_id, quantity=qty,
        unit_cost=ZERO, total_cost=ZERO, stock_movement_id=0, actor_user_id=actor_user_id,
    )
    db.add(order)
    db.flush()

    total_cost = ZERO
    for comp in bom.components:
        consumed = to_qty(Decimal(comp.quantity) * scale)
        raw = db.get(Item, comp.item_id)
        unit_cost = to_money(raw.purchase_price) if raw and raw.purchase_price is not None else ZERO
        line_cost = to_money(consumed * unit_cost)
        total_cost += line_cost
        mv = stock_service.post_movement(
            db, item_id=comp.item_id, location_kind=location_kind, location_id=location_id,
            movement_type="consumption_out", direction=StockDirection.out, quantity=consumed,
            actor_user_id=actor_user_id, source_doc_type="manufacturing_order", source_doc_id=order.id,
        )
        order.consumptions.append(
            ManufacturingOrderConsumption(
                item_id=comp.item_id, quantity=consumed, unit_cost=unit_cost,
                line_cost=line_cost, stock_movement_id=mv.id,
            )
        )

    produced = stock_service.post_movement(
        db, item_id=product_id, location_kind=location_kind, location_id=location_id,
        movement_type="production_in", direction=StockDirection.in_, quantity=qty,
        actor_user_id=actor_user_id, source_doc_type="manufacturing_order", source_doc_id=order.id,
    )
    order.stock_movement_id = produced.id
    order.total_cost = to_money(total_cost)
    order.unit_cost = to_money(total_cost / qty) if qty else ZERO
    db.flush()
    audit_service.record(db, action="manufacturing_order.create", actor_user_id=actor_user_id,
                         entity_type="manufacturing_order", entity_id=order.id,
                         after={"doc": order.document_number, "cost": str(order.total_cost)})
    return order


def list_orders(db: Session):
    return db.scalars(select(ManufacturingOrder).order_by(ManufacturingOrder.id.desc())).all()


def get_order(db: Session, order_id: int) -> ManufacturingOrder | None:
    return db.get(ManufacturingOrder, order_id)


def reverse_order(db: Session, *, order_id: int, actor_user_id: int) -> ManufacturingOrder:
    """Mirror every movement of an order (return components to stock, remove product); reverse-once.

    Removing the produced product obeys no-negative-stock — if it was already sold/consumed the
    reversal fails rather than driving stock negative.
    """
    original = db.get(ManufacturingOrder, order_id)
    if original is None:
        raise ManufacturingError("Manufacturing order not found.")
    if original.reverses_order_id is not None:
        raise ManufacturingError("A reversal order is itself not re-reversible.")
    if db.scalar(
        select(ManufacturingOrder).where(ManufacturingOrder.reverses_order_id == order_id)
    ) is not None:
        raise ManufacturingError("Order already reversed (reverse-once).")

    rev = ManufacturingOrder(
        document_number=_order_doc_number(db), product_id=original.product_id,
        bom_id=original.bom_id, location_kind=original.location_kind,
        location_id=original.location_id, quantity=original.quantity,
        unit_cost=original.unit_cost, total_cost=original.total_cost, stock_movement_id=0,
        reverses_order_id=order_id, actor_user_id=actor_user_id,
    )
    db.add(rev)
    db.flush()
    # Remove the produced product first (fails early if it is no longer in stock).
    product_mirror = stock_service.reverse_movement(
        db, original_id=original.stock_movement_id, actor_user_id=actor_user_id,
        movement_type="reverse_production_in",
    )
    rev.stock_movement_id = product_mirror.id
    # Return each consumed component to stock.
    for cons in original.consumptions:
        mv = stock_service.reverse_movement(
            db, original_id=cons.stock_movement_id, actor_user_id=actor_user_id,
            movement_type="reverse_consumption_out",
        )
        rev.consumptions.append(
            ManufacturingOrderConsumption(
                item_id=cons.item_id, quantity=cons.quantity, unit_cost=cons.unit_cost,
                line_cost=cons.line_cost, stock_movement_id=mv.id,
            )
        )
    db.flush()
    audit_service.record(db, action="manufacturing_order.reverse", actor_user_id=actor_user_id,
                         entity_type="manufacturing_order", entity_id=rev.id,
                         before={"order": order_id})
    return rev
