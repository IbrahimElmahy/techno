from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_factor, to_money, to_qty
from src.lib import production
from src.lib.doc_order import newest_first
from src.models.bom import Bom
from src.models.catalog import Item
from src.models.manufacturing import (
    ProductionOrderReceipt,
    ProductionOrder,
    ProductionOrderMaterial,
    ProductionOrderProduct,
    ProductionState,
)
from src.models.stock import LocationKind, StockDirection
from src.models.warehouse import Warehouse
from src.services import (
    audit_service,
    costing_service,
    numbering,
    org_service,
    stock_service,
    uom_service,
)

DOC_TYPE = "production_order"


class ProductionOrderError(Exception):
    pass


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, ProductionOrder, "WO")


def _factor(db: Session, item: Item, unit: str | None) -> Decimal:
    if not unit:
        return Decimal(1)
    try:
        return Decimal(uom_service.resolve_factor(db, item, unit))
    except Exception as exc:
        raise ProductionOrderError(f"وحدة «{unit}» غير معرّفة للصنف «{item.name}».") from exc


def _warehouse(db: Session, item: Item, given: int | None) -> int:
    wid = given if given is not None else item.default_warehouse_id
    if wid is None:
        raise ProductionOrderError(f"الصنف «{item.name}» محتاج مخزن على السطر.")
    if db.get(Warehouse, int(wid)) is None:
        raise ProductionOrderError("المخزن مش موجود.")
    return int(wid)


def recipe_plan(db: Session, *, product_id: int, quantity, bom_id: int | None = None):
    bom = db.get(Bom, bom_id) if bom_id is not None else db.scalar(
        select(Bom).where(Bom.product_id == product_id, Bom.active.is_(True)))
    if bom is None:
        return []
    if bom.product_id != product_id:
        raise ProductionOrderError("التركيبة دي مش بتاعة المنتج ده.")
    scale = production.scale_factor(bom.output_quantity, quantity)
    return [(c.item_id, production.consumed_quantity(
        c.quantity, scale, getattr(c, "unit_factor", 1) or 1)) for c in bom.components]


def _active_bom(db: Session, *, product_id: int, bom_id=None):
    if bom_id:
        return db.get(Bom, int(bom_id))
    return db.scalars(select(Bom).where(Bom.product_id == product_id,
                                        Bom.active.is_(True))
                      .order_by(Bom.id.desc())).first()


def _build_lines(db: Session, order: ProductionOrder, products) -> None:
    if not products:
        raise ProductionOrderError("أمر التشغيل لازم يكون فيه منتج واحد على الأقل.")

    total_expense = ZERO
    total_plan_qty = to_qty(0)
    total_actual_qty = to_qty(0)
    total_material_qty = to_qty(0)

    for p in products:
        item = db.get(Item, int(p["item_id"]))
        if item is None:
            raise ProductionOrderError("صنف المنتج مش موجود.")
        p_unit = p.get("unit") or None
        p_factor = _factor(db, item, p_unit)
        raw_plan = p.get("planned_quantity") or p.get("quantity")
        planned = to_qty(Decimal(str(raw_plan)) * p_factor)
        actual = to_qty(Decimal(str(p.get("quantity") or raw_plan)) * p_factor)
        if actual <= to_qty(0):
            raise ProductionOrderError(f"كمية «{item.name}» لازم تكون أكبر من صفر.")
        p_wh = _warehouse(db, item, p.get("warehouse_id"))
        expense = to_money(p.get("expense_amount") or 0)
        if expense < ZERO:
            raise ProductionOrderError("المصاريف مايكونوش بالسالب.")

        line = ProductionOrderProduct(
            order_id=order.id, item_id=item.id, warehouse_id=p_wh,
            planned_quantity=planned, quantity=actual, unit=p_unit, unit_factor=to_factor(p_factor),
            bom_id=p.get("bom_id"), material_cost=ZERO, expense_amount=expense,
            total_cost=ZERO, unit_cost=ZERO)
        order.products.append(line)
        db.flush()

        bom_stage: dict[int, str] = {}
        _bom = _active_bom(db, product_id=item.id, bom_id=p.get("bom_id"))
        if _bom is not None:
            bom_stage = {c.item_id: (c.stage or STAGE_PRODUCTION)
                         for c in _bom.components}

        rows = p.get("materials") or []
        if not rows:
            rows = [{"item_id": iid, "quantity": q, "planned_quantity": q} for iid, q in
                    recipe_plan(db, product_id=item.id, quantity=actual, bom_id=p.get("bom_id"))]
        if not rows:
            raise ProductionOrderError(
                f"«{item.name}» مالوش خامات ولا وصفة — التكلفة مش هتتحسب من غيرها.")
        if len({int(m["item_id"]) for m in rows}) != len(rows):
            raise ProductionOrderError(f"فيه خامة متكررة تحت «{item.name}».")

        for m in rows:
            raw = db.get(Item, int(m["item_id"]))
            if raw is None:
                raise ProductionOrderError("صنف الخامة مش موجود.")
            m_unit = m.get("unit") or None
            m_factor = _factor(db, raw, m_unit)
            m_plan_raw = m.get("planned_quantity") or m.get("quantity")
            m_planned = to_qty(Decimal(str(m_plan_raw)) * m_factor)
            m_qty = to_qty(Decimal(str(m.get("quantity") or m_plan_raw)) * m_factor)
            if m_qty <= to_qty(0):
                raise ProductionOrderError(f"كمية «{raw.name}» لازم تكون أكبر من صفر.")
            waste = to_qty(m.get("waste_quantity") or 0)
            if waste < to_qty(0) or waste > m_qty:
                raise ProductionOrderError("كمية الهالك لازم تكون بين صفر والكمية المصروفة.")
            order.materials.append(ProductionOrderMaterial(
                order_id=order.id, product_line_id=line.id, item_id=raw.id,
                warehouse_id=_warehouse(db, raw, m.get("warehouse_id")),
                planned_quantity=m_planned, quantity=m_qty, unit=m_unit,
                unit_factor=to_factor(m_factor), unit_cost=ZERO, line_cost=ZERO,
                waste_quantity=waste,
                stage=(m.get("stage")
                       or bom_stage.get(raw.id)
                       or STAGE_PRODUCTION)))
            total_material_qty += m_qty

        total_expense += expense
        total_plan_qty += planned
        total_actual_qty += actual

    order.expense_amount = to_money(total_expense)
    order.planned_quantity = total_plan_qty
    order.product_quantity = total_actual_qty
    order.material_quantity = total_material_qty
    order.material_cost = ZERO
    order.total_cost = to_money(total_expense)
    db.flush()


def _enforce_factory_branch(db: Session, order: ProductionOrder) -> None:
    whs = [p.warehouse_id for p in order.products] + [m.warehouse_id for m in order.materials]
    branch_id, problem = org_service.production_branch_problem(db, order.branch_id, whs)
    if problem:
        raise ProductionOrderError(problem)
    order.branch_id = branch_id


def create_order(
    db: Session,
    *,
    products,
    actor_user_id: int,
    production_date: date | None = None,
    branch_id: int | None = None,
    external_document_number: str | None = None,
    statement1: str | None = None,
    notes: str | None = None,
    reviewed: bool = False,
    execute: bool = False,
) -> ProductionOrder:
    order = ProductionOrder(
        document_number=_doc_number(db),
        production_date=production_date or date.today(), branch_id=branch_id,
        external_document_number=(external_document_number or None),
        statement1=(statement1 or None), notes=(notes or None), reviewed=bool(reviewed),
        state=ProductionState.draft,
        material_cost=ZERO, expense_amount=ZERO, total_cost=ZERO,
        planned_quantity=to_qty(0), product_quantity=to_qty(0), material_quantity=to_qty(0),
        actor_user_id=actor_user_id)
    db.add(order)
    db.flush()
    _build_lines(db, order, products)
    if order.branch_id is None and order.products and len(org_service.factory_branches(db)) != 1:
        w = db.get(Warehouse, order.products[0].warehouse_id)
        order.branch_id = w.branch_id if w is not None else None
    _enforce_factory_branch(db, order)
    audit_service.record(db, action="production_order.create", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id,
                         after={"doc": order.document_number})
    if execute:
        execute_order(db, order_id=order.id, actor_user_id=actor_user_id)
    return order


def update_order(db: Session, *, order_id: int, products, actor_user_id: int, **header) -> ProductionOrder:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.state == ProductionState.in_progress:
        raise ProductionOrderError(
            "الأمر بدأ وخاماته اتصرفت — اقفله وسجّل اللي طلع، أو اعكسه واكتب غيره.")
    if order.state not in (ProductionState.draft, ProductionState.confirmed):
        raise ProductionOrderError("الأمر المنفّذ مايتعدّلش — اعكسه واكتب غيره.")
    for field in ("production_date", "branch_id", "external_document_number",
                  "statement1", "notes", "reviewed"):
        if field in header:
            setattr(order, field, header[field])
    for line in list(order.materials):
        db.delete(line)
    for line in list(order.products):
        db.delete(line)
    db.flush()
    _build_lines(db, order, products)
    _enforce_factory_branch(db, order)
    order.state = ProductionState.draft
    order.reviewed = False
    audit_service.record(db, action="production_order.update", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id)
    return order


def confirm_order(db: Session, *, order_id: int, actor_user_id: int) -> ProductionOrder:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.state != ProductionState.draft:
        raise ProductionOrderError("التأكيد بيتعمل للمسودة بس.")
    order.state = ProductionState.confirmed
    order.reviewed = True
    db.flush()
    audit_service.record(db, action="production_order.confirm", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id)
    return order


STAGE_PRODUCTION = "production"
STAGE_QUALITY = "quality"


def stage_of(material) -> str:
    return material.stage or STAGE_PRODUCTION


def pending(order: ProductionOrder, stage: str | None = None) -> list:
    return [m for m in order.materials
            if m.stock_movement_id is None
            and (stage is None or stage_of(m) == stage)]


def _issue_materials(db: Session, order: ProductionOrder, actor_user_id: int,
                     *, stage: str | None = None) -> Decimal:
    rows = pending(order, stage)
    if not rows:
        return ZERO
    averages = costing_service.average_cost_bulk(db, {m.item_id for m in rows})
    total = ZERO
    for m in rows:
        mv = stock_service.post_movement(
            db, item_id=m.item_id, location_kind=LocationKind.warehouse,
            location_id=int(m.warehouse_id), movement_type="consumption_out",
            direction=StockDirection.out, quantity=to_qty(m.quantity),
            actor_user_id=actor_user_id, source_doc_type=DOC_TYPE, source_doc_id=order.id)
        m.unit_cost = to_money(averages.get(m.item_id, ZERO))
        m.line_cost = production.line_cost(m.quantity, m.unit_cost)
        m.stock_movement_id = mv.id
        total += m.line_cost
    return to_money(total)


def issue_quality(db: Session, *, order_id: int, actor_user_id: int) -> ProductionOrder:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.imported_from is not None:
        raise ProductionOrderError("الأمر المنقول من a5 خلص في نظامهم.")
    if order.state != ProductionState.in_progress:
        raise ProductionOrderError("خامات الجودة بتتصرف للأمر الشغّال بس.")
    if not pending(order, STAGE_QUALITY):
        raise ProductionOrderError("مافيش خامات جودة لسه ما اتصرفتش في الأمر ده.")
    order.material_cost = to_money(
        to_money(order.material_cost)
        + _issue_materials(db, order, actor_user_id, stage=STAGE_QUALITY))
    order.total_cost = to_money(order.material_cost + order.expense_amount)
    db.flush()
    audit_service.record(db, action="production_order.issue_quality",
                         actor_user_id=actor_user_id, entity_type="production_order",
                         entity_id=order.id, after={"materials": str(order.material_cost)})
    return order


def start_order(db: Session, *, order_id: int, actor_user_id: int) -> ProductionOrder:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.imported_from is not None:
        raise ProductionOrderError("الأمر المنقول من a5 خلص في نظامهم.")
    if order.state != ProductionState.confirmed:
        raise ProductionOrderError("التشغيل بيبدأ من الأمر المؤكد بس.")
    order.material_cost = _issue_materials(db, order, actor_user_id,
                                           stage=STAGE_PRODUCTION)
    order.total_cost = to_money(order.material_cost + order.expense_amount)
    order.state = ProductionState.in_progress
    db.flush()
    audit_service.record(db, action="production_order.start", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id,
                         after={"materials": str(order.material_cost)})
    return order


def receive_output(db: Session, *, order_id: int, actor_user_id: int,
                   rows: dict[int, Decimal], receipt_date=None,
                   notes: str | None = None) -> ProductionOrder:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.imported_from is not None:
        raise ProductionOrderError("الأمر المنقول من a5 خلص في نظامهم.")
    if order.state != ProductionState.in_progress:
        raise ProductionOrderError("الاستلام بيتعمل للأمر الشغّال بس.")
    if not rows:
        raise ProductionOrderError("مافيش كمية اتكتبت.")

    by_id = {p.id: p for p in order.products}
    when = receipt_date or order.production_date
    total = to_qty(0)
    for line_id, raw in rows.items():
        line = by_id.get(int(line_id))
        if line is None:
            raise ProductionOrderError("سطر منتج مش في الأمر ده.")
        q = to_qty(Decimal(str(raw or 0)))
        if q <= to_qty(0):
            continue
        mv = stock_service.post_movement(
            db, item_id=line.item_id, location_kind=LocationKind.warehouse,
            location_id=int(line.warehouse_id), movement_type="production_in",
            direction=StockDirection.in_, quantity=q, actor_user_id=actor_user_id,
            source_doc_type=DOC_TYPE, source_doc_id=order.id, movement_date=when)
        db.add(ProductionOrderReceipt(
            order_id=order.id, product_line_id=line.id, quantity=q,
            receipt_date=when, notes=notes, stock_movement_id=mv.id,
            actor_user_id=actor_user_id))
        line.received_quantity = to_qty(to_qty(line.received_quantity) + q)
        total += q
    if total <= to_qty(0):
        raise ProductionOrderError("الكمية المستلمة لازم تكون أكبر من صفر.")
    db.flush()
    audit_service.record(db, action="production_order.receive",
                         actor_user_id=actor_user_id, entity_type="production_order",
                         entity_id=order.id, after={"quantity": str(total)})
    return order


def undo_receipt(db: Session, *, order_id: int, receipt_id: int,
                 actor_user_id: int) -> ProductionOrder:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.state != ProductionState.in_progress:
        raise ProductionOrderError("عكس الاستلام بيتعمل للأمر الشغّال بس.")
    rc = db.get(ProductionOrderReceipt, receipt_id)
    if rc is None or rc.order_id != order.id:
        raise ProductionOrderError("دفعة الاستلام مش في الأمر ده.")
    if rc.stock_movement_id:
        stock_service.reverse_movement(
            db, original_id=rc.stock_movement_id, actor_user_id=actor_user_id,
            movement_type="reverse_production_in")
    line = db.get(ProductionOrderProduct, rc.product_line_id)
    if line is not None:
        left = to_qty(to_qty(line.received_quantity) - to_qty(rc.quantity))
        line.received_quantity = left if left > to_qty(0) else to_qty(0)
    db.delete(rc)
    db.flush()
    audit_service.record(db, action="production_order.undo_receipt",
                         actor_user_id=actor_user_id, entity_type="production_order",
                         entity_id=order.id, after={"quantity": str(rc.quantity)})
    return order


def execute_order(db: Session, *, order_id: int, actor_user_id: int,
                  outputs: dict[int, Decimal] | None = None,
                  waste: dict[int, Decimal] | None = None) -> ProductionOrder:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.imported_from is not None:
        raise ProductionOrderError("الأمر المنقول من a5 اتنفّذ في نظامهم — مايترحّلش تاني.")
    if order.state not in (ProductionState.draft, ProductionState.confirmed,
                           ProductionState.in_progress):
        raise ProductionOrderError("الأمر ده اترحّل قبل كده.")

    if outputs:
        by_id = {p.id: p for p in order.products}
        for line_id, qty in outputs.items():
            line = by_id.get(int(line_id))
            if line is None:
                raise ProductionOrderError("سطر منتج مش في الأمر ده.")
            q = to_qty(Decimal(str(qty)))
            if q <= to_qty(0):
                raise ProductionOrderError("الكمية اللي طلعت لازم تكون أكبر من صفر.")
            if q < to_qty(line.received_quantity):
                raise ProductionOrderError(
                    f"اللي طلع ({q}) أقل من اللي اتستلم خلاص "
                    f"({to_qty(line.received_quantity)}) — اعكس دفعة الاستلام الغلط "
                    f"من كشف الدفعات الأول.")
            line.quantity = q
        order.product_quantity = to_qty(sum((to_qty(p.quantity) for p in order.products),
                                            to_qty(0)))
        db.flush()
    else:
        for p_line in order.products:
            if to_qty(p_line.received_quantity) > to_qty(0):
                p_line.quantity = to_qty(p_line.received_quantity)
        order.product_quantity = to_qty(sum((to_qty(p.quantity) for p in order.products),
                                            to_qty(0)))
        db.flush()

    if waste:
        by_mid = {m.id: m for m in order.materials}
        for line_id, qty in waste.items():
            line = by_mid.get(int(line_id))
            if line is None:
                raise ProductionOrderError("سطر خامة مش في الأمر ده.")
            w = to_qty(Decimal(str(qty or 0)))
            if w < to_qty(0) or w > to_qty(line.quantity):
                raise ProductionOrderError(
                    "الهالك لازم يكون بين صفر والكمية اللي اتصرفت.")
            line.waste_quantity = w
        db.flush()

    by_line: dict[int, Decimal] = {}
    _issue_materials(db, order, actor_user_id)
    for m in order.materials:
        if m.product_line_id is not None:
            by_line[m.product_line_id] = (
                by_line.get(m.product_line_id, ZERO) + to_money(m.line_cost))

    material_cost = ZERO
    for p in order.products:
        remaining = to_qty(to_qty(p.quantity) - to_qty(p.received_quantity))
        mv = (stock_service.post_movement(
            db, item_id=p.item_id, location_kind=LocationKind.warehouse,
            location_id=int(p.warehouse_id), movement_type="production_in",
            direction=StockDirection.in_, quantity=remaining,
            actor_user_id=actor_user_id, source_doc_type=DOC_TYPE, source_doc_id=order.id)
            if remaining > to_qty(0) else None)
        if mv is not None:
            p.stock_movement_id = mv.id
        p.received_quantity = to_qty(p.quantity)
        p.material_cost = to_money(by_line.get(p.id, ZERO))
        p.total_cost = to_money(p.material_cost + p.expense_amount)
        p.unit_cost = production.unit_cost(p.total_cost, p.quantity)
        material_cost += p.material_cost

    order.material_cost = to_money(material_cost)
    order.total_cost = to_money(material_cost + order.expense_amount)
    order.state = ProductionState.done
    db.flush()
    audit_service.record(db, action="production_order.execute", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id,
                         after={"cost": str(order.total_cost)})
    return order


def list_orders(db: Session, *, search: str | None = None, branch_id: int | None = None,
                state: str | None = None, date_from=None, date_to=None,
                imported: bool | None = None, statement: str | None = None):
    stmt = select(ProductionOrder)
    if branch_id is not None:
        stmt = stmt.where(ProductionOrder.branch_id == branch_id)
    if state:
        stmt = stmt.where(ProductionOrder.state == ProductionState(state))
    if date_from is not None:
        stmt = stmt.where(ProductionOrder.production_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(ProductionOrder.production_date <= date_to)
    if imported is True:
        stmt = stmt.where(ProductionOrder.imported_from.is_not(None))
    elif imported is False:
        stmt = stmt.where(ProductionOrder.imported_from.is_(None))
    if search:
        q = f"%{search.strip()}%"
        stmt = stmt.where(ProductionOrder.document_number.ilike(q)
                          | ProductionOrder.external_document_number.ilike(q)
                          | ProductionOrder.statement1.ilike(q)
                          | ProductionOrder.notes.ilike(q))
    if statement and statement.strip():
        stmt = stmt.where(ProductionOrder.statement1.ilike(f"%{statement.strip()}%"))
    return db.scalars(stmt.order_by(*newest_first(ProductionOrder, ProductionOrder.production_date))).all()


def get_order(db: Session, order_id: int) -> ProductionOrder | None:
    return db.get(ProductionOrder, order_id)


def reversed_ids(db: Session) -> set[int]:
    return {r for (r,) in db.execute(
        select(ProductionOrder.reverses_id).where(
            ProductionOrder.reverses_id.is_not(None))).all()}


def delete_draft(db: Session, *, order_id: int, actor_user_id: int) -> None:
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.state not in (ProductionState.draft, ProductionState.confirmed):
        raise ProductionOrderError("المنفّذ مايتمسحش — اعكسه.")
    audit_service.record(db, action="production_order.delete", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id,
                         before={"doc": order.document_number})
    db.delete(order)
    db.flush()


def purge_order(db: Session, *, order_id: int, actor_user_id: int, pair_ok: bool = False) -> str:
    from sqlalchemy import delete

    from src.models.stock import StockMovement
    from src.services.document_edit_service import _drop_stock

    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.imported_from is not None:
        raise ProductionOrderError(
            f"{order.document_number} منقول من a5 — مايتمسحش من هنا.")
    if not pair_ok and (order.reverses_id is not None or db.scalar(select(ProductionOrder.id).where(
            ProductionOrder.reverses_id == order_id)) is not None):
        raise ProductionOrderError(
            f"{order.document_number} عليه أمر عكس (أو هو عكس) — امسحهم مع بعض بقرار.")
    doc = order.document_number
    before = {"doc": doc, "state": order.state.value if order.state else None,
              "branch_id": order.branch_id}

    db.execute(delete(ProductionOrderReceipt).where(ProductionOrderReceipt.order_id == order_id))
    db.execute(delete(ProductionOrderMaterial).where(
        ProductionOrderMaterial.order_id == order_id))
    db.execute(delete(ProductionOrderProduct).where(
        ProductionOrderProduct.order_id == order_id))
    db.execute(delete(StockMovement).where(
        StockMovement.source_doc_type == "production_order",
        StockMovement.source_doc_id == order_id,
        StockMovement.reverses_movement_id.is_not(None)))
    _drop_stock(db, source_doc_type="production_order", source_doc_id=order_id)
    db.execute(delete(ProductionOrder).where(ProductionOrder.id == order_id))
    db.flush()
    db.expire_all()
    audit_service.record(db, action="production_order.purge", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order_id, before=before)
    return doc


def reverse_order(db: Session, *, order_id: int, actor_user_id: int) -> ProductionOrder:
    original = db.get(ProductionOrder, order_id)
    if original is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if original.reverses_id is not None:
        raise ProductionOrderError("الأمر العكسي نفسه مايتعملهوش عكس.")
    if original.imported_from is not None:
        raise ProductionOrderError("الأمر المنقول من a5 للعرض بس — مايتعكسش من هنا.")
    if original.state not in (ProductionState.done, ProductionState.in_progress):
        raise ProductionOrderError("العكس بيتعمل للشغّال والمنفّذ — المسودة تتعدّل أو تتمسح.")
    if db.scalar(select(ProductionOrder).where(
            ProductionOrder.reverses_id == order_id)) is not None:
        raise ProductionOrderError("الأمر ده اتعكس قبل كده.")

    rev = ProductionOrder(
        document_number=_doc_number(db), production_date=date.today(),
        branch_id=original.branch_id,
        external_document_number=original.external_document_number,
        statement1=f"عكس {original.document_number}", notes=original.notes,
        state=ProductionState.done,
        material_cost=original.material_cost, expense_amount=original.expense_amount,
        total_cost=original.total_cost, planned_quantity=original.planned_quantity,
        product_quantity=original.product_quantity,
        material_quantity=original.material_quantity,
        reverses_id=order_id, actor_user_id=actor_user_id)
    db.add(rev)
    db.flush()

    by_line: dict[int, int] = {}
    for p in original.products:
        mirror = (stock_service.reverse_movement(
            db, original_id=p.stock_movement_id, actor_user_id=actor_user_id,
            movement_type="reverse_production_in")
            if p.stock_movement_id else None)
        line = ProductionOrderProduct(
            order_id=rev.id, item_id=p.item_id, warehouse_id=p.warehouse_id,
            planned_quantity=p.planned_quantity, quantity=p.quantity,
            unit=p.unit, unit_factor=p.unit_factor, bom_id=p.bom_id,
            material_cost=p.material_cost, expense_amount=p.expense_amount,
            total_cost=p.total_cost, unit_cost=p.unit_cost,
            stock_movement_id=mirror.id if mirror else None)
        rev.products.append(line)
        db.flush()
        by_line[p.id] = line.id

    for rc in original.receipts:
        if rc.stock_movement_id:
            stock_service.reverse_movement(
                db, original_id=rc.stock_movement_id, actor_user_id=actor_user_id,
                movement_type="reverse_production_in")

    for m in original.materials:
        mirror = (stock_service.reverse_movement(
            db, original_id=m.stock_movement_id, actor_user_id=actor_user_id,
            movement_type="reverse_consumption_out")
            if m.stock_movement_id else None)
        rev.materials.append(ProductionOrderMaterial(
            order_id=rev.id, product_line_id=by_line.get(m.product_line_id),
            item_id=m.item_id, warehouse_id=m.warehouse_id,
            planned_quantity=m.planned_quantity, quantity=m.quantity,
            unit=m.unit, unit_factor=m.unit_factor, unit_cost=m.unit_cost,
            line_cost=m.line_cost, waste_quantity=m.waste_quantity, stage=m.stage,
            stock_movement_id=(mirror.id if mirror else None)))

    original.state = ProductionState.reversed
    db.flush()
    audit_service.record(db, action="production_order.reverse", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=rev.id,
                         before={"order": order_id})
    return rev
