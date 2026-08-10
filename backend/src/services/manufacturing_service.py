"""Manufacturing service (T028–T029). FR-013–016.

Two independent stock ops (no linkage, no BOM, no money). Each reversible via an explicit reverse
that posts a mirror stock movement (reverse-once).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import ZERO, to_money, to_qty
from src.lib import production
from src.models.bom import Bom, BomComponent, BomResource, ResourceKind
from src.models.catalog import Item, ItemKind
from src.models.manufacturing import (
    ManufactureOpType,
    ManufacturingOp,
    ManufacturingOrder,
    ManufacturingOrderConsumption,
    ManufacturingOrderResource,
)
from src.models.stock import LocationKind, StockDirection
from src.services import audit_service, stock_service, uom_service


class ManufacturingError(Exception):
    pass


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, ManufacturingOp, "MFG")


def _order_doc_number(db: Session) -> str:
    return numbering.next_document_number(db, ManufacturingOrder, "MO")


def _op(db, *, op_type, item_id, location_kind, location_id, quantity, movement_type, direction,
        actor_user_id, reverses_op_id=None) -> ManufacturingOp:
    op = ManufacturingOp(
        document_number=_doc_number(db), op_type=op_type, item_id=item_id,
        location_kind=location_kind, location_id=location_id, quantity=Decimal(quantity),
        stock_movement_id=None, reverses_op_id=reverses_op_id, actor_user_id=actor_user_id,
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
        raise ManufacturingError("الاستهلاك بيكون لخامة.")
    return _op(db, op_type=ManufactureOpType.consume, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="consumption_out",
               direction=StockDirection.out, actor_user_id=actor_user_id)


def produce(db, *, item_id, location_kind, location_id, quantity, actor_user_id) -> ManufacturingOp:
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.product:
        raise ManufacturingError("الإنتاج بيكون لمنتج.")
    return _op(db, op_type=ManufactureOpType.produce, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="production_in",
               direction=StockDirection.in_, actor_user_id=actor_user_id)


def reverse_op(db, *, op_id: int, actor_user_id: int) -> ManufacturingOp:
    """Reverse a consume/produce: mirror stock movement + a linked reversal op (reverse-once)."""
    original = db.get(ManufacturingOp, op_id)
    if original is None:
        raise ManufacturingError("عملية التصنيع مش موجودة.")
    if original.reverses_op_id is not None:
        raise ManufacturingError("العملية العكسية نفسها مايتعملهاش عكس.")
    if db.scalar(select(ManufacturingOp).where(ManufacturingOp.reverses_op_id == op_id)) is not None:
        raise ManufacturingError("العملية دي اتعكست قبل كده.")
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
def _component_rows(components):
    """Normalise recipe components to (item_id, quantity, unit).

    Callers written before units existed pass `(item_id, quantity)` and mean the base unit; both
    shapes are accepted so no existing caller has to be touched to keep meaning what it meant.
    """
    rows = []
    for comp in components or []:
        if len(comp) >= 3:
            item_id, qty, unit = comp[0], comp[1], comp[2]
        else:
            item_id, qty, unit = comp[0], comp[1], None
        rows.append((item_id, qty, unit or None))
    return rows


def _validate_recipe(db: Session, *, product_id: int, output_quantity, components,
                     resources=None) -> None:
    product = db.get(Item, product_id)
    if product is None or product.kind != ItemKind.product:
        raise ManufacturingError("ناتج التركيبة لازم يكون منتج.")
    if to_qty(output_quantity) <= to_qty(0):
        raise ManufacturingError("كمية ناتج التركيبة لازم تكون أكبر من صفر.")
    if not components:
        raise ManufacturingError("التركيبة لازم يكون فيها خامة واحدة على الأقل.")
    seen: set[int] = set()
    for item_id, qty, unit in _component_rows(components):
        if item_id in seen:
            raise ManufacturingError("فيه خامة متكررة أكتر من مرة في التركيبة.")
        seen.add(item_id)
        comp = db.get(Item, item_id)
        if comp is None or comp.kind != ItemKind.raw_material:
            raise ManufacturingError("مكوّنات التركيبة لازم تكون خامات.")
        if to_qty(qty) <= to_qty(0):
            raise ManufacturingError("كمية كل مكوّن لازم تكون أكبر من صفر.")
        # Rejected here rather than at order time: a recipe saved with a unit the item does not
        # have would fail every order made from it, long after whoever typed it has moved on.
        if unit:
            try:
                uom_service.resolve_factor(db, comp, unit)
            except Exception as exc:
                raise ManufacturingError(
                    f"وحدة «{unit}» غير معرّفة للصنف «{comp.name}»."
                ) from exc
    for kind, name, qty, rate in (resources or []):
        try:
            ResourceKind(kind)
        except ValueError:
            raise ManufacturingError(f"نوع المورد «{kind}» مش معروف.") from None
        if to_qty(qty) < to_qty(0) or to_money(rate) < ZERO:
            raise ManufacturingError("كمية المورد وسعره مايكونوش بالسالب.")


def _persist_recipe_lines(db: Session, bom: Bom, components, resources) -> None:
    for item_id, qty, unit in _component_rows(components):
        item = db.get(Item, item_id)
        factor = uom_service.resolve_factor(db, item, unit) if unit else Decimal(1)
        db.add(BomComponent(bom_id=bom.id, item_id=item_id, quantity=to_qty(qty),
                            unit=unit, unit_factor=to_qty(factor)))
    for kind, name, qty, rate in (resources or []):
        db.add(BomResource(bom_id=bom.id, kind=ResourceKind(kind), name=name,
                           quantity=to_qty(qty), rate=to_money(rate)))
    db.flush()


def create_bom(
    db: Session, *, product_id: int, name: str, output_quantity, components, actor_user_id: int,
    resources=None,
) -> Bom:
    """Create a recipe. Deactivates any prior active recipe for the same product (one active each)."""
    _validate_recipe(db, product_id=product_id, output_quantity=output_quantity,
                     components=components, resources=resources)
    for prior in db.scalars(
        select(Bom).where(Bom.product_id == product_id, Bom.active.is_(True))
    ).all():
        prior.active = False
    bom = Bom(product_id=product_id, name=name, output_quantity=to_qty(output_quantity), active=True)
    db.add(bom)
    db.flush()
    _persist_recipe_lines(db, bom, components, resources)
    audit_service.record(db, action="bom.create", actor_user_id=actor_user_id,
                         entity_type="bom", entity_id=bom.id, after={"product_id": product_id})
    return bom


def update_bom(
    db: Session, *, bom_id: int, name: str, output_quantity, components, actor_user_id: int,
    resources=None,
) -> Bom:
    """Replace a recipe's name/output/components/resources in place (recipes are editable)."""
    bom = db.get(Bom, bom_id)
    if bom is None:
        raise ManufacturingError("التركيبة مش موجودة.")
    _validate_recipe(db, product_id=bom.product_id, output_quantity=output_quantity,
                     components=components, resources=resources)
    bom.name = name
    bom.output_quantity = to_qty(output_quantity)
    for comp in list(bom.components):
        db.delete(comp)
    for res in list(bom.resources):
        db.delete(res)
    db.flush()
    _persist_recipe_lines(db, bom, components, resources)
    audit_service.record(db, action="bom.update", actor_user_id=actor_user_id,
                         entity_type="bom", entity_id=bom.id)
    return bom


def deactivate_bom(db: Session, *, bom_id: int, actor_user_id: int) -> Bom:
    bom = db.get(Bom, bom_id)
    if bom is None:
        raise ManufacturingError("التركيبة مش موجودة.")
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
    components=None,         # (031) explicit [(item_id, quantity)] for انتاج حر; None = use recipe
    resources=None,          # (014) override list of (kind, name, quantity, rate); None = use recipe
    wastes=None,             # (014) {component_item_id: waste_quantity} recorded per line
    production_date=None,    # the day production happened; defaults to today
    branch_id: int | None = None,
    work_order_ref: str | None = None,   # «امر تشغيل» — the shop-floor docket, free text
    notes: str | None = None,
) -> ManufacturingOrder:
    """Consume components and produce the product in one document.

    Components come from the product's recipe, scaled to the quantity produced — unless the caller
    passes `components`, which is **انتاج حر**: production that happened without a stored recipe, so
    the person states what actually went in. Same document, same reversal, `bom_id` left NULL
    because there was no recipe; a fabricated one would be a recipe nobody wrote and everyone
    would later find in the recipe list.

    Free production is one call on purpose. Consuming raw materials through several requests and
    producing through another leaves stock spent with nothing made if any of them fails, and that
    half-state is exactly what a document boundary exists to prevent.

    Inventory routing (014): each component is pulled from its own default warehouse and the product
    is produced into its default warehouse (falling back to the order's location). Cost = materials
    (Σ consumed × purchase_price) + resources (labor/machine/overhead: Σ qty × rate). No-negative
    stock is enforced on every consumption; if any component is short the whole order fails.
    """
    qty = to_qty(quantity)
    if qty <= to_qty(0):
        raise ManufacturingError("الكمية المنتجة لازم تكون أكبر من صفر.")
    product = db.get(Item, product_id)
    if product is None or product.kind != ItemKind.product:
        raise ManufacturingError("أمر التصنيع بينتج منتج.")
    free = components is not None
    if free:
        bom = None
        # Stated quantities are what actually went in, so there is nothing to scale — scaling a
        # figure somebody measured would silently change it.
        scale = None
        comp_rows = [(int(iid), to_qty(q)) for iid, q in components]
        if not comp_rows:
            raise ManufacturingError("الإنتاج الحر لازم يكون فيه مكوّن واحد على الأقل.")
        if any(q <= to_qty(0) for _, q in comp_rows):
            raise ManufacturingError("كمية المكوّن لازم تكون أكبر من صفر.")
        if len({iid for iid, _ in comp_rows}) != len(comp_rows):
            # Two rows for one item would each post their own movement and each be reversed, so
            # the total is right by luck and every per-line reading of it is wrong.
            raise ManufacturingError("الصنف مايتكررش في أمر الإنتاج الحر.")
    else:
        bom = db.get(Bom, bom_id) if bom_id is not None else active_bom_for(db, product_id)
        if bom is None:
            raise ManufacturingError("المنتج ده مالوش تركيبة — اعمل تركيبة الأول.")
        if bom.product_id != product_id:
            raise ManufacturingError("التركيبة دي مش بتاعة المنتج ده.")
        if not bom.components:
            raise ManufacturingError("التركيبة مفيهاش مكوّنات.")
        scale = production.scale_factor(bom.output_quantity, qty)
        comp_rows = [
            (c.item_id, production.consumed_quantity(
                c.quantity, scale, getattr(c, "unit_factor", 1) or 1))
            for c in bom.components
        ]

    wastes = wastes or {}

    # Defaulted here rather than in the column so an order always carries a real production day —
    # a NULL would push every report that groups by day into guessing.
    production_date = production_date or date.today()
    order = ManufacturingOrder(
        document_number=_order_doc_number(db), product_id=product_id,
        bom_id=bom.id if bom is not None else None,
        location_kind=location_kind, location_id=location_id, quantity=qty,
        unit_cost=ZERO, total_cost=ZERO, material_cost=ZERO, resource_cost=ZERO,
        stock_movement_id=None, actor_user_id=actor_user_id,
        production_date=production_date, branch_id=branch_id,
        work_order_ref=(work_order_ref or None), notes=(notes or None),
    )
    db.add(order)
    db.flush()

    # --- Materials: route each component to its own warehouse, consume, cost ---
    material_cost = ZERO
    for comp_item_id, consumed in comp_rows:
        raw = db.get(Item, comp_item_id)
        if raw is None:
            raise ManufacturingError("صنف المكوّن مش موجود.")
        wk, wid = production.resolve_warehouse(
            raw.default_warehouse_id if raw else None, location_kind, location_id)
        unit_cost = to_money(raw.purchase_price) if raw and raw.purchase_price is not None else ZERO
        line_cost = production.line_cost(consumed, unit_cost)
        material_cost += line_cost
        waste_qty = to_qty(wastes.get(comp_item_id, 0))
        if waste_qty < to_qty(0) or waste_qty > consumed:
            raise ManufacturingError("كمية الهالك لازم تكون بين صفر والكمية المستهلكة.")
        mv = stock_service.post_movement(
            db, item_id=comp_item_id, location_kind=wk, location_id=wid,
            movement_type="consumption_out", direction=StockDirection.out, quantity=consumed,
            actor_user_id=actor_user_id, source_doc_type="manufacturing_order", source_doc_id=order.id,
        )
        order.consumptions.append(
            ManufacturingOrderConsumption(
                item_id=comp_item_id, quantity=consumed, unit_cost=unit_cost, line_cost=line_cost,
                waste_quantity=waste_qty,
                warehouse_id=wid if wk == LocationKind.warehouse else None,
                stock_movement_id=mv.id,
            )
        )

    # --- Resources: recipe standard (scaled) unless the caller overrides per order ---
    if resources is None:
        # Free production has no recipe to read a standard off, so an order that states no labour
        # or machine time costs materials only rather than borrowing another product's figures.
        res_lines = [] if bom is None else [
            (r.kind.value, r.name, to_qty(Decimal(r.quantity) * scale), to_money(r.rate))
            for r in bom.resources
        ]
    else:
        res_lines = [(kind, name, to_qty(q), to_money(rate)) for kind, name, q, rate in resources]
    resource_cost = ZERO
    for kind, name, res_qty, rate in res_lines:
        cost = production.resource_cost(res_qty, rate)
        resource_cost += cost
        order.resources.append(ManufacturingOrderResource(
            kind=kind, name=name, quantity=res_qty, rate=rate, cost=cost))

    # --- Product: produce into its own default warehouse ---
    pk, pid = production.resolve_warehouse(product.default_warehouse_id, location_kind, location_id)
    produced = stock_service.post_movement(
        db, item_id=product_id, location_kind=pk, location_id=pid,
        movement_type="production_in", direction=StockDirection.in_, quantity=qty,
        actor_user_id=actor_user_id, source_doc_type="manufacturing_order", source_doc_id=order.id,
    )
    order.stock_movement_id = produced.id
    order.material_cost = to_money(material_cost)
    order.resource_cost = to_money(resource_cost)
    order.total_cost = to_money(material_cost + resource_cost)
    order.unit_cost = production.unit_cost(order.total_cost, qty)
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
        raise ManufacturingError("أمر التصنيع مش موجود.")
    if original.reverses_order_id is not None:
        raise ManufacturingError("الأمر العكسي نفسه مايتعملهوش عكس.")
    if db.scalar(
        select(ManufacturingOrder).where(ManufacturingOrder.reverses_order_id == order_id)
    ) is not None:
        raise ManufacturingError("الأمر ده اتعكس قبل كده.")

    rev = ManufacturingOrder(
        document_number=_order_doc_number(db), product_id=original.product_id,
        bom_id=original.bom_id, location_kind=original.location_kind,
        location_id=original.location_id, quantity=original.quantity,
        unit_cost=original.unit_cost, total_cost=original.total_cost,
        material_cost=original.material_cost, resource_cost=original.resource_cost,
        stock_movement_id=None, reverses_order_id=order_id, actor_user_id=actor_user_id,
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
                line_cost=cons.line_cost, warehouse_id=cons.warehouse_id, stock_movement_id=mv.id,
            )
        )
    db.flush()
    audit_service.record(db, action="manufacturing_order.reverse", actor_user_id=actor_user_id,
                         entity_type="manufacturing_order", entity_id=rev.id,
                         before={"order": order_id})
    return rev
