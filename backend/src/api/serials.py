"""السرايل و حركات سرايل — the two serial screens their menu lists — 031-a5-restructure.

Serials were reachable only one item at a time (`/items/{id}/serials`), which answers «what units
of THIS item exist» and never «where is serial 4471-B?» — the question somebody actually has, from
a customer holding a unit and a name for it and nothing else.

Two registers, both read-only. Serials are created and moved by the documents that handle the
goods; a screen that let somebody edit one directly would put the serial and the stock quantity out
of step, which is the invariant the integrity check exists to defend.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_STOCK_READ
from src.core.db import get_db
from src.models.catalog import Item, ItemSerial, ItemSerialMovement, SerialStatus
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


def _place(kind, loc_id, warehouses) -> str | None:
    """Only a warehouse has a name to give; a custody is a person's van, named by its rep."""
    if kind is None or loc_id is None:
        return None
    if kind == LocationKind.warehouse:
        return warehouses.get(loc_id)
    return f"عهدة #{loc_id}"


@router.get("", response_model=list[SerialRow])
def list_serials(
    item_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    warehouse_id: int | None = None,
    q: str | None = Query(default=None, description="serial, exact or partial"),
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[SerialRow]:
    """Every registered serial across every item, with where it is and what sold it."""
    stmt = select(ItemSerial)
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
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[MovementRow]:
    """Where each serial has been and on which document, newest first.

    Filtering by `serial` rather than by id on purpose: somebody chasing a unit has the number
    printed on it, not our row id — and the number still resolves after the serial row itself has
    been removed from a mis-keyed receipt.
    """
    stmt = select(ItemSerialMovement)
    if serial:
        stmt = stmt.where(ItemSerialMovement.serial == serial)
    if item_id is not None:
        stmt = stmt.where(ItemSerialMovement.item_id == item_id)
    if kind:
        stmt = stmt.where(ItemSerialMovement.kind == kind)

    items, warehouses = _names(db)
    rows = db.scalars(stmt.order_by(ItemSerialMovement.id.desc()).limit(1000)).all()
    return [
        MovementRow(
            id=m.id, serial_id=m.serial_id, item_id=m.item_id, item_name=items.get(m.item_id),
            serial=m.serial, kind=m.kind.value,
            location_kind=m.location_kind.value if m.location_kind else None,
            location_id=m.location_id,
            location_name=_place(m.location_kind, m.location_id, warehouses),
            document_type=m.document_type, document_id=m.document_id,
            created_at=str(m.created_at),
        )
        for m in rows
    ]
