from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_COUPON_RECEIVE, CAP_INSPECTION_READ
from src.core.db import get_db
from src.lib import coupon_lifecycle
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine, receipt_counted
from src.models.customer import Customer
from src.models.inspection import Inspection
from src.models.user import User

router = APIRouter(tags=["after-sales-reports"], prefix="/after-sales-reports")

ZERO = Decimal("0.00")


class CouponPartyRow(BaseModel):
    customer_id: int | None = None
    name: str
    phone: str | None = None
    issued: int = 0
    returned: int = 0
    outstanding: int = 0
    received: int = 0
    last_issue: date | None = None
    last_receipt: date | None = None


class CouponStatementRow(BaseModel):
    kind: str
    document_number: str
    happened_on: date | None = None
    coupon_kind: str | None = None
    count: int = 0
    serial_from: str | None = None
    serial_to: str | None = None


class TechnicianVisitsRow(BaseModel):
    name: str
    customer_id: int | None = None
    visits: int = 0
    points: Decimal = ZERO
    last_visit: date | None = None


class RepVisitsRow(BaseModel):
    rep_user_id: int | None = None
    name: str
    visits: int = 0
    points: Decimal = ZERO
    customers: int = 0
    last_visit: date | None = None


def _issued_counts(db: Session, current: CurrentUser,
                   date_from: date | None, date_to: date | None):
    stmt = branch_scope.scope(
        select(CouponIssue.customer_id, func.count(CouponIssueLine.id),
               func.max(CouponIssue.issue_date))
        .join(CouponIssueLine, CouponIssueLine.issue_id == CouponIssue.id),
        CouponIssue, current)
    if date_from:
        stmt = stmt.where(CouponIssue.issue_date >= date_from)
    if date_to:
        stmt = stmt.where(CouponIssue.issue_date <= date_to)
    return db.execute(stmt.group_by(CouponIssue.customer_id)).all()


def _received_counts(db: Session, current: CurrentUser,
                     date_from: date | None, date_to: date | None):
    stmt = branch_scope.scope(
        select(CouponReceipt.customer_id, func.count(CouponReceiptLine.id),
               func.max(CouponReceipt.received_date))
        .join(CouponReceiptLine, CouponReceiptLine.receipt_id == CouponReceipt.id),
        CouponReceipt, current).where(receipt_counted())
    if date_from:
        stmt = stmt.where(CouponReceipt.received_date >= date_from)
    if date_to:
        stmt = stmt.where(CouponReceipt.received_date <= date_to)
    return db.execute(stmt.group_by(CouponReceipt.customer_id)).all()


def _returned_against_issue(db: Session, current: CurrentUser,
                            date_from: date | None, date_to: date | None):
    stmt = branch_scope.scope(
        select(CouponIssue.customer_id, func.count(CouponReceiptLine.id))
        .join(CouponReceiptLine,
              CouponReceiptLine.coupon_issue_id == CouponIssue.id)
        .join(CouponReceipt, CouponReceipt.id == CouponReceiptLine.receipt_id)
        .where(receipt_counted()),
        CouponIssue, current)
    if date_from:
        stmt = stmt.where(CouponIssue.issue_date >= date_from)
    if date_to:
        stmt = stmt.where(CouponIssue.issue_date <= date_to)
    return dict(db.execute(stmt.group_by(CouponIssue.customer_id)).all())


def _party_rows(db: Session, current: CurrentUser, *, customer_type: str | None,
                date_from: date | None, date_to: date | None) -> list[CouponPartyRow]:
    issued = {cid: (n, last) for cid, n, last in
              _issued_counts(db, current, date_from, date_to)}
    received = {cid: (n, last) for cid, n, last in
                _received_counts(db, current, date_from, date_to)}
    returned = _returned_against_issue(db, current, date_from, date_to)
    ids = {c for c in (set(issued) | set(received)) if c}
    if not ids:
        return []
    stmt = select(Customer).where(Customer.id.in_(ids))
    if customer_type:
        stmt = stmt.where(Customer.customer_type == customer_type)
    rows = []
    for c in db.scalars(stmt).all():
        out_n, out_last = issued.get(c.id, (0, None))
        in_n, in_last = received.get(c.id, (0, None))
        back = returned.get(c.id, 0)
        rows.append(CouponPartyRow(
            customer_id=c.id, name=c.name, phone=c.phone,
            issued=out_n, returned=back, outstanding=out_n - back,
            received=in_n, last_issue=out_last, last_receipt=in_last))
    rows.sort(key=lambda r: (-r.outstanding, -r.received, -r.issued))
    return rows


@router.get("/coupons/by-plumber", response_model=list[CouponPartyRow])
def coupons_by_plumber(
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> list[CouponPartyRow]:
    return _party_rows(db, current, customer_type="plumber",
                       date_from=date_from, date_to=date_to)


@router.get("/coupons/by-distributor", response_model=list[CouponPartyRow])
def coupons_by_distributor(
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> list[CouponPartyRow]:
    return _party_rows(db, current, customer_type="trader",
                       date_from=date_from, date_to=date_to)


@router.get("/coupons/statement", response_model=list[CouponStatementRow])
def coupon_statement(
    customer_id: int = Query(..., description="الفني أو الموزع"),
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> list[CouponStatementRow]:
    out: list[CouponStatementRow] = []

    issues = branch_scope.scope(select(CouponIssue), CouponIssue, current).where(
        CouponIssue.customer_id == customer_id)
    if date_from:
        issues = issues.where(CouponIssue.issue_date >= date_from)
    if date_to:
        issues = issues.where(CouponIssue.issue_date <= date_to)
    for i in db.scalars(issues).all():
        serials = sorted(ln.serial for ln in i.lines)
        out.append(CouponStatementRow(
            kind="صرف", document_number=i.document_number, happened_on=i.issue_date,
            coupon_kind=i.coupon_kind, count=len(serials),
            serial_from=serials[0] if serials else None,
            serial_to=serials[-1] if serials else None))

    receipts = branch_scope.scope(select(CouponReceipt), CouponReceipt, current).where(
        CouponReceipt.customer_id == customer_id, receipt_counted())
    if date_from:
        receipts = receipts.where(CouponReceipt.received_date >= date_from)
    if date_to:
        receipts = receipts.where(CouponReceipt.received_date <= date_to)
    for r in db.scalars(receipts).all():
        serials = sorted(ln.serial for ln in r.lines)
        out.append(CouponStatementRow(
            kind="استلام", document_number=r.document_number,
            happened_on=r.received_date, coupon_kind=r.declared_kind,
            count=len(serials), serial_from=serials[0] if serials else None,
            serial_to=serials[-1] if serials else None))

    out.sort(key=lambda r: (r.happened_on or date.min, r.document_number), reverse=True)
    return out


@router.get("/inspections/by-technician", response_model=list[TechnicianVisitsRow])
def inspections_by_technician(
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> list[TechnicianVisitsRow]:
    stmt = branch_scope.scope(
        select(Inspection.technician_name, func.count(Inspection.id),
               func.coalesce(func.sum(Inspection.total_points), 0),
               func.max(Inspection.inspection_date)),
        Inspection, current).where(Inspection.technician_name.isnot(None))
    if date_from:
        stmt = stmt.where(Inspection.inspection_date >= date_from)
    if date_to:
        stmt = stmt.where(Inspection.inspection_date <= date_to)
    rows = db.execute(stmt.group_by(Inspection.technician_name)).all()
    ids = {c.name: c.id for c in db.scalars(
        select(Customer).where(Customer.customer_type == "plumber")).all()}
    out = [TechnicianVisitsRow(name=name, customer_id=ids.get(name), visits=n,
                               points=Decimal(str(pts or 0)), last_visit=last)
           for name, n, pts, last in rows]
    out.sort(key=lambda r: -r.visits)
    return out


@router.get("/inspections/by-rep", response_model=list[RepVisitsRow])
def inspections_by_rep(
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> list[RepVisitsRow]:
    stmt = branch_scope.scope(
        select(Inspection.rep_user_id, func.count(Inspection.id),
               func.coalesce(func.sum(Inspection.total_points), 0),
               func.count(func.distinct(Inspection.customer_id)),
               func.max(Inspection.inspection_date)),
        Inspection, current)
    if date_from:
        stmt = stmt.where(Inspection.inspection_date >= date_from)
    if date_to:
        stmt = stmt.where(Inspection.inspection_date <= date_to)
    rows = db.execute(stmt.group_by(Inspection.rep_user_id)).all()
    names = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    out = [RepVisitsRow(rep_user_id=rid, name=names.get(rid, "—"), visits=n,
                        points=Decimal(str(pts or 0)), customers=custs, last_visit=last)
           for rid, n, pts, custs, last in rows]
    out.sort(key=lambda r: -r.visits)
    return out


@router.get("/coupons/lifecycle")
def coupons_lifecycle(
    date_field: str = Query("handout",
                            description="handout = تاريخ التسليم، receipt = تاريخ الاستلام"),
    date_from: date | None = None,
    date_to: date | None = None,
    rep_id: int | None = Query(None, description="مندوب العهدة أو التسليم أو الاستلام"),
    party_id: int | None = Query(None, description="التاجر/الموزع اللي اتسلّمله"),
    plumber_id: int | None = Query(None, description="السباك اللي رجّعها"),
    kind: str | None = None,
    status: str | None = Query(None, description="with_rep / given / received / returned"),
    serial: str | None = Query(None, description="رقم ورقة واحدة"),
    serial_from: str | None = None,
    serial_to: str | None = None,
    only_unlinked: bool = Query(False, description="اللي رجعت ومالهاش تسليم معروف"),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return coupon_lifecycle.lifecycle(
            db, current, date_field=date_field, date_from=date_from, date_to=date_to,
            rep_id=rep_id, party_id=party_id, plumber_id=plumber_id, kind=kind,
            status=status, serial=serial, serial_from=serial_from, serial_to=serial_to,
            only_unlinked=only_unlinked, limit=limit, offset=offset)
    except coupon_lifecycle.CouponLifecycleError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc
