"""Points router (T024): derived balance + conversion. FR-007."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LOYALTY_READ, CAP_POINTS_CONVERT
from src.core.db import get_db
from src.services import point_service
from src.services.point_service import PointError

router = APIRouter(tags=["points"], prefix="/customers")


class PointBalanceOut(BaseModel):
    customer_id: int
    balance: int
    derived: bool = True


class ConvertRequest(BaseModel):
    coupon_type_ids: list[int]


class CouponOut(BaseModel):
    id: int
    serial: str
    customer_id: int
    kind: str
    value: str
    points_consumed: int
    status: str


@router.get("/{customer_id}/points", response_model=PointBalanceOut)
def get_balance(
    customer_id: int,
    _: CurrentUser = Depends(require_capability(CAP_LOYALTY_READ)),
    db: Session = Depends(get_db),
) -> PointBalanceOut:
    return PointBalanceOut(customer_id=customer_id, balance=point_service.balance(db, customer_id))


@router.post("/{customer_id}/points/convert", response_model=list[CouponOut],
             status_code=status.HTTP_201_CREATED)
def convert(
    customer_id: int,
    body: ConvertRequest,
    current: CurrentUser = Depends(require_capability(CAP_POINTS_CONVERT)),
    db: Session = Depends(get_db),
) -> list[CouponOut]:
    try:
        coupons = point_service.convert(
            db, customer_id=customer_id, coupon_type_ids=body.coupon_type_ids,
            actor_user_id=current.id)
    except PointError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "convert_invalid", "message": str(exc)})
    db.commit()
    return [
        CouponOut(id=c.id, serial=c.serial, customer_id=c.customer_id, kind=c.kind.value,
                  value=str(c.value), points_consumed=c.points_consumed, status=c.status.value)
        for c in coupons
    ]
