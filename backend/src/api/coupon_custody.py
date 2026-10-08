from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, get_current_user, require_capability
from src.auth.rbac import (
    CAP_COUPON_CUSTODY,
    CAP_COUPON_RECEIVE,
    CAP_SALE_WRITE,
    CAP_SALES_READ,
    role_has_capability,
)
from src.core.db import get_db
from src.models.coupon_custody import CouponCustody
from src.models.role import Role, RoleName
from src.models.user import User
from src.services import coupon_custody_service
from src.services.coupon_custody_service import CouponCustodyError

router = APIRouter(tags=["coupon-custody"], prefix="/coupon-custody")


class CustodyIn(BaseModel):
    rep_user_id: int
    coupon_kind: str
    serial_from: str
    serial_to: str | None = None
    doc_date: date | None = None
    notes: str | None = None


class CustodyOut(BaseModel):
    id: int
    document_number: str
    direction: str
    rep_user_id: int
    rep_name: str | None = None
    coupon_kind: str
    serial_from: str
    serial_to: str
    count: int
    doc_date: date | None = None
    notes: str | None = None
    actor_user_id: int | None = None
    created_at: datetime | None = None


class CustodyPageOut(BaseModel):
    rows: list[CustodyOut]
    total: int


class BalanceOut(BaseModel):
    rep_user_id: int
    rep_name: str
    coupon_kind: str
    available: int
    ranges: list[list[str]]
    given: int
    returned: int
    issued: int


def _reader(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.rep_id is not None or current.can(CAP_COUPON_CUSTODY):
        return current
    raise HTTPException(403, {"code": "forbidden", "message": "مالكش صلاحية «عهدة الكوبونات»."})


def _balance_reader(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.rep_id is not None or any(
            current.can(cap)
            for cap in (CAP_COUPON_CUSTODY, CAP_COUPON_RECEIVE, CAP_SALE_WRITE,
                        CAP_SALES_READ)):
        return current
    raise HTTPException(403, {"code": "forbidden", "message": "مالكش صلاحية «عهدة الكوبونات»."})


def _out(doc: CouponCustody, names: dict[int, str]) -> CustodyOut:
    return CustodyOut(
        id=doc.id, document_number=doc.document_number, direction=doc.direction,
        rep_user_id=doc.rep_user_id, rep_name=names.get(doc.rep_user_id),
        coupon_kind=doc.coupon_kind, serial_from=doc.serial_from, serial_to=doc.serial_to,
        count=doc.count, doc_date=doc.doc_date, notes=doc.notes,
        actor_user_id=doc.actor_user_id, created_at=doc.created_at,
    )


def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {uid: (name or username) for uid, name, username in db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(ids)))}


@router.get("", response_model=CustodyPageOut)
def list_custody(
    response: Response,
    rep_user_id: int | None = Query(None),
    coupon_kind: str | None = Query(None),
    direction: str | None = Query(None, pattern="^(out|in)$"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current: CurrentUser = Depends(_reader),
    db: Session = Depends(get_db),
) -> CustodyPageOut:
    stmt = branch_scope.scope(select(CouponCustody), CouponCustody, current)
    rep = current.rep_id if current.rep_id is not None else rep_user_id
    if rep:
        stmt = stmt.where(CouponCustody.rep_user_id == rep)
    if coupon_kind:
        kind = coupon_custody_service.stored_kind(db, coupon_kind) or coupon_kind.strip()
        stmt = stmt.where(CouponCustody.coupon_kind == kind)
    if direction:
        stmt = stmt.where(CouponCustody.direction == direction)
    if date_from:
        stmt = stmt.where(CouponCustody.doc_date >= date_from)
    if date_to:
        stmt = stmt.where(CouponCustody.doc_date <= date_to)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.scalars(stmt.order_by(CouponCustody.id.desc()).limit(limit).offset(offset)).all()
    names = _names(db, {r.rep_user_id for r in rows})
    response.headers["X-Total-Count"] = str(total)
    return CustodyPageOut(rows=[_out(r, names) for r in rows], total=total)


def _post(db: Session, body: CustodyIn, current: CurrentUser, fn) -> CustodyOut:
    try:
        doc = fn(db, rep_user_id=body.rep_user_id, coupon_kind=body.coupon_kind,
                 serial_from=body.serial_from, serial_to=body.serial_to,
                 actor_user_id=current.id, doc_date=body.doc_date, notes=body.notes)
    except CouponCustodyError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "coupon_custody", "message": str(exc)}) from exc
    out = _out(doc, _names(db, [doc.rep_user_id]))
    db.commit()
    return out


@router.post("/issue", response_model=CustodyOut, status_code=status.HTTP_201_CREATED)
def issue_custody(
    body: CustodyIn,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_CUSTODY)),
    db: Session = Depends(get_db),
) -> CustodyOut:
    return _post(db, body, current, coupon_custody_service.issue)


@router.post("/return", response_model=CustodyOut, status_code=status.HTTP_201_CREATED)
def return_custody(
    body: CustodyIn,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_CUSTODY)),
    db: Session = Depends(get_db),
) -> CustodyOut:
    return _post(db, body, current, coupon_custody_service.return_)


@router.delete("/{custody_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_custody(
    custody_id: int,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_CUSTODY)),
    db: Session = Depends(get_db),
) -> Response:
    doc = db.get(CouponCustody, custody_id)
    if doc is None or not branch_scope.may_see(current, doc):
        raise HTTPException(404, {"code": "not_found", "message": "مستند العهدة مش موجود."})
    try:
        coupon_custody_service.delete_doc(db, custody_id=custody_id, actor_user_id=current.id)
    except CouponCustodyError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "delete_blocked", "message": str(exc)}) from exc
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/balance", response_model=list[BalanceOut])
def custody_balance(
    rep_user_id: int | None = Query(None),
    current: CurrentUser = Depends(_balance_reader),
    db: Session = Depends(get_db),
) -> list[BalanceOut]:
    if current.rep_id is not None:
        return [BalanceOut(**r) for r in coupon_custody_service.balance(
            db, rep_user_id=current.rep_id)]
    if rep_user_id:
        return [BalanceOut(**r) for r in coupon_custody_service.balance(
            db, rep_user_id=rep_user_id)]
    branch_id = branch_scope.visible_branch_id(current)
    rep_ids = None
    if branch_id is not None:
        rep_ids = db.scalars(
            select(User.id).join(Role, Role.id == User.role_id).where(
                Role.name == RoleName.sales_rep,
                or_(User.branch_id == branch_id, User.branch_id.is_(None)))).all()
    return [BalanceOut(**r) for r in coupon_custody_service.balance(db, rep_ids=rep_ids)]
