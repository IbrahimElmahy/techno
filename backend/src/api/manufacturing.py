"""Manufacturing router (T030, extended by 012-manufacturing-bom).

Two layers: manual consume/produce ops (kept) + recipe-driven manufacturing orders with BOM CRUD.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_MANUFACTURE_READ, CAP_MANUFACTURE_WRITE
from src.core.db import get_db
from src.models.stock import LocationKind
from src.services import manufacturing_service
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
        components=[ComponentOut(item_id=c.item_id, quantity=c.quantity) for c in bom.components],
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
            components=[(c.item_id, c.quantity) for c in body.components],
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
            components=[(c.item_id, c.quantity) for c in body.components],
            resources=[(r.kind, r.name, r.quantity, r.rate) for r in body.resources],
            actor_user_id=current.id)
    except ManufacturingError as exc:
        raise _conflict(exc)
    db.commit()
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


class OrderIn(BaseModel):
    product_id: int
    quantity: Decimal
    location: LocationIn
    bom_id: int | None = None
    resources: list[OrderResourceIn] | None = None  # override recipe resources; omit = use recipe
    wastes: list[OrderWasteIn] = []                  # per-component waste recorded on the order


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
        consumptions=[OrderConsumptionOut(item_id=c.item_id, quantity=c.quantity,
                                          unit_cost=c.unit_cost, line_cost=c.line_cost,
                                          waste_quantity=c.waste_quantity, warehouse_id=c.warehouse_id)
                      for c in order.consumptions],
        resources=[OrderResourceOut(kind=r.kind, name=r.name, quantity=r.quantity, rate=r.rate,
                                    cost=r.cost) for r in order.resources],
    )


@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    _: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> list[OrderOut]:
    reversed_ids = _reversed_ids(db)
    return [_order_out(o, reversed_ids) for o in manufacturing_service.list_orders(db)]


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    _: CurrentUser = Depends(require_capability(CAP_MANUFACTURE_READ)),
    db: Session = Depends(get_db),
) -> OrderOut:
    order = manufacturing_service.get_order(db, order_id)
    if order is None:
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
            resources=([(r.kind, r.name, r.quantity, r.rate) for r in body.resources]
                       if body.resources is not None else None),
            wastes={w.item_id: w.quantity for w in body.wastes})
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
