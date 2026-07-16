"""Product point-value router (T012). FR-001/002."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CATALOG_READ, CAP_PRODUCT_POINTS_WRITE
from src.core.db import get_db
from src.models.catalog import Item, ItemKind
from src.models.loyalty import ProductPointValue

router = APIRouter(tags=["product-points"], prefix="/products")


class PointValueBody(BaseModel):
    point_value: Decimal


class PointValueOut(BaseModel):
    item_id: int
    point_value: Decimal


@router.get("/{item_id}/point-value", response_model=PointValueOut)
def get_point_value(
    item_id: int,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> PointValueOut:
    ppv = db.scalar(select(ProductPointValue).where(ProductPointValue.item_id == item_id))
    val = ppv.point_value if ppv else 0
    return PointValueOut(item_id=item_id, point_value=val)


@router.put("/{item_id}/point-value", response_model=PointValueOut)
def set_point_value(
    item_id: int,
    body: PointValueBody,
    current: CurrentUser = Depends(require_capability(CAP_PRODUCT_POINTS_WRITE)),
    db: Session = Depends(get_db),
) -> PointValueOut:
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.product:
        raise HTTPException(422, {"code": "validation", "message": "Point values apply to products only"})
    if body.point_value < 0:
        raise HTTPException(422, {"code": "validation", "message": "point_value must be ≥ 0"})
    ppv = db.scalar(select(ProductPointValue).where(ProductPointValue.item_id == item_id))
    if ppv is None:
        ppv = ProductPointValue(item_id=item_id, point_value=body.point_value, updated_by=current.id)
        db.add(ppv)
    else:
        ppv.point_value = body.point_value
        ppv.updated_by = current.id
    db.flush()
    db.commit()
    return PointValueOut(item_id=item_id, point_value=ppv.point_value)
