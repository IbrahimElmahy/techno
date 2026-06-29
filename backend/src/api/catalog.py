"""Catalog router (T008). FR-001–005. System-generated editable code; kind/price validation."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CATALOG_READ, CAP_CATALOG_WRITE
from src.core.db import get_db
from src.models.catalog import Item, ItemKind

router = APIRouter(tags=["catalog"], prefix="/items")


class ItemCreate(BaseModel):
    name: str
    kind: ItemKind
    unit_of_measure: str
    purchase_price: Decimal | None = None
    sale_price: Decimal | None = None


class ItemUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    purchase_price: Decimal | None = None
    sale_price: Decimal | None = None
    active: bool | None = None


class ItemOut(BaseModel):
    id: int
    code: str
    name: str
    kind: ItemKind
    unit_of_measure: str
    purchase_price: Decimal | None
    sale_price: Decimal | None
    active: bool


def _out(it: Item) -> ItemOut:
    return ItemOut(
        id=it.id, code=it.code, name=it.name, kind=it.kind,
        unit_of_measure=it.unit_of_measure, purchase_price=it.purchase_price,
        sale_price=it.sale_price, active=it.active,
    )


def _next_code(db: Session, kind: ItemKind) -> str:
    prefix = "RM" if kind == ItemKind.raw_material else "PR"
    n = db.scalar(select(func.count()).select_from(Item).where(Item.kind == kind)) or 0
    return f"{prefix}-{n + 1:06d}"


@router.get("", response_model=list[ItemOut])
def list_items(
    kind: ItemKind | None = None,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> list[ItemOut]:
    stmt = select(Item)
    if kind is not None:
        stmt = stmt.where(Item.kind == kind)
    return [_out(i) for i in db.scalars(stmt).all()]


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    body: ItemCreate,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> ItemOut:
    if body.kind == ItemKind.raw_material and body.sale_price is not None:
        raise HTTPException(422, {"code": "validation", "message": "raw material has no sale price"})
    if body.kind == ItemKind.product and body.purchase_price is not None:
        raise HTTPException(422, {"code": "validation", "message": "product has no purchase price"})
    item = Item(
        code=_next_code(db, body.kind),
        name=body.name,
        kind=body.kind,
        unit_of_measure=body.unit_of_measure,
        purchase_price=body.purchase_price,
        sale_price=body.sale_price,
    )
    db.add(item)
    db.flush()
    db.commit()
    return _out(item)


@router.patch("/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    body: ItemUpdate,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    # Editing reference prices never rewrites prices already snapshotted on posted documents.
    for field in ("code", "name", "purchase_price", "sale_price", "active"):
        val = getattr(body, field)
        if val is not None:
            setattr(item, field, val)
    db.flush()
    db.commit()
    return _out(item)
