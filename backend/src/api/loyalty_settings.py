"""Coupon-type catalog router (T019). FR-015."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LOYALTY_READ, CAP_LOYALTY_SETTINGS_WRITE
from src.core.db import get_db
from src.models.loyalty import CouponKind, CouponType

router = APIRouter(tags=["loyalty-settings"], prefix="/loyalty/coupon-types")


class CouponTypeCreate(BaseModel):
    name: str
    kind: CouponKind
    point_cost: int
    value: Decimal


class CouponTypeUpdate(BaseModel):
    name: str | None = None
    point_cost: int | None = None
    value: Decimal | None = None
    active: bool | None = None


class CouponTypeOut(BaseModel):
    id: int
    name: str
    kind: CouponKind
    point_cost: int
    value: Decimal
    active: bool


def _out(ct: CouponType) -> CouponTypeOut:
    return CouponTypeOut(id=ct.id, name=ct.name, kind=ct.kind, point_cost=ct.point_cost,
                         value=ct.value, active=ct.active)


@router.get("", response_model=list[CouponTypeOut])
def list_types(
    _: CurrentUser = Depends(require_capability(CAP_LOYALTY_READ)),
    db: Session = Depends(get_db),
) -> list[CouponTypeOut]:
    return [_out(c) for c in db.scalars(select(CouponType)).all()]


@router.post("", response_model=CouponTypeOut, status_code=status.HTTP_201_CREATED)
def create_type(
    body: CouponTypeCreate,
    _: CurrentUser = Depends(require_capability(CAP_LOYALTY_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> CouponTypeOut:
    if body.point_cost <= 0:
        raise HTTPException(422, {"code": "validation", "message": "point_cost must be > 0"})
    ct = CouponType(name=body.name, kind=body.kind, point_cost=body.point_cost, value=body.value)
    db.add(ct)
    db.flush()
    db.commit()
    return _out(ct)


@router.patch("/{type_id}", response_model=CouponTypeOut)
def update_type(
    type_id: int,
    body: CouponTypeUpdate,
    _: CurrentUser = Depends(require_capability(CAP_LOYALTY_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> CouponTypeOut:
    ct = db.get(CouponType, type_id)
    if ct is None:
        raise HTTPException(404, {"code": "not_found", "message": "Coupon type not found"})
    for field in ("name", "point_cost", "value", "active"):
        val = getattr(body, field)
        if val is not None:
            setattr(ct, field, val)
    db.flush()
    db.commit()
    return _out(ct)
