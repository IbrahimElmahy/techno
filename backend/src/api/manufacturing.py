"""Manufacturing router (T030, extended by 012-manufacturing-bom).

Two layers: manual consume/produce ops (kept) + recipe-driven manufacturing orders with BOM CRUD.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_MANUFACTURE_READ, CAP_MANUFACTURE_WRITE
from src.core.db import get_db
from src.models.stock import LocationKind
from src.services import manufacturing_production_service as production_order_service
from src.services import manufacturing_service
from src.services.manufacturing_production_service import ProductionOrderError
from src.services.manufacturing_service import ManufacturingError
from src.services.stock_service import StockError

router = APIRouter(tags=["manufacturing"], prefix="/manufacturing")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class ManufactureOp(BaseModel):
    item_id: int
    location: LocationIn
    quantity: Decimal


class OpOut(BaseModel):
    id: int
    document_number: str
    op_type: str
    stock_movement_id: int


def _out(op) -> OpOut:
    return OpOut(id=op.id, document_number=op.document_number, op_type=op.op_type.value,
                 stock_movement_id=op.stock_movement_id)


def _conflict(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT,
                        {"code": "manufacturing_invalid", "message": str(exc)})


@router.post("/consume", response_model=OpOut, status_code=status.HTTP_201_CREATED)
def consume(
    body: ManufactureOp,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OpOut:
    try:
        op = manufacturing_service.consume(
            db, item_id=body.item_id, location_kind=body.location.location_kind,
            location_id=body.location.location_id, quantity=body.quantity, actor_user_id=current.id)
    except (ManufacturingError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "manufacturing_invalid", "message": str(exc)})
    db.commit()
    return _out(op)


@router.post("/produce", response_model=OpOut, status_code=status.HTTP_201_CREATED)
def produce(
    body: ManufactureOp,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OpOut:
    try:
        op = manufacturing_service.produce(
            db, item_id=body.item_id, location_kind=body.location.location_kind,
            location_id=body.location.location_id, quantity=body.quantity, actor_user_id=current.id)
    except (ManufacturingError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "manufacturing_invalid", "message": str(exc)})
    db.commit()
    return _out(op)


@router.post("/{op_id}/reverse", response_model=OpOut, status_code=status.HTTP_201_CREATED)
def reverse(
    op_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OpOut:
    try:
        op = manufacturing_service.reverse_op(db, op_id=op_id, actor_user_id=current.id)
    except (ManufacturingError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "manufacturing_conflict", "message": str(exc)})
    db.commit()
    return _out(op)


# ---------------------------------------------------------------------------
# Bill of materials (recipes) — CRUD.
# ---------------------------------------------------------------------------
class ComponentIn(BaseModel):
    item_id: int
    quantity: Decimal
    # The unit the quantity is written in; omit for the item's base unit (008).
    unit: str | None = None
    # `production` | `quality` — إمتى الخامة دي بتتصرف. الشرح في `models/bom.py`.
    stage: str | None = None


class ResourceIn(BaseModel):
    kind: str  # labor | machine | overhead | other
    name: str
    quantity: Decimal
    rate: Decimal


class BomIn(BaseModel):
    product_id: int
    name: str
    output_quantity: Decimal = Decimal("1")
    components: list[ComponentIn]
    resources: list[ResourceIn] = []


class BomUpdate(BaseModel):
    name: str
    output_quantity: Decimal
    components: list[ComponentIn]
    resources: list[ResourceIn] = []


class ComponentOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit: str | None = None
    unit_factor: Decimal = Decimal("1")
    stage: str = "production"


class ResourceOut(BaseModel):
    kind: str
    name: str
    quantity: Decimal
    rate: Decimal


class BomOut(BaseModel):
    id: int
    product_id: int
    name: str
    output_quantity: Decimal
    active: bool
    components: list[ComponentOut]
    resources: list[ResourceOut]


def _bom_out(bom) -> BomOut:
    return BomOut(
        id=bom.id, product_id=bom.product_id, name=bom.name,
        output_quantity=bom.output_quantity, active=bom.active,
        components=[ComponentOut(
            item_id=c.item_id, quantity=c.quantity, unit=getattr(c, "unit", None),
            unit_factor=getattr(c, "unit_factor", None) or Decimal("1"),
            stage=getattr(c, "stage", None) or "production",
        ) for c in bom.components],
        resources=[ResourceOut(kind=r.kind.value, name=r.name, quantity=r.quantity, rate=r.rate)
                   for r in bom.resources],
    )


@router.get("/boms", response_model=list[BomOut])
def list_boms(
    product_id: int | None = None,
    active_only: bool = False,
    _: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> list[BomOut]:
    return [_bom_out(b) for b in
            manufacturing_service.list_boms(db, product_id=product_id, active_only=active_only)]


@router.get("/boms/{bom_id}", response_model=BomOut)
def get_bom(
    bom_id: int,
    _: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> BomOut:
    bom = manufacturing_service.get_bom(db, bom_id)
    if bom is None:
        raise HTTPException(404, {"code": "not_found", "message": "Recipe not found"})
    return _bom_out(bom)


@router.post("/boms", response_model=BomOut, status_code=status.HTTP_201_CREATED)
def create_bom(
    body: BomIn,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> BomOut:
    try:
        bom = manufacturing_service.create_bom(
            db, product_id=body.product_id, name=body.name, output_quantity=body.output_quantity,
            components=[(c.item_id, c.quantity, c.unit, c.stage) for c in body.components],
            resources=[(r.kind, r.name, r.quantity, r.rate) for r in body.resources],
            actor_user_id=current.id)
    except ManufacturingError as exc:
        raise _conflict(exc)
    db.commit()
    return _bom_out(bom)


@router.put("/boms/{bom_id}", response_model=BomOut)
def update_bom(
    bom_id: int,
    body: BomUpdate,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> BomOut:
    try:
        bom = manufacturing_service.update_bom(
            db, bom_id=bom_id, name=body.name, output_quantity=body.output_quantity,
            components=[(c.item_id, c.quantity, c.unit, c.stage) for c in body.components],
            resources=[(r.kind, r.name, r.quantity, r.rate) for r in body.resources],
            actor_user_id=current.id)
    except ManufacturingError as exc:
        raise _conflict(exc)
    db.commit()
    # **الرد بيتقرا من القاعدة تاني.** التعديل بيمسح السطور ويكتب غيرها، والـsession
    # لسه ماسك القايمة القديمة — فالرد كان بيرجّع الوصفة **قبل** التعديل، والشاشة
    # اللي بتصدّقه بتفضل وراها خطوة. أول حاجة بانت منه: المرحلة اتحفظت `quality` في
    # القاعدة والرد قال `production`.
    db.refresh(bom)
    return _bom_out(bom)


@router.delete("/boms/{bom_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_bom(
    bom_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        manufacturing_service.deactivate_bom(db, bom_id=bom_id, actor_user_id=current.id)
    except ManufacturingError as exc:
        raise _conflict(exc)
    db.commit()


# ---------------------------------------------------------------------------
# Manufacturing orders — recipe-driven consume + produce.
# ---------------------------------------------------------------------------
class OrderResourceIn(BaseModel):
    kind: str
    name: str
    quantity: Decimal
    rate: Decimal


class OrderWasteIn(BaseModel):
    item_id: int
    quantity: Decimal


class OrderComponentIn(BaseModel):
    item_id: int
    quantity: Decimal


class OrderIn(BaseModel):
    product_id: int
    quantity: Decimal
    location: LocationIn
    bom_id: int | None = None
    # (031) انتاج حر — production that happened without a stored recipe, so the components are
    # stated rather than derived. Omit for a recipe-driven order; the two are the same document.
    components: list[OrderComponentIn] | None = None
    resources: list[OrderResourceIn] | None = None  # override recipe resources; omit = use recipe
    wastes: list[OrderWasteIn] = []                  # per-component waste recorded on the order
    # Document fields: the day production happened (defaults to today), the branch, the shop-floor
    # work order («امر تشغيل») and notes.
    production_date: date | None = None
    branch_id: int | None = None
    work_order_ref: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=500)


class OrderConsumptionOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit_cost: Decimal
    line_cost: Decimal
    waste_quantity: Decimal
    warehouse_id: int | None


class OrderResourceOut(BaseModel):
    kind: str
    name: str
    quantity: Decimal
    rate: Decimal
    cost: Decimal


class OrderOut(BaseModel):
    id: int
    document_number: str
    product_id: int
    bom_id: int | None
    quantity: Decimal
    unit_cost: Decimal
    total_cost: Decimal
    material_cost: Decimal
    resource_cost: Decimal
    reversed: bool
    is_reversal: bool
    production_date: date | None = None
    branch_id: int | None = None
    work_order_ref: str | None = None
    notes: str | None = None
    consumptions: list[OrderConsumptionOut]
    resources: list[OrderResourceOut]


def _reversed_ids(db: Session) -> set[int]:
    from sqlalchemy import select

    from src.models.manufacturing import ManufacturingOrder
    return {
        r for (r,) in db.execute(
            select(ManufacturingOrder.reverses_order_id).where(
                ManufacturingOrder.reverses_order_id.is_not(None))
        ).all()
    }


def _order_out(order, reversed_ids: set[int]) -> OrderOut:
    return OrderOut(
        id=order.id, document_number=order.document_number, product_id=order.product_id,
        bom_id=order.bom_id, quantity=order.quantity, unit_cost=order.unit_cost,
        total_cost=order.total_cost, material_cost=order.material_cost,
        resource_cost=order.resource_cost, reversed=order.id in reversed_ids,
        is_reversal=order.reverses_order_id is not None,
        production_date=getattr(order, "production_date", None),
        branch_id=getattr(order, "branch_id", None),
        work_order_ref=getattr(order, "work_order_ref", None),
        notes=getattr(order, "notes", None),
        consumptions=[OrderConsumptionOut(item_id=c.item_id, quantity=c.quantity,
                                          unit_cost=c.unit_cost, line_cost=c.line_cost,
                                          waste_quantity=c.waste_quantity, warehouse_id=c.warehouse_id)
                      for c in order.consumptions],
        resources=[OrderResourceOut(kind=r.kind, name=r.name, quantity=r.quantity, rate=r.rate,
                                    cost=r.cost) for r in order.resources],
    )


@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> list[OrderOut]:
    reversed_ids = _reversed_ids(db)
    # نفس عزل أوامر التشغيل — `ManufacturingOrder` عنده `branch_id` هو كمان.
    orders = branch_scope.visible(current, manufacturing_service.list_orders(db))
    return [_order_out(o, reversed_ids) for o in orders]


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> OrderOut:
    order = manufacturing_service.get_order(db, order_id)
    # ٤٠٤ مش ٤٠٣ للّي مش من فرعه — الشرح عند `_seen_po`.
    if order is None or not branch_scope.may_see(current, order):
        raise HTTPException(404, {"code": "not_found", "message": "Manufacturing order not found"})
    return _order_out(order, _reversed_ids(db))


@router.post("/orders", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderIn,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OrderOut:
    try:
        order = manufacturing_service.create_order(
            db, product_id=body.product_id, quantity=body.quantity,
            location_kind=body.location.location_kind, location_id=body.location.location_id,
            bom_id=body.bom_id, actor_user_id=current.id,
            components=([(c.item_id, c.quantity) for c in body.components]
                        if body.components is not None else None),
            resources=([(r.kind, r.name, r.quantity, r.rate) for r in body.resources]
                       if body.resources is not None else None),
            wastes={w.item_id: w.quantity for w in body.wastes},
            production_date=body.production_date, branch_id=body.branch_id,
            work_order_ref=body.work_order_ref, notes=body.notes)
    except (ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _order_out(order, _reversed_ids(db))


@router.post("/orders/{order_id}/reverse", response_model=OrderOut,
             status_code=status.HTTP_201_CREATED)
def reverse_order(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> OrderOut:
    try:
        order = manufacturing_service.reverse_order(db, order_id=order_id, actor_user_id=current.id)
    except (ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _order_out(order, _reversed_ids(db))


# ---------------------------------------------------------------------------
# أوامر الشغل المنقولة من a5 — قراءة فقط.
# ---------------------------------------------------------------------------
# الشرح في `manufacturing_service.list_work_orders`: ٤٬٣٨٩ سطر تصنيع منقولين ومش باينين
# في ولا شاشة، لأن تبويب الأوامر بيقرا `ManufacturingOrder` وحده. النقطة دي بتوريهم في
# شكلهم الأصلي — مستند بسطور منتجات وسطور خامات — من غير ما تكتب صف.
class WorkOrderLineOut(BaseModel):
    op_id: int
    document_number: str
    item_id: int
    code: str
    name: str
    unit: str
    quantity: str
    warehouse_id: int
    warehouse: str
    is_reversal: bool


class WorkOrderOut(BaseModel):
    ref: str
    date: str | None
    branch_id: int | None
    product_quantity: str
    material_quantity: str
    products: list[WorkOrderLineOut]
    materials: list[WorkOrderLineOut]


@router.get("/work-orders")
def list_work_orders(
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int | None = None,
    offset: int = 0,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
):
    rows = manufacturing_service.list_work_orders(
        db, search=search, date_from=date_from, date_to=date_to)
    # **صفوف قواميس مش كائنات** — و`branch_scope.may_see` بيقرا بـ`getattr`، فبيرجّع
    # `None` على كل قاموس ويعدّيه. نفس القاعدة متكتوبة هنا على المفتاح.
    mine = branch_scope.visible_branch_id(current)
    if mine is not None:
        rows = [r for r in rows if r.get("branch_id") in (None, mine)]
    # نفس عقد الترقيم اللي باقي القوايم ماشية عليه: `limit` بيرجّع غلاف بالإجمالي،
    # ومن غيره بترجع القايمة زي ما هي عشان أي نداء قديم مايتكسرش.
    if limit is None:
        return rows
    return {"rows": rows[offset:offset + limit], "total": len(rows),
            "limit": limit, "offset": offset}




# ---------------------------------------------------------------------------
# عزل الفروع في أوامر التشغيل.
#
# **اللي كشفه.** كشف أوامر التشغيل كان بيكتب «الفرع #3» بدل «السادات»، ومدير فرع
# العلياء هو اللي شايفه: `/branches` بيرجّعله فرعه وحده (صح)، فالاسم مالقاش نفسه في
# الخريطة ووقع على الرقم. يعني الـ«#3» ماكانش عيب عرض — كان **أوامر تشغيل المصنع
# ظاهرة لمدير فرع تاني**، والرقم هو اللي فضحها. إصلاح اللافتة وحدها كان هيخفيها.
#
# المسارات دي كانت بتاخد `CurrentUser` وبترميه (`_`)، فمافيش ولا شرط فرع على القايمة
# ولا على فتح أمر بالرقم — والرابط المباشر بيبقى باب خلفي حوالين أي فلترة.
#
# ومدير النظام (`branch_id = None`) بيفضل شايف الكل زي ما هو، والأوامر القديمة اللي
# `branch_id` بتاعها NULL بتفضل ظاهرة للكل — نفس قاعدة `branch_scope` في كل حتة تانية.
def _own_branch(current: CurrentUser, branch_id: int | None) -> int | None:
    """فرع الأمر الجديد. **اللي محبوس في فرع بيكتب في فرعه وبس.**

    `branch_id` بييجي من الطلب، فمن غير الشرط ده مدير فرع يقدر يكتب أمر تشغيل على
    المصنع ومايشوفوش بعدها — بيختفي من كشفه وبيظهر في كشف حد تاني.

    ومدير النظام بيعدّي زي ما هو: هو اللي بيتنقّل بين الفروع أصلاً.
    """
    mine = branch_scope.visible_branch_id(current)
    if mine is None:
        return branch_id
    if branch_id is not None and branch_id != mine:
        raise HTTPException(403, {"code": "forbidden", "message": "مش فرعك."})
    return mine


def _seen_po(db: Session, order_id: int, current: CurrentUser):
    """بيجيب أمر التشغيل لو الشخص ده يشوفه — و**٤٠٤ لو لأ، مش ٤٠٣**.

    ٤٠٣ بيقول «موجود بس مش من حقك»، ودي في حد ذاتها معلومة عن فرع تاني: بتخلّي
    الترقيم قابل للعدّ من بره. ٤٠٤ بيرد نفس رد الأمر اللي مش موجود أصلاً.
    """
    order = production_order_service.get_order(db, order_id)
    if order is None or not branch_scope.may_see(current, order):
        raise HTTPException(404, {"code": "not_found", "message": "أمر التشغيل مش موجود"})
    return order


# ---------------------------------------------------------------------------
# أوامر التشغيل (032) — كذا منتج وكذا خامة في ورقة واحدة، بحالات صريحة.
# ---------------------------------------------------------------------------
class POMaterialIn(BaseModel):
    item_id: int
    # مرحلة الصرف، بتتنسخ من الوصفة. الشرح في `models/bom.py`.
    stage: str | None = None
    # اختيارية زي المنتج: الورقة بتتفتح على خطة، والمصروف بيتفتح عليها.
    quantity: Decimal | None = None                  # اللي اتصرف فعلاً
    planned_quantity: Decimal | None = None          # المفروض؛ من غيره = نفس المصروف
    warehouse_id: int | None = None
    unit: str | None = None
    waste_quantity: Decimal = Decimal("0")


class POProductIn(BaseModel):
    item_id: int
    # **الكمية اللي طلعت اختيارية وقت الفتح.** الورقة بتتفتح على خطة؛ اللي طلع فعلاً
    # مايتعرفش غير بعد ما الشغل يخلص، وبيتكتب عند الإقفال (`/execute`). ومن غيرها
    # بتتفتح على المخطّط — عشان اللي بيسجّل تشغيلة خلصت خلاص مايكتبش نفس الرقم مرتين.
    quantity: Decimal | None = None
    planned_quantity: Decimal | None = None
    warehouse_id: int | None = None
    unit: str | None = None
    bom_id: int | None = None
    expense_amount: Decimal = Decimal("0")
    # الخامات جوّه المنتج مش قايمة لوحدها: كده مستحيل يتبعت سطر خامة مش منسوب لمنتج،
    # وتكلفة المنتج تفضل محسوبة من غير تخمين. القايمة الفاضية = اعمل الوصفة زي ما هي.
    materials: list[POMaterialIn] = []


class POIn(BaseModel):
    products: list[POProductIn]
    production_date: date | None = None
    branch_id: int | None = None
    external_document_number: str | None = Field(default=None, max_length=40)
    statement1: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=500)
    reviewed: bool = False
    # ترحيل فوري لواحد بيسجّل شغل خلص؛ من غيرها الأمر بيتفتح مسودة ومافيش حركة مخزون.
    execute: bool = False


class POMaterialOut(BaseModel):
    id: int
    product_line_id: int | None
    stage: str = "production"
    # **اتصرف ولا لأ.** الشاشة بتعرف الخطوة الجاية من السطور الباقية، مش من حالة
    # الأمر — الشرح في `manufacturing_production_service.pending`.
    issued: bool = False
    item_id: int
    warehouse_id: int | None
    planned_quantity: Decimal
    quantity: Decimal
    unit: str | None
    unit_cost: Decimal
    line_cost: Decimal
    waste_quantity: Decimal


class POReceiptOut(BaseModel):
    id: int
    product_line_id: int
    quantity: Decimal
    receipt_date: date | None = None
    notes: str | None = None


class POProductOut(BaseModel):
    id: int
    received_quantity: Decimal = Decimal("0")
    item_id: int
    warehouse_id: int | None
    planned_quantity: Decimal
    quantity: Decimal
    unit: str | None
    bom_id: int | None
    material_cost: Decimal
    expense_amount: Decimal
    total_cost: Decimal
    unit_cost: Decimal


class POOut(BaseModel):
    id: int
    document_number: str
    production_date: date | None
    branch_id: int | None
    external_document_number: str | None
    statement1: str | None
    notes: str | None
    state: str
    reviewed: bool
    material_cost: Decimal
    expense_amount: Decimal
    total_cost: Decimal
    planned_quantity: Decimal
    product_quantity: Decimal
    material_quantity: Decimal
    imported_from: str | None
    reversed: bool
    is_reversal: bool
    products: list[POProductOut]
    materials: list[POMaterialOut]
    # دفعات الاستلام — الشاشة بتوري منها «اتستلم كام وإمتى» جنب المخطّط.
    receipts: list[POReceiptOut] = []


def _po_out(o, rev_ids: set[int]) -> POOut:
    return POOut(
        id=o.id, document_number=o.document_number, production_date=o.production_date,
        branch_id=o.branch_id, external_document_number=o.external_document_number,
        statement1=o.statement1, notes=o.notes, state=o.state.value, reviewed=o.reviewed,
        material_cost=o.material_cost, expense_amount=o.expense_amount,
        total_cost=o.total_cost, planned_quantity=o.planned_quantity,
        product_quantity=o.product_quantity, material_quantity=o.material_quantity,
        imported_from=o.imported_from,
        reversed=o.id in rev_ids, is_reversal=o.reverses_id is not None,
        products=[POProductOut(
            id=p.id, item_id=p.item_id, warehouse_id=p.warehouse_id,
            planned_quantity=p.planned_quantity, quantity=p.quantity,
            unit=p.unit, bom_id=p.bom_id, material_cost=p.material_cost,
            expense_amount=p.expense_amount, total_cost=p.total_cost, unit_cost=p.unit_cost,
            received_quantity=p.received_quantity)
            for p in o.products],
        receipts=[POReceiptOut(
            id=r.id, product_line_id=r.product_line_id, quantity=r.quantity,
            receipt_date=r.receipt_date, notes=r.notes)
            for r in sorted(o.receipts, key=lambda r: r.id)],
        materials=[POMaterialOut(
            id=m.id, product_line_id=m.product_line_id, item_id=m.item_id,
            warehouse_id=m.warehouse_id, planned_quantity=m.planned_quantity,
            quantity=m.quantity, unit=m.unit, unit_cost=m.unit_cost,
            line_cost=m.line_cost, waste_quantity=m.waste_quantity,
            stage=(m.stage or "production"), issued=m.stock_movement_id is not None)
            for m in o.materials],
    )


def _po_products(body: POIn):
    return [{
        "item_id": p.item_id, "quantity": p.quantity,
        "planned_quantity": p.planned_quantity,
        "warehouse_id": p.warehouse_id, "unit": p.unit, "bom_id": p.bom_id,
        "expense_amount": p.expense_amount,
        "materials": [{
            "item_id": m.item_id, "quantity": m.quantity,
            "planned_quantity": m.planned_quantity,
            "warehouse_id": m.warehouse_id, "unit": m.unit,
            "waste_quantity": m.waste_quantity,
        } for m in p.materials],
    } for p in body.products]


@router.get("/production-orders")
def list_production_orders(
    search: str | None = None,
    branch_id: int | None = None,
    state: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    imported: bool | None = None,
    limit: int | None = None,
    offset: int = 0,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
):
    orders = production_order_service.list_orders(
        db, search=search, branch_id=branch_id, state=state, date_from=date_from,
        date_to=date_to, imported=imported)
    # **الفلترة بعد الخدمة مش جوّاها.** `list_orders` بتاخد `branch_id` كفلتر بيبعته
    # المستخدم، واللي بيختار الفرع بإيده يقدر يختار فرع غيره. العزل شرط تاني فوقه.
    orders = branch_scope.visible(current, orders)
    rev_ids = production_order_service.reversed_ids(db)
    # نفس عقد الترقيم اللي باقي القوايم ماشية عليه: `limit` بيرجّع غلاف بالإجمالي،
    # ومن غيره بترجع القايمة زي ما هي.
    if limit is None:
        return [_po_out(o, rev_ids) for o in orders]
    return {"rows": [_po_out(o, rev_ids) for o in orders[offset:offset + limit]],
            "total": len(orders), "limit": limit, "offset": offset}


@router.get("/production-orders/{order_id}", response_model=POOut)
def get_production_order(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> POOut:
    order = _seen_po(db, order_id, current)
    return _po_out(order, production_order_service.reversed_ids(db))


@router.post("/production-orders", response_model=POOut, status_code=status.HTTP_201_CREATED)
def create_production_order(
    body: POIn,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    try:
        order = production_order_service.create_order(
            db, products=_po_products(body), actor_user_id=current.id,
            production_date=body.production_date,
            branch_id=_own_branch(current, body.branch_id),
            external_document_number=body.external_document_number,
            statement1=body.statement1, notes=body.notes, reviewed=body.reviewed,
            execute=body.execute)
    except (ProductionOrderError, ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


@router.put("/production-orders/{order_id}", response_model=POOut)
def update_production_order(
    order_id: int,
    body: POIn,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.update_order(
            db, order_id=order_id, products=_po_products(body), actor_user_id=current.id,
            production_date=body.production_date,
            branch_id=_own_branch(current, body.branch_id),
            external_document_number=body.external_document_number,
            statement1=body.statement1, notes=body.notes, reviewed=body.reviewed)
    except (ProductionOrderError, ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


@router.post("/production-orders/{order_id}/confirm", response_model=POOut)
def confirm_production_order(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.confirm_order(
            db, order_id=order_id, actor_user_id=current.id)
    except ProductionOrderError as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


@router.post("/production-orders/{order_id}/start", response_model=POOut)
def start_production_order(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    """مؤكد ← شغّال: **بيصرف الخامات**. الشرح في `start_order`.

    و`StockError` بتتمسك هنا زي التلات نداءات التانية. كانت ناقصة، والبدء بقى بيصرف
    خامات بعد ما كان مابيحركش حاجة — فخامة مش كفاية كانت بتطلع **500** بدل ٤٠٩،
    واللي قدام الشاشة بيقرا «حصل خطأ» بدل «الرصيد مايكفيش: «خام قطع صرف» في مخزن
    الخامات المتاح منه ٠ والمطلوب صرفه ٦٦». الرسالة دي مكتوبة وكانت بتترمي.
    """
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.start_order(
            db, order_id=order_id, actor_user_id=current.id)
    except (ProductionOrderError, ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


class POOutputIn(BaseModel):
    """اللي حصل فعلاً — بيتبعت وقت الإقفال.

    `outputs` كمية كل منتج طلعت كام، و`waste` هالك كل خامة. الاتنين مابيتعرفوش وقت
    الفتح، والورقة بتتقفل عليهم.
    """

    outputs: dict[int, Decimal] = {}
    waste: dict[int, Decimal] = {}


@router.post("/production-orders/{order_id}/issue-quality", response_model=POOut)
def issue_quality_materials(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    """**إذن خامات الجودة** — الكرتون والأكياس بعد ما المنتج يطلع.

    خطوة لوحدها لأن الورقتين بيروحوا لناس مختلفين في وقتين مختلفين. الشرح الكامل
    في `manufacturing_production_service.issue_quality`.
    """
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.issue_quality(
            db, order_id=order_id, actor_user_id=current.id)
    except (ProductionOrderError, ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


class POReceiveIn(BaseModel):
    """دفعة استلام: كمية لكل سطر منتج، وتاريخ الاستلام."""

    quantities: dict[int, Decimal] = {}
    receipt_date: date | None = None
    notes: str | None = Field(default=None, max_length=200)


@router.post("/production-orders/{order_id}/receive", response_model=POOut)
def receive_production_output(
    order_id: int,
    body: POReceiveIn,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    """**استلام دفعة إنتاج** — البضاعة بتدخل المخزن دلوقتي والأمر بيفضل شغّال.

    الشرح الكامل في `manufacturing_production_service.receive_output`.
    """
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.receive_output(
            db, order_id=order_id, actor_user_id=current.id,
            rows=body.quantities, receipt_date=body.receipt_date, notes=body.notes)
    except (ProductionOrderError, ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


@router.delete("/production-orders/{order_id}/receipts/{receipt_id}",
               response_model=POOut)
def undo_production_receipt(
    order_id: int,
    receipt_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    """عكس دفعة استلام غلط. الشرح في `production_order_service.undo_receipt`."""
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.undo_receipt(
            db, order_id=order_id, receipt_id=receipt_id, actor_user_id=current.id)
    except (ProductionOrderError, ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


@router.post("/production-orders/{order_id}/execute", response_model=POOut)
def execute_production_order(
    order_id: int,
    body: POOutputIn | None = None,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.execute_order(
            db, order_id=order_id, actor_user_id=current.id,
            outputs=(body.outputs if body else None),
            waste=(body.waste if body else None))
    except (ProductionOrderError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


@router.post("/production-orders/{order_id}/reverse", response_model=POOut,
             status_code=status.HTTP_201_CREATED)
def reverse_production_order(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> POOut:
    _seen_po(db, order_id, current)
    try:
        order = production_order_service.reverse_order(
            db, order_id=order_id, actor_user_id=current.id)
    except (ProductionOrderError, ManufacturingError, StockError) as exc:
        raise _conflict(exc)
    db.commit()
    return _po_out(order, production_order_service.reversed_ids(db))


@router.delete("/production-orders/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_production_order(
    order_id: int,
    current: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    _seen_po(db, order_id, current)
    try:
        production_order_service.delete_draft(
            db, order_id=order_id, actor_user_id=current.id)
    except ProductionOrderError as exc:
        raise _conflict(exc)
    db.commit()
