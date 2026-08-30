"""تقارير ما بعد البيع — الكوبونات والمعاينات، بنفس تقسيم نظامهم القديم.

قايمة «تقارير متابعة» عندهم فيها: متابعة كوبونات السباكين · متابعة كوبونات الموزعين ·
كشف حساب الفنى · الزيارات بنقاط الفني · زيارات المناديب · تقارير المعاينات. الستة دول
هنا، بنفس السؤال اللي كل واحد بيجاوبه.

مافيش حاجة جديدة بتتسجّل عشان يتبنوا: مستند الصرف بيقول الورقة راحت لمين، والاستلام
بيقول رجعت من مين، والمعاينة شايلة فنيها ومندوبها ونقاطها. اللي كان ناقص هو قراءتهم
بالشكل ده.

---------------------------------------------------------------------------
قرارين:

* **«لسه برّه» بتتحسب على صاحب الصرف مش على اللي رجّع.** الورقة بتتصرف لموزع والسباك
  بيرجّعها — دول مش نفس الراجل. لو حسبنا «اتصرف له ناقص اللي استلمناه منه» بيطلع للسباك
  رصيد **سالب** (رجّع ٥ ومااتصرفش له حاجة) وللموزع رصيد كامل كأن مافيش حاجة رجعت. فالرجوع
  بيتنسب لمستند الصرف (`coupon_issue_id`)، وساعتها «لسه برّه» بتقول اللي بجد لسه برّه.

* **السباك تقريره «رجّع كام»، والموزع تقريره «عليه كام».** السؤالين مختلفين: الموزع ماسك
  ورق، والسباك بيجيب ورق. عمود واحد اسمه «المتبقي» على الاتنين بيخلّي واحد منهم يكدب.

* **الفني بيتلاقى بالعميل مش بالاسم.** الاستلام بيتسجّل على `customer_id`، والاسم على
  الكارت ممكن يتصلّح بعدين. التقرير اللي بيجمّع بالاسم بيفرّق الراجل الواحد لاتنين أول
  ما حد يزوّد مسافة.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_COUPON_RECEIVE, CAP_INSPECTION_READ
from src.core.db import get_db
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.customer import Customer
from src.models.inspection import Inspection
from src.models.user import User

router = APIRouter(tags=["after-sales-reports"], prefix="/after-sales-reports")

ZERO = Decimal("0.00")


class CouponPartyRow(BaseModel):
    """صف واحد في «متابعة كوبونات السباكين» أو «الموزعين»."""

    customer_id: int | None = None
    name: str
    phone: str | None = None
    # للموزع: اتصرف له كام، ورجع من الصرف ده كام (من أي سباك)، والفرق لسه برّه.
    issued: int = 0
    returned: int = 0
    outstanding: int = 0
    # للسباك: رجّع كام ورقة بنفسه.
    received: int = 0
    last_issue: date | None = None
    last_receipt: date | None = None


class CouponStatementRow(BaseModel):
    """سطر في كشف حساب الفنى/الموزع — ورقة خرجت أو رجعت."""

    kind: str          # «صرف» أو «استلام»
    document_number: str
    happened_on: date | None = None
    coupon_kind: str | None = None
    count: int = 0
    serial_from: str | None = None
    serial_to: str | None = None


class TechnicianVisitsRow(BaseModel):
    """صف في «الزيارات بنقاط الفني»."""

    name: str
    customer_id: int | None = None
    visits: int = 0
    points: Decimal = ZERO
    last_visit: date | None = None


class RepVisitsRow(BaseModel):
    """صف في «زيارات المناديب»."""

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
        CouponReceipt, current)
    if date_from:
        stmt = stmt.where(CouponReceipt.received_date >= date_from)
    if date_to:
        stmt = stmt.where(CouponReceipt.received_date <= date_to)
    return db.execute(stmt.group_by(CouponReceipt.customer_id)).all()


def _returned_against_issue(db: Session, current: CurrentUser,
                            date_from: date | None, date_to: date | None):
    """كل مستند صرف رجع منه كام ورقة — بغضّ النظر عن مين رجّعها.

    الورقة بتخرج لموزع وبترجع من سباك. ربط الرجوع بمستند الصرف هو اللي بيخلّي «لسه برّه»
    تقول الحقيقة؛ ربطها باللي رجّعها بيدّي للموزع رصيد كامل وللسباك رصيد سالب.
    """
    # الربط على المستند مباشرةً — من غير المرور بسطوره. المرور بيهم كان بيضرب العدد
    # في عدد أوراق المستند: مستند فيه ٥٠ ورقة رجع منه ٤٠ كان بيتحسب ٢٠٠٠، و«لسه برّه»
    # كانت بتطلع بالسالب بعشرات الألوف.
    stmt = branch_scope.scope(
        select(CouponIssue.customer_id, func.count(CouponReceiptLine.id))
        .join(CouponReceiptLine,
              CouponReceiptLine.coupon_issue_id == CouponIssue.id),
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
    """متابعة كوبونات السباكين — كل سباك اتصرف له كام ورجّع كام واللي لسه عليه."""
    return _party_rows(db, current, customer_type="plumber",
                       date_from=date_from, date_to=date_to)


@router.get("/coupons/by-distributor", response_model=list[CouponPartyRow])
def coupons_by_distributor(
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_COUPON_RECEIVE)),
    db: Session = Depends(get_db),
) -> list[CouponPartyRow]:
    """متابعة كوبونات الموزعين — نفس السؤال للتجار والموزعين."""
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
    """كشف حساب الفنى — كل ورقة خرجت له أو رجعت منه، بالترتيب الزمني."""
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
        CouponReceipt.customer_id == customer_id)
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

    out.sort(key=lambda r: (r.happened_on or date.min, r.document_number))
    return out


@router.get("/inspections/by-technician", response_model=list[TechnicianVisitsRow])
def inspections_by_technician(
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> list[TechnicianVisitsRow]:
    """الزيارات بنقاط الفني — كل فني عمل كام معاينة وجمّع كام نقطة."""
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
    # الفني عندنا عميل بتصنيف «سباك» — بنرجّع رقمه عشان الكشف يتفتح منه.
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
    """زيارات المناديب — كل مندوب نزل كام معاينة وعند كام عميل."""
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
