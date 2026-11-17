from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_STOCK_READ
from src.core.db import get_db
from src.models.catalog import Item, ItemSerial, ItemSerialMovement, SerialStatus
from src.models.customer import Customer
from src.models.sales import SalesInvoice
from src.models.stock import LocationKind
from src.models.warehouse import Warehouse

router = APIRouter(tags=["serials"], prefix="/serials")


class SerialRow(BaseModel):
    id: int
    item_id: int
    item_name: str | None
    serial: str
    status: str
    location_kind: str | None
    location_id: int | None
    location_name: str | None
    sold_invoice_id: int | None


class MovementRow(BaseModel):
    id: int
    serial_id: int
    item_id: int
    item_name: str | None
    serial: str
    kind: str
    customer_id: int | None
    customer_name: str | None
    location_kind: str | None
    location_id: int | None
    location_name: str | None
    document_type: str | None
    document_id: int | None
    created_at: str


def _names(db: Session) -> tuple[dict[int, str], dict[int, str]]:
    items = {i.id: i.name for i in db.scalars(select(Item)).all()}
    warehouses = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}
    return items, warehouses


def _invoice_customers(db: Session, invoice_ids: set[int]) -> dict[int, tuple[int, str | None]]:
    if not invoice_ids:
        return {}
    invoices = db.scalars(
        select(SalesInvoice).where(SalesInvoice.id.in_(invoice_ids))
    ).all()
    names = {c.id: c.name for c in db.scalars(select(Customer)).all()}
    return {inv.id: (inv.customer_id, names.get(inv.customer_id)) for inv in invoices}


def _place(kind, loc_id, warehouses) -> str | None:
    if kind is None or loc_id is None:
        return None
    if kind == LocationKind.warehouse:
        return warehouses.get(loc_id)
    return f"عهدة #{loc_id}"


def _branch_places(db: Session, current: CurrentUser):
    from sqlalchemy import or_

    from src.auth import branch_scope
    from src.models.user import User
    from src.models.warehouse import Custody

    branch_id = branch_scope.visible_branch_id(current)
    if branch_id is None:
        return None
    whs = set(db.scalars(select(Warehouse.id).where(Warehouse.branch_id == branch_id)).all())
    reps = select(User.id).where(User.branch_id == branch_id)
    cus = set(db.scalars(select(Custody.id).where(or_(
        Custody.warehouse_id.in_(whs or {0}), Custody.rep_id.in_(reps)))).all())
    invs = select(SalesInvoice.id).where(SalesInvoice.branch_id == branch_id)
    return whs, cus, invs


def _in_branch(model, places, *, sold_col=None):
    from sqlalchemy import and_, or_

    whs, cus, invs = places
    conds = [
        and_(model.location_kind == LocationKind.warehouse, model.location_id.in_(whs or {0})),
        and_(model.location_kind == LocationKind.custody, model.location_id.in_(cus or {0})),
    ]
    if sold_col is not None:
        conds.append(and_(model.location_kind.is_(None), sold_col.in_(invs)))
    return or_(*conds)


@router.get("", response_model=list[SerialRow])
def list_serials(
    item_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    warehouse_id: int | None = None,
    q: str | None = Query(default=None, description="serial, exact or partial"),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[SerialRow]:
    stmt = select(ItemSerial)
    places = _branch_places(db, current)
    if places is not None:
        stmt = stmt.where(_in_branch(ItemSerial, places, sold_col=ItemSerial.sold_invoice_id))
    if item_id is not None:
        stmt = stmt.where(ItemSerial.item_id == item_id)
    if status_filter:
        stmt = stmt.where(ItemSerial.status == SerialStatus(status_filter))
    if warehouse_id is not None:
        stmt = stmt.where(
            ItemSerial.location_kind == LocationKind.warehouse,
            ItemSerial.location_id == warehouse_id,
        )
    if q:
        stmt = stmt.where(ItemSerial.serial.like(f"%{q}%"))

    items, warehouses = _names(db)
    rows = db.scalars(stmt.order_by(ItemSerial.id.desc())).all()
    return [
        SerialRow(
            id=s.id, item_id=s.item_id, item_name=items.get(s.item_id), serial=s.serial,
            status=s.status.value,
            location_kind=s.location_kind.value if s.location_kind else None,
            location_id=s.location_id,
            location_name=_place(s.location_kind, s.location_id, warehouses),
            sold_invoice_id=s.sold_invoice_id,
        )
        for s in rows
    ]


@router.get("/movements", response_model=list[MovementRow])
def list_movements(
    serial: str | None = Query(default=None, description="one unit's whole history"),
    item_id: int | None = None,
    kind: str | None = None,
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[MovementRow]:
    stmt = select(ItemSerialMovement)
    places = _branch_places(db, current)
    if places is not None:
        from sqlalchemy import and_, or_

        stmt = stmt.where(or_(
            _in_branch(ItemSerialMovement, places),
            and_(ItemSerialMovement.document_type == "sales_invoice",
                 ItemSerialMovement.document_id.in_(places[2]))))
    if serial:
        stmt = stmt.where(ItemSerialMovement.serial == serial)
    if item_id is not None:
        stmt = stmt.where(ItemSerialMovement.item_id == item_id)
    if kind:
        stmt = stmt.where(ItemSerialMovement.kind == kind)

    items, warehouses = _names(db)
    rows = db.scalars(stmt.order_by(ItemSerialMovement.id.desc()).limit(1000)).all()
    customers = _invoice_customers(db, {
        m.document_id for m in rows
        if m.document_type == "sales_invoice" and m.document_id
    })
    return [
        MovementRow(
            id=m.id, serial_id=m.serial_id, item_id=m.item_id, item_name=items.get(m.item_id),
            serial=m.serial, kind=m.kind.value,
            customer_id=customers.get(m.document_id or 0, (None, None))[0],
            customer_name=customers.get(m.document_id or 0, (None, None))[1],
            location_kind=m.location_kind.value if m.location_kind else None,
            location_id=m.location_id,
            location_name=_place(m.location_kind, m.location_id, warehouses),
            document_type=m.document_type, document_id=m.document_id,
            created_at=str(m.created_at),
        )
        for m in rows
    ]
