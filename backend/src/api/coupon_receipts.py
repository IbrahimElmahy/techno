from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_COUPON_CUSTODY, CAP_COUPON_RECEIVE
from src.core.client_app import is_mobile_app
from src.core.db import get_db
from src.core.fast_json import model_json
from src.models.role import RoleName
from src.auth import branch_scope
from src.services import coupon_receipt_service
from src.services.coupon_receipt_service import CouponReceiptConflict, CouponReceiptError

CAP_RECEIPT_MANAGE = CAP_COUPON_CUSTODY

router = APIRouter(tags=["coupon-receipts"], prefix="/coupon-receipts")


class ReceiptIn(BaseModel):
    serials: list[str] = []
    serial_from: str | None = None
    serial_to: str | None = None
    customer_id: int | None = None
    rep_user_id: int | None = None
    received_date: date | None = None
    notes: str | None = None
    declared_kind: str | None = None
    declared_value: Decimal | None = None
    customer_type: str | None = None
    coupon_kind: str | None = None
    client_uuid: str | None = None


class ReceiptLineOut(BaseModel):
    id: int
    serial: str
    coupon_kind: str | None = None
    sales_invoice_id: int | None = None
    coupon_issue_id: int | None = None


class ReceiptOut(BaseModel):
    id: int
    document_number: str
    customer_id: int | None
    rep_user_id: int | None
    received_date: date | None
    coupon_count: int
    notes: str | None
    declared_kind: str | None = None
    declared_value: Decimal | None = None
    customer_type: str | None = None
    status: str = "approved"
    source: str | None = None
    approved_by: int | None = None
    approved_at: datetime | None = None
    reject_reason: str | None = None
    rejected_serials: list[str] = []
    actor_user_id: int | None = None
    created_at: datetime | None = None
    lines: list[ReceiptLineOut] = []


def _out(r) -> ReceiptOut:
    return ReceiptOut(
        id=r.id, document_number=r.document_number, customer_id=r.customer_id,
        rep_user_id=r.rep_user_id, received_date=r.received_date,
        coupon_count=r.coupon_count, notes=r.notes,
        declared_kind=r.declared_kind, declared_value=r.declared_value,
        customer_type=r.customer_type,
        status=coupon_receipt_service.status_of(r), source=r.source,
        approved_by=r.approved_by, approved_at=r.approved_at,
        reject_reason=r.reject_reason,
        rejected_serials=[s for s in (r.rejected_serials or "").split(",") if s],
        actor_user_id=r.actor_user_id, created_at=r.created_at,
        lines=[ReceiptLineOut(id=ln.id, serial=ln.serial,
                              coupon_kind=ln.coupon_kind,
                              sales_invoice_id=ln.sales_invoice_id,
                              coupon_issue_id=ln.coupon_issue_id) for ln in r.lines],
    )


@router.get("/check", response_model=dict)
def check_serial(
    serial: str = Query(..., description="The number written on the coupon"),
    coupon_kind: str | None = Query(
        None, description="فئة الدفتر كما ذكرها المستلم — الرقم وحده غير كافٍ"),
    _: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> dict:
    return coupon_receipt_service.check_serial(db, serial, coupon_kind)


@router.get("/issued-to/{customer_id}", response_model=list[dict])
def coupons_issued_to(
    customer_id: int,
    _: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    return coupon_receipt_service.issued_to_customer(db, customer_id)


@router.post("", response_model=ReceiptOut, status_code=status.HTTP_201_CREATED)
def create_receipt(
    body: ReceiptIn,
    request: Request,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> ReceiptOut:
    from_app = is_mobile_app(request)
    try:
        serials = list(body.serials)
        if body.serial_from or body.serial_to:
            serials.extend(coupon_receipt_service.expand_range(body.serial_from, body.serial_to))
        receipt = coupon_receipt_service.create_receipt(
            db, serials=serials, actor_user_id=current.id, customer_id=body.customer_id,
            rep_user_id=body.rep_user_id if body.rep_user_id is not None else (
                current.id if current.role == RoleName.sales_rep else None),
            received_date=body.received_date, notes=body.notes, client_uuid=body.client_uuid,
            declared_kind=body.declared_kind, declared_value=body.declared_value,
            customer_type=body.customer_type, coupon_kind=body.coupon_kind,
            pending=from_app, source="app" if from_app else "web",
        )
    except CouponReceiptError as exc:
        raise HTTPException(422, {"code": "coupon_invalid", "message": str(exc)}) from exc
    out = _out(receipt)
    db.commit()
    return out


class PaginatedReceiptsOut(BaseModel):
    rows: list[ReceiptOut]
    total: int
    limit: int
    offset: int


class CouponReceiptsSummaryOut(BaseModel):
    total_receipts: int
    total_coupons: int
    total_value: Decimal
    kind_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}


_STATUSES = ("pending", "approved", "rejected")


def _status_param(value: str | None) -> str | None:
    return value if value in _STATUSES else None


@router.get("/summary", response_model=CouponReceiptsSummaryOut)
def get_coupon_receipts_summary(
    customer_id: int | None = Query(None),
    rep_user_id: int | None = Query(None),
    q: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> CouponReceiptsSummaryOut:
    scope_rep = current.id if current.role == RoleName.sales_rep else rep_user_id
    summary = coupon_receipt_service.coupon_receipts_summary(
        db, customer_id=customer_id, rep_user_id=scope_rep, q=q,
        status=_status_param(status_filter))
    return CouponReceiptsSummaryOut(**summary)


@router.get("", response_model=None)
def list_receipts(
    response: Response,
    customer_id: int | None = Query(None),
    rep_user_id: int | None = Query(None),
    q: str | None = Query(None),
    limit: int | None = Query(None),
    offset: int = Query(0),
    status_filter: str | None = Query(None, alias="status"),
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
):
    scope_rep = current.id if current.role == RoleName.sales_rep else rep_user_id
    rows, total = coupon_receipt_service.list_receipts(
        db, customer_id=customer_id, rep_user_id=scope_rep, q=q, limit=limit, offset=offset,
        status=_status_param(status_filter))
    visible_rows = branch_scope.visible(current, rows)
    items_out = [_out(r) for r in visible_rows]
    response.headers["X-Total-Count"] = str(total)

    if limit is not None:
        page = PaginatedReceiptsOut(
            rows=items_out,
            total=total,
            limit=min(limit, 500),
            offset=offset,
        )
        return model_json(page, headers={"X-Total-Count": str(total)})
    return model_json(items_out, headers={"X-Total-Count": str(total)})


def _seen_receipt(db: Session, receipt_id: int, current: CurrentUser):
    try:
        receipt = coupon_receipt_service.get_receipt(db, receipt_id)
    except CouponReceiptError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    if not branch_scope.may_see(current, receipt):
        raise HTTPException(404, {"code": "not_found", "message": "الاستلام غير موجود."})
    return receipt


@router.get("/{receipt_id}", response_model=ReceiptOut)
def get_receipt(
    receipt_id: int,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> ReceiptOut:
    return _out(_seen_receipt(db, receipt_id, current))


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(
    receipt_id: int,
    current: CurrentUser = Depends(require_capability(CAP_RECEIPT_MANAGE)),
    db: Session = Depends(get_db),
) -> Response:
    _seen_receipt(db, receipt_id, current)
    try:
        coupon_receipt_service.delete_receipt(
            db, receipt_id=receipt_id, actor_user_id=current.id)
    except CouponReceiptError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class RejectIn(BaseModel):
    reason: str | None = None


class ReceiptEditIn(BaseModel):
    serials: list[str] = []
    serial_from: str | None = None
    serial_to: str | None = None
    coupon_kind: str | None = None
    customer_id: int | None = None
    received_date: date | None = None
    notes: str | None = None
    declared_value: Decimal | None = None
    customer_type: str | None = None


def _refused(exc: CouponReceiptError) -> HTTPException:
    if isinstance(exc, CouponReceiptConflict):
        return HTTPException(409, {"code": "coupon_receipt_conflict", "message": str(exc)})
    return HTTPException(422, {"code": "coupon_invalid", "message": str(exc)})


@router.post("/{receipt_id}/approve", response_model=ReceiptOut)
def approve_receipt(
    receipt_id: int,
    current: CurrentUser = Depends(require_capability(CAP_RECEIPT_MANAGE)),
    db: Session = Depends(get_db),
) -> ReceiptOut:
    _seen_receipt(db, receipt_id, current)
    try:
        receipt = coupon_receipt_service.approve_receipt(
            db, receipt_id=receipt_id, actor_user_id=current.id)
    except CouponReceiptError as exc:
        raise _refused(exc) from exc
    out = _out(receipt)
    db.commit()
    return out


@router.post("/{receipt_id}/reject", response_model=ReceiptOut)
def reject_receipt(
    receipt_id: int,
    body: RejectIn,
    current: CurrentUser = Depends(require_capability(CAP_RECEIPT_MANAGE)),
    db: Session = Depends(get_db),
) -> ReceiptOut:
    _seen_receipt(db, receipt_id, current)
    try:
        receipt = coupon_receipt_service.reject_receipt(
            db, receipt_id=receipt_id, actor_user_id=current.id, reason=body.reason)
    except CouponReceiptError as exc:
        raise _refused(exc) from exc
    out = _out(receipt)
    db.commit()
    return out


@router.put("/{receipt_id}", response_model=ReceiptOut)
def update_receipt(
    receipt_id: int,
    body: ReceiptEditIn,
    current: CurrentUser = Depends(require_capability(CAP_RECEIPT_MANAGE)),
    db: Session = Depends(get_db),
) -> ReceiptOut:
    _seen_receipt(db, receipt_id, current)
    try:
        serials = list(body.serials)
        if body.serial_from or body.serial_to:
            serials.extend(coupon_receipt_service.expand_range(body.serial_from, body.serial_to))
        receipt = coupon_receipt_service.update_receipt(
            db, receipt_id=receipt_id, actor_user_id=current.id, serials=serials,
            coupon_kind=body.coupon_kind, customer_id=body.customer_id,
            received_date=body.received_date, notes=body.notes,
            declared_value=body.declared_value, customer_type=body.customer_type)
    except CouponReceiptError as exc:
        db.rollback()
        raise _refused(exc) from exc
    out = _out(receipt)
    db.commit()
    return out
