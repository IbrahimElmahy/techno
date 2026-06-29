"""Coupons router (T030/T034): list, redeem (mode dispatch), reverse. FR-011–014."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_COUPON_REDEEM, CAP_COUPON_REVERSE, CAP_LOYALTY_READ
from src.core.db import get_db
from src.models.loyalty import Coupon, CouponStatus, RedemptionMode
from src.models.stock import LocationKind
from src.services import coupon_service
from src.services.coupon_service import CouponError
from src.services.stock_service import StockError

router = APIRouter(tags=["coupons"], prefix="/coupons")


class CouponOut(BaseModel):
    id: int
    serial: str
    customer_id: int
    kind: str
    value: str
    points_consumed: int
    status: str


class RedeemRequest(BaseModel):
    mode: RedemptionMode
    sales_invoice_id: int | None = None
    item_id: int | None = None
    location_kind: LocationKind | None = None
    location_id: int | None = None
    quantity: Decimal | None = None


class RedemptionOut(BaseModel):
    id: int
    coupon_id: int
    mode: str
    value: str
    ledger_entry_id: int | None = None
    stock_movement_id: int | None = None
    coupon_status: str


def _c_out(c: Coupon) -> CouponOut:
    return CouponOut(id=c.id, serial=c.serial, customer_id=c.customer_id, kind=c.kind.value,
                     value=str(c.value), points_consumed=c.points_consumed, status=c.status.value)


@router.get("", response_model=list[CouponOut])
def list_coupons(
    customer_id: int | None = None,
    status_filter: CouponStatus | None = None,
    _: CurrentUser = Depends(require_capability(CAP_LOYALTY_READ)),
    db: Session = Depends(get_db),
) -> list[CouponOut]:
    stmt = select(Coupon)
    if customer_id is not None:
        stmt = stmt.where(Coupon.customer_id == customer_id)
    if status_filter is not None:
        stmt = stmt.where(Coupon.status == status_filter)
    return [_c_out(c) for c in db.scalars(stmt).all()]


@router.post("/{coupon_id}/redeem", response_model=RedemptionOut, status_code=status.HTTP_201_CREATED)
def redeem(
    coupon_id: int,
    body: RedeemRequest,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_REDEEM)),
    db: Session = Depends(get_db),
) -> RedemptionOut:
    coupon = db.get(Coupon, coupon_id)
    if coupon is None:
        raise HTTPException(404, {"code": "not_found", "message": "Coupon not found"})
    try:
        if body.mode == RedemptionMode.money:
            red = coupon_service.redeem_money(
                db, coupon=coupon, sales_invoice_id=body.sales_invoice_id, actor_user_id=current.id)
        elif body.mode == RedemptionMode.gift_money_off:
            red = coupon_service.redeem_gift_money_off(
                db, coupon=coupon, sales_invoice_id=body.sales_invoice_id, actor_user_id=current.id)
        else:  # gift_product
            if body.item_id is None or body.location_kind is None or body.location_id is None or body.quantity is None:
                raise CouponError("gift_product requires item_id, location, and quantity.")
            red = coupon_service.redeem_gift_product(
                db, coupon=coupon, item_id=body.item_id, location_kind=body.location_kind,
                location_id=body.location_id, quantity=body.quantity,
                sales_invoice_id=body.sales_invoice_id, actor_user_id=current.id)
    except (CouponError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "redeem_invalid", "message": str(exc)})
    db.commit()
    return RedemptionOut(id=red.id, coupon_id=coupon.id, mode=red.mode.value, value=str(red.value),
                         ledger_entry_id=red.ledger_entry_id, stock_movement_id=red.stock_movement_id,
                         coupon_status=coupon.status.value)


@router.post("/{coupon_id}/redemption/reverse", response_model=RedemptionOut,
             status_code=status.HTTP_201_CREATED)
def reverse_redemption(
    coupon_id: int,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_REVERSE)),
    db: Session = Depends(get_db),
) -> RedemptionOut:
    coupon = db.get(Coupon, coupon_id)
    if coupon is None:
        raise HTTPException(404, {"code": "not_found", "message": "Coupon not found"})
    try:
        rev = coupon_service.reverse_redemption(db, coupon=coupon, actor_user_id=current.id)
    except (CouponError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "reverse_invalid", "message": str(exc)})
    db.commit()
    return RedemptionOut(id=rev.id, coupon_id=coupon.id, mode=rev.mode.value, value=str(rev.value),
                         ledger_entry_id=rev.ledger_entry_id, stock_movement_id=rev.stock_movement_id,
                         coupon_status=coupon.status.value)
