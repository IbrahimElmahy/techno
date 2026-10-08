from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import ZERO, to_factor, to_money, to_qty
from src.lib import production
from src.lib.doc_order import newest_first
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
from src.services import audit_service, org_service, stock_service, uom_service


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
        raise ManufacturingError("الاستهلاك يكون للخامة.")
    return _op(db, op_type=ManufactureOpType.consume, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="consumption_out",
               direction=StockDirection.out, actor_user_id=actor_user_id)


def produce(db, *, item_id, location_kind, location_id, quantity, actor_user_id) -> ManufacturingOp:
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.product:
        raise ManufacturingError("الإنتاج يكون للمنتج.")
    return _op(db, op_type=ManufactureOpType.produce, item_id=item_id, location_kind=location_kind,
               location_id=location_id, quantity=quantity, movement_type="production_in",
               direction=StockDirection.in_, actor_user_id=actor_user_id)


def reverse_op(db, *, op_id: int, actor_user_id: int) -> ManufacturingOp:
    original = db.get(ManufacturingOp, op_id)
    if original is None:
        raise ManufacturingError("عملية التصنيع غير موجودة.")
    if original.reverses_op_id is not None:
        raise ManufacturingError("لا يمكن عكس العملية العكسية نفسها.")
    if db.scalar(select(ManufacturingOp).where(ManufacturingOp.reverses_op_id == op_id)) is not None:
        raise ManufacturingError("هذه العملية معكوسة مسبقاً.")
    mirror = stock_service.reverse_movement(
        db, original_id=original.stock_movement_id, actor_user_id=actor_user_id,
        movement_type=None,
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


def _component_rows(components):
    rows = []
    for comp in components or []:
        item_id, qty = comp[0], comp[1]
        unit = comp[2] if len(comp) >= 3 else None
        stage = comp[3] if len(comp) >= 4 else None
        rows.append((item_id, qty, unit or None, stage or None))
    return rows


def _validate_recipe(db: Session, *, product_id: int, output_quantity, components,
                     resources=None) -> None:
    product = db.get(Item, product_id)
    if product is None or product.kind != ItemKind.product:
        raise ManufacturingError("يجب أن يكون ناتج التركيبة منتجاً.")
    if to_qty(output_quantity) <= to_qty(0):
        raise ManufacturingError("يجب أن تكون كمية ناتج التركيبة أكبر من صفر.")
    if not components:
        raise ManufacturingError("يجب أن تحتوي التركيبة على خامة واحدة على الأقل.")
    seen: set[int] = set()
    for item_id, qty, unit, _stage in _component_rows(components):
        if item_id in seen:
            raise ManufacturingError("توجد خامة متكررة أكثر من مرة في التركيبة.")
        seen.add(item_id)
        comp = db.get(Item, item_id)
        if comp is None:
            raise ManufacturingError("المكوّن غير موجود في الكتالوج.")
        if comp.id == product_id:
            raise ManufacturingError("لا يجوز أن يكون الصنف مكوّناً في وصفته نفسها.")
        if to_qty(qty) <= to_qty(0):
            raise ManufacturingError("يجب أن تكون كمية كل مكوّن أكبر من صفر.")
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
            raise ManufacturingError(f"نوع المورد «{kind}» غير معروف.") from None
        if to_qty(qty) < to_qty(0) or to_money(rate) < ZERO:
            raise ManufacturingError("لا يمكن أن تكون كمية المورد وسعره سالبين.")


def _persist_recipe_lines(db: Session, bom: Bom, components, resources) -> None:
    for item_id, qty, unit, stage in _component_rows(components):
        item = db.get(Item, item_id)
        factor = uom_service.resolve_factor(db, item, unit) if unit else Decimal(1)
        db.add(BomComponent(bom_id=bom.id, item_id=item_id, quantity=to_qty(qty),
                            unit=unit, unit_factor=to_factor(factor), stage=stage))
    for kind, name, qty, rate in (resources or []):
        db.add(BomResource(bom_id=bom.id, kind=ResourceKind(kind), name=name,
                           quantity=to_qty(qty), rate=to_money(rate)))
    db.flush()


def create_bom(
    db: Session, *, product_id: int, name: str, output_quantity, components, actor_user_id: int,
    resources=None,
) -> Bom:
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
    bom = db.get(Bom, bom_id)
    if bom is None:
        raise ManufacturingError("التركيبة غير موجودة.")
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
        raise ManufacturingError("التركيبة غير موجودة.")
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


def create_order(
    db: Session,
    *,
    product_id: int,
    quantity,
    location_kind: LocationKind,
    location_id: int,
    bom_id: int | None = None,
    actor_user_id: int,
    components=None,
    resources=None,
    wastes=None,
    production_date=None,
    branch_id: int | None = None,
    work_order_ref: str | None = None,
    notes: str | None = None,
    statement1: str | None = None,
) -> ManufacturingOrder:
    qty = to_qty(quantity)
    if qty <= to_qty(0):
        raise ManufacturingError("يجب أن تكون الكمية المنتجة أكبر من صفر.")
    product = db.get(Item, product_id)
    if product is None or product.kind != ItemKind.product:
        raise ManufacturingError("أمر التصنيع يُنتج منتجاً.")
    free = components is not None
    if free:
        bom = None
        scale = None
        comp_rows = [(int(iid), to_qty(q)) for iid, q in components]
        if not comp_rows:
            raise ManufacturingError("يجب أن يحتوي الإنتاج الحر على مكوّن واحد على الأقل.")
        if any(q <= to_qty(0) for _, q in comp_rows):
            raise ManufacturingError("يجب أن تكون كمية المكوّن أكبر من صفر.")
        if len({iid for iid, _ in comp_rows}) != len(comp_rows):
            raise ManufacturingError("لا يجوز تكرار الصنف في أمر الإنتاج الحر.")
    else:
        bom = db.get(Bom, bom_id) if bom_id is not None else active_bom_for(db, product_id)
        if bom is None:
            raise ManufacturingError("لا توجد تركيبة لهذا المنتج — أنشئ تركيبة أولاً.")
        if bom.product_id != product_id:
            raise ManufacturingError("هذه التركيبة لا تخص هذا المنتج.")
        if not bom.components:
            raise ManufacturingError("لا تحتوي التركيبة على مكوّنات.")
        scale = production.scale_factor(bom.output_quantity, qty)
        comp_rows = [
            (c.item_id, production.consumed_quantity(
                c.quantity, scale, getattr(c, "unit_factor", 1) or 1))
            for c in bom.components
        ]

    wastes = wastes or {}

    branch_id, problem = org_service.production_branch_problem(
        db, branch_id,
        [location_id] if location_kind == LocationKind.warehouse else [])
    if problem:
        raise ManufacturingError(problem)

    production_date = production_date or date.today()
    order = ManufacturingOrder(
        document_number=_order_doc_number(db), product_id=product_id,
        bom_id=bom.id if bom is not None else None,
        location_kind=location_kind, location_id=location_id, quantity=qty,
        unit_cost=ZERO, total_cost=ZERO, material_cost=ZERO, resource_cost=ZERO,
        stock_movement_id=None, actor_user_id=actor_user_id,
        production_date=production_date, branch_id=branch_id,
        work_order_ref=(work_order_ref or None), notes=(notes or None),
        statement1=((statement1 or "").strip() or None),
    )
    db.add(order)
    db.flush()

    material_cost = ZERO
    for comp_item_id, consumed in comp_rows:
        raw = db.get(Item, comp_item_id)
        if raw is None:
            raise ManufacturingError("صنف المكوّن غير موجود.")
        wk, wid = production.resolve_warehouse(
            raw.default_warehouse_id if raw else None, location_kind, location_id)
        unit_cost = to_money(raw.purchase_price) if raw and raw.purchase_price is not None else ZERO
        line_cost = production.line_cost(consumed, unit_cost)
        material_cost += line_cost
        waste_qty = to_qty(wastes.get(comp_item_id, 0))
        if waste_qty < to_qty(0) or waste_qty > consumed:
            raise ManufacturingError("يجب أن تكون كمية الهالك بين صفر والكمية المستهلكة.")
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

    if resources is None:
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
    return db.scalars(select(ManufacturingOrder).order_by(
        *newest_first(ManufacturingOrder, ManufacturingOrder.production_date))).all()


def get_order(db: Session, order_id: int) -> ManufacturingOrder | None:
    return db.get(ManufacturingOrder, order_id)


def reverse_order(db: Session, *, order_id: int, actor_user_id: int) -> ManufacturingOrder:
    original = db.get(ManufacturingOrder, order_id)
    if original is None:
        raise ManufacturingError("أمر التصنيع غير موجود.")
    if original.reverses_order_id is not None:
        raise ManufacturingError("لا يمكن عكس الأمر العكسي نفسه.")
    if db.scalar(
        select(ManufacturingOrder).where(ManufacturingOrder.reverses_order_id == order_id)
    ) is not None:
        raise ManufacturingError("هذا الأمر معكوس مسبقاً.")

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
    product_mirror = stock_service.reverse_movement(
        db, original_id=original.stock_movement_id, actor_user_id=actor_user_id,
        movement_type="reverse_production_in",
    )
    rev.stock_movement_id = product_mirror.id
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


def work_order_ref(document_number: str | None) -> str:
    num = document_number or ""
    return num.rsplit("-", 1)[0] if "-" in num else num


def list_work_orders(db: Session, *, search: str | None = None,
                     date_from=None, date_to=None) -> list[dict]:
    from src.models.stock import StockMovement
    from src.models.warehouse import Warehouse

    wh_name = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}
    wh_branch = {w.id: w.branch_id for w in db.scalars(select(Warehouse)).all()}
    names = {i.id: i.name for i in db.scalars(select(Item)).all()}
    codes = {i.id: i.code for i in db.scalars(select(Item)).all()}
    units = {i.id: i.unit_of_measure for i in db.scalars(select(Item)).all()}

    stmt = (select(ManufacturingOp, StockMovement.movement_date, StockMovement.created_at)
            .outerjoin(StockMovement, StockMovement.id == ManufacturingOp.stock_movement_id))

    orders: dict[str, dict] = {}
    for op, mv_date, mv_created in db.execute(stmt).all():
        ref = work_order_ref(op.document_number)
        when = mv_date or (mv_created.date() if mv_created else None)
        o = orders.setdefault(ref, {
            "ref": ref, "date": when, "branch_id": None,
            "products": [], "materials": [],
            "product_quantity": ZERO, "material_quantity": ZERO,
        })
        if when and (o["date"] is None or when < o["date"]):
            o["date"] = when
        wid = int(op.location_id)
        if o["branch_id"] is None:
            o["branch_id"] = wh_branch.get(wid)
        produce = op.op_type == ManufactureOpType.produce
        line = {
            "op_id": op.id, "document_number": op.document_number,
            "item_id": op.item_id, "code": codes.get(op.item_id, ""),
            "name": names.get(op.item_id, f"#{op.item_id}"),
            "unit": units.get(op.item_id, ""),
            "quantity": str(to_qty(op.quantity)),
            "warehouse_id": wid, "warehouse": wh_name.get(wid, f"#{wid}"),
            "is_reversal": op.reverses_op_id is not None,
        }
        if produce:
            o["products"].append(line)
            o["product_quantity"] += to_qty(op.quantity)
        else:
            o["materials"].append(line)
            o["material_quantity"] += to_qty(op.quantity)

    rows = list(orders.values())
    if date_from:
        rows = [r for r in rows if r["date"] and str(r["date"]) >= str(date_from)]
    if date_to:
        rows = [r for r in rows if r["date"] and str(r["date"]) <= str(date_to)]
    if search:
        q = search.strip()
        rows = [r for r in rows if q in r["ref"]
                or any(q in ln["name"] or q in (ln["code"] or "")
                       for ln in (*r["products"], *r["materials"]))]
    for r in rows:
        r["date"] = str(r["date"]) if r["date"] else None
        r["product_quantity"] = str(r["product_quantity"])
        r["material_quantity"] = str(r["material_quantity"])
    rows.sort(key=lambda r: (r["date"] or "", r["ref"]), reverse=True)
    return rows
