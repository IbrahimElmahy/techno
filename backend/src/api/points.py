"""Points router (T024): derived balance + conversion. FR-007.

وكمان الدفتر نفسه: حركة العميل الواحد برصيد جاري (تبويب «النقاط» في ملف العميل)، والكشف
العام على كل الحركات (شاشة «سجل النقاط»).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LOYALTY_READ, CAP_POINTS_CONVERT
from src.core.db import get_db
from src.services import point_service, points_service
from src.services.point_service import PointError

router = APIRouter(tags=["points"], prefix="/customers")

# راوتر تاني في نفس الملف: الكشف العام مش تحت عميل، فمايصحّش يقعد تحت `/customers`.
# مسجّل جنب `router` في `src/main.py` — لو اتنسي، الشاشة بترجع 404 وهي سليمة.
ledger_router = APIRouter(tags=["points"], prefix="/points")


class PointBalanceOut(BaseModel):
    customer_id: int
    balance: Decimal
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


# --- الدفتر ---

class PointLedgerRow(BaseModel):
    id: int
    customer_id: int
    customer_name: str | None = None
    created_at: str | None = None
    date: str | None = None
    kind: str
    kind_label: str
    delta: str
    earned: str
    spent: str
    doc_kind: str | None = None
    doc_id: int | None = None
    doc_number: str | None = None
    running: str | None = None      # الرصيد الجاري — لعميل واحد بس


class PointLedgerOut(BaseModel):
    rows: list[PointLedgerRow] = []
    count: int = 0                  # عدد الحركات كلها، مش المعروض
    opening: str = "0.000"
    earned: str = "0.000"
    spent: str = "0.000"
    net: str = "0.000"
    balance: str | None = None
    kinds: dict[str, str] = {}      # القيمة → الاسم العربي، عشان الفلتر يتبني من السيرفر


@router.get("/{customer_id}/points/ledger", response_model=PointLedgerOut)
def customer_ledger(
    customer_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    kind: list[str] | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_capability(CAP_LOYALTY_READ)),
    db: Session = Depends(get_db),
) -> PointLedgerOut:
    """حركة نقاط عميل واحد برصيد جاري — تبويب «النقاط» في ملف العميل."""
    data = points_service.ledger(
        db, customer_id=customer_id, kinds=kind, date_from=date_from, date_to=date_to,
        limit=limit, offset=offset)
    return PointLedgerOut(**data, kinds=points_service.KIND_LABELS)


@ledger_router.get("/ledger", response_model=PointLedgerOut)
def points_ledger(
    customer_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    kind: list[str] | None = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_capability(CAP_LOYALTY_READ)),
    db: Session = Depends(get_db),
) -> PointLedgerOut:
    """سجل النقاط — كل الحركات، بفلتر عميل/نوع/فترة.

    `limit` مسقوف: الدفتر فيه عشرات الآلاف من السطور بعد الترحيل الرجعي، وردّ بيحملهم
    كلهم مرة واحدة بيقفل الشاشة. الإجماليات فوق بتتحسب في القاعدة على الحركة كلها فبتفضل
    صح مهما كانت الصفحة.
    """
    data = points_service.ledger(
        db, customer_id=customer_id, kinds=kind, date_from=date_from, date_to=date_to,
        limit=limit, offset=offset)
    return PointLedgerOut(**data, kinds=points_service.KIND_LABELS)
