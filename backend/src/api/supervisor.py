"""«مشرف المناديب» — متابعة شغل مجموعة مناديب من التطبيق (٢٠٢٦-١٠-٠٦).

المشرف مابيبيعش ومابيحصّلش — بيتفرّج. الشاشة بتاعته في التطبيق بتسأل تلات أسئلة:

* **المناديب بتوعي عملوا إيه في الفترة دي؟** (`/overview`) — مبيعات ومرتجعات وتحصيلات
  ومديونية عملاء كل مندوب، بأرقام مجمّعة في القاعدة (استعلام لكل رقم، مش لكل مندوب).
* **المندوب ده عمل إيه بالظبط؟** (`/reps/{id}/activity`) — كل مستنداته في قايمة واحدة.
* **المستند ده فيه إيه؟** (`/reps/{id}/documents/{kind}/{doc_id}`) — السطور.

**مين يشوف مين:** مشرف المناديب بيشوف المناديب اللي `supervisor_id` بتاعهم = هو، وبس —
مهما كان فرعه. مدير النظام والمالك ومدير المبيعات ومدير الفرع بيشوفوا كل المناديب
النشطين في نطاق فروعهم المعتاد. أي مندوب بره النطاق = ٤٠٤ (مش ٤٠٣: «موجود بس مش ليك»
بتقول إن الرقم ده لمندوب، وده نفسه معلومة).

**التعريفات مش جديدة** — كل رقم هنا نفس رقم الشاشة اللي بتجاوب نفس السؤال:

* المبيعات = `/sales/summary` (فواتير البيع من `_sales_list_stmt` بتاريخ الفاتورة، والبونص بره).
* المرتجعات = `/sales/summary` (اللي ليها عميل ومش ملغية، بساعة التسجيل).
* التحصيلات = `/sales/receipts-log` (النقدي على الفاتورة + سندات القبض من العملاء).
* مديونية العملاء = `/customers/debts` لمندوب (المدينين بس، الرصيد الحالي مش رصيد الفترة).

قراءة بس — مافيش ولا كتابة في الملف ده.
"""
from __future__ import annotations

import dataclasses
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Date, case, cast, func, or_, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, get_current_user
from src.auth.rbac import CAP_APP_SUPERVISOR, CAP_SALES_READ
from src.core import clock
from src.core.db import get_db
from src.core.money import to_money, to_qty
from src.models.catalog import Item
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.customer import Customer
from src.models.inspection import Inspection, InspectionItem, InspectionStatus, VisitKind
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.models.stock import LocationKind
from src.models.transfer import StockTransfer, StockTransferLine, TransferStatus
from src.models.user import User
from src.models.voucher import Voucher, VoucherKind
from src.models.warehouse import Custody, Warehouse
from src.services.rep_store_service import rep_store

router = APIRouter(tags=["supervisor"], prefix="/supervisor")

#: الأدوار اللي بتشوف كل مناديب نطاقها من غير ما يتسجّلوا مشرفين عليهم.
_MANAGER_ROLES = {RoleName.sales_manager, RoleName.branch_manager}

KINDS = ("sales", "returns", "collections", "transfers", "coupons", "inspections")
DETAIL_KINDS = ("sales", "returns", "transfers")

_TRANSFER_STATUS = {
    TransferStatus.pending: "قيد الاعتماد",
    TransferStatus.approved: "معتمد",
    TransferStatus.rejected: "مرفوض",
    TransferStatus.reversed: "ملغي",
}
_VISIT_KIND = {VisitKind.technician: "معاينة فني", VisitKind.regular: "زيارة عادية"}
_PAYMENT_METHOD = {"cash": "نقدي", "cheque": "شيك", "check": "شيك", "bank": "تحويل بنكي",
                   "transfer": "تحويل بنكي", "wallet": "محفظة"}


def _not_found(message: str = "المندوب غير موجود.") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": message})


def _gate(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """مين يفتح مسارات المشرف أصلاً.

    مشرف المناديب بصلاحية `app.supervisor` (اللي ممكن تتشال منه من شاشة الصلاحيات).
    والمديرين بـ`sales.read` — بيشوفوا المبيعات كلها من الشاشات التانية أصلاً، فالمسار ده
    مابيوسّعش عليهم حاجة. أي دور تاني (المندوب نفسه، المحاسب...) مالوش شاشة مشرف.
    """
    if current.role == RoleName.rep_supervisor:
        if current.can(CAP_APP_SUPERVISOR):
            return current
    elif current.is_admin or current.role in _MANAGER_ROLES:
        if current.can(CAP_SALES_READ) or current.can(CAP_APP_SUPERVISOR):
            return current
    raise HTTPException(status.HTTP_403_FORBIDDEN, {
        "code": "forbidden", "message": "متابعة المناديب للمشرف والمديرين بس."})


def _doc_view(current: CurrentUser) -> CurrentUser:
    """الهوية اللي المستندات بتتفلتر بيها.

    المشرف نطاقه **مناديبه** مش فرعه: مندوب تحته في فرع تاني لازم شغله يبان كامل. فعزل
    الفروع بيتشال عنه هنا (`branch_id=None` = «بيشوف الكل» في `branch_scope`) — والقفل
    الحقيقي إن كل استعلام تحت مربوط بمندوب اتأكدنا إنه تحته. المديرين بيفضلوا على فروعهم.
    """
    if current.role == RoleName.rep_supervisor:
        return dataclasses.replace(current, branch_id=None)
    return current


def _reps_stmt(db: Session, current: CurrentUser, *, include_inactive: bool = False):
    role_id = db.scalar(select(Role.id).where(Role.name == RoleName.sales_rep))
    if role_id is None:
        return None
    stmt = select(User).where(User.role_id == role_id)
    if not include_inactive:
        stmt = stmt.where(User.active.is_(True))
    if current.role == RoleName.rep_supervisor:
        return stmt.where(User.supervisor_id == current.id)
    return branch_scope.scope(stmt, User, current)


def _rep_or_404(db: Session, current: CurrentUser, rep_id: int) -> User:
    # المعطّل بيتفتح هنا (مش في الملخّص): مندوب اتوقف النهارده شغله لسه بيتراجع.
    stmt = _reps_stmt(db, current, include_inactive=True)
    rep = db.scalar(stmt.where(User.id == rep_id)) if stmt is not None else None
    if rep is None:
        raise _not_found()
    return rep


def _money(v) -> str:
    return str(to_money(Decimal(str(v or 0))))


def _iso(t: datetime | None) -> str | None:
    return t.replace(microsecond=0).isoformat() if t else None


def _day(d: date | None, created: datetime | None) -> str | None:
    if d is not None:
        return str(d)[:10]
    return str(created)[:10] if created else None


def _range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = clock.today()
    d1 = date_from or date_to or today
    d2 = date_to or date_from or today
    if d2 < d1:
        d1, d2 = d2, d1
    return d1, d2


def _voucher_rep():
    """مندوب سند القبض — نفس قاعدة `/sales/receipts-log`: `rep_user_id`، ولو فاضي والسند
    جاي من التطبيق (`client_uuid`) فاللي كتبه هو المندوب."""
    return func.coalesce(Voucher.rep_user_id,
                         case((Voucher.client_uuid.is_not(None), Voucher.actor_user_id)))


# ======================================================================
# المرشحات — مكان واحد للملخّص وللسجل، عشان العدّ في الاتنين يبقى واحد
# ======================================================================

def _sales_stmt(view: CurrentUser, d1: date, d2: date, *, kind: str | None):
    from src.api.sales import _sales_list_stmt

    return _sales_list_stmt(view, date_from=d1, date_to=d2, kind=kind)


def _returns_stmt(view: CurrentUser, d1: date, d2: date, *, all_states: bool = False):
    """نفس مرتجعات `/sales/summary`: بساعة التسجيل، واللي ليها عميل ومش ملغية."""
    stmt = branch_scope.scope(select(SalesReturn), SalesReturn, view).where(
        SalesReturn.created_at >= clock.day_start_utc(d1),
        SalesReturn.created_at < clock.day_end_utc(d2))
    if not all_states:
        stmt = stmt.where(SalesReturn.customer_id.isnot(None), SalesReturn.reversed_at.is_(None))
    return stmt


def _inv_day():
    return func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))


def _cash_invoices_stmt(view: CurrentUser, d1: date, d2: date):
    """النقدي اللي اندفع مع الفاتورة — نفس `/sales/receipts-log`."""
    day = _inv_day()
    return branch_scope.scope(select(SalesInvoice), SalesInvoice, view).where(
        SalesInvoice.cash_amount > 0,
        or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
        day >= d1, day <= d2)


def _receipts_stmt(view: CurrentUser, d1: date, d2: date):
    """سندات القبض من العملاء — نفس `/sales/receipts-log`."""
    return branch_scope.scope(select(Voucher), Voucher, view).where(
        Voucher.kind == VoucherKind.receipt, Voucher.customer_id.is_not(None),
        Voucher.voucher_date >= d1, Voucher.voucher_date <= d2)


def _transfer_day():
    return func.coalesce(StockTransfer.transfer_date, cast(StockTransfer.created_at, Date))


def _transfers_stmt(db: Session, view: CurrentUser, rep_id: int, d1: date, d2: date):
    """تحويلات المندوب: اللي طلبها، أو اللي خرجت من مكان بضاعته أو دخلته."""
    conds = [StockTransfer.initiated_by == rep_id]
    store = rep_store(db, rep_id)
    if store is not None:
        kind, loc = store
        conds.append((StockTransfer.source_location_kind == kind)
                     & (StockTransfer.source_location_id == loc))
        conds.append((StockTransfer.dest_location_kind == kind)
                     & (StockTransfer.dest_location_id == loc))
    day = _transfer_day()
    return branch_scope.scope(select(StockTransfer), StockTransfer, view).where(
        or_(*conds), day >= d1, day <= d2)


def _coupon_day():
    return func.coalesce(CouponReceipt.received_date, cast(CouponReceipt.created_at, Date))


# ======================================================================
# الملخّص
# ======================================================================

@router.get("/overview", response_model=dict)
def overview(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    current: CurrentUser = Depends(_gate),
    db: Session = Depends(get_db),
) -> dict:
    """أرقام كل مندوب في الفترة — كل رقم باستعلام مجمّع واحد لكل المناديب."""
    from src.api.customers import _scope_filter
    from src.services import customer_profile_service

    d1, d2 = _range(date_from, date_to)
    view = _doc_view(current)
    stmt = _reps_stmt(db, current)
    reps = list(db.scalars(stmt).all()) if stmt is not None else []
    ids = [r.id for r in reps]

    zero = Decimal("0")
    sales: dict[int, tuple[int, Decimal]] = {}
    returns: dict[int, tuple[int, Decimal]] = {}
    coll_n: dict[int, int] = {}
    coll_s: dict[int, Decimal] = {}
    cust: dict[int, tuple[int, Decimal]] = {}
    last: dict[int, datetime] = {}

    if ids:
        # المبيعات — بونص بره زي `/sales/summary`.
        s = _sales_stmt(view, d1, d2, kind="sale").where(SalesInvoice.rep_id.in_(ids)).subquery()
        for rid, n, total in db.execute(
                select(s.c.rep_id, func.count(), func.coalesce(func.sum(s.c.net), 0))
                .group_by(s.c.rep_id)).all():
            sales[rid] = (int(n or 0), Decimal(str(total or 0)))

        r = _returns_stmt(view, d1, d2).where(SalesReturn.rep_id.in_(ids)).subquery()
        for rid, n, total in db.execute(
                select(r.c.rep_id, func.count(), func.coalesce(func.sum(r.c.value), 0))
                .group_by(r.c.rep_id)).all():
            returns[rid] = (int(n or 0), Decimal(str(total or 0)))

        ci = _cash_invoices_stmt(view, d1, d2).where(SalesInvoice.rep_id.in_(ids)).subquery()
        for rid, n, total in db.execute(
                select(ci.c.rep_id, func.count(), func.coalesce(func.sum(ci.c.cash_amount), 0))
                .group_by(ci.c.rep_id)).all():
            coll_n[rid] = coll_n.get(rid, 0) + int(n or 0)
            coll_s[rid] = coll_s.get(rid, zero) + Decimal(str(total or 0))
        vrep = _voucher_rep()
        cv = _receipts_stmt(view, d1, d2).where(vrep.in_(ids)).with_only_columns(
            vrep.label("rep"), Voucher.amount.label("amount")).subquery()
        for rid, n, total in db.execute(
                select(cv.c.rep, func.count(), func.coalesce(func.sum(cv.c.amount), 0))
                .group_by(cv.c.rep)).all():
            coll_n[rid] = coll_n.get(rid, 0) + int(n or 0)
            coll_s[rid] = coll_s.get(rid, zero) + Decimal(str(total or 0))

        # مديونية العملاء — نفس `/customers/debts` (المدينين بس، والمالك بره، والمدموج بره).
        base = customer_profile_service.apply_filters(
            _scope_filter(select(Customer.id, Customer.rep_id), view)
        ).where(Customer.customer_type != "owner", Customer.rep_id.in_(ids)).subquery()
        bal = customer_profile_service.family_balances_subquery(None)
        total = func.coalesce(bal.c.total, zero)
        for rid, n, debt in db.execute(
                select(base.c.rep_id, func.count(),
                       func.coalesce(func.sum(case((total > 0, total), else_=zero)), zero))
                .select_from(base.outerjoin(bal, bal.c.customer_id == base.c.id))
                .group_by(base.c.rep_id)).all():
            cust[rid] = (int(n or 0), Decimal(str(debt or 0)))

        # آخر حركة — من غير فترة: «المندوب ده آخر مرة اشتغل امتى».
        for col, created in (
            (SalesInvoice.rep_id, SalesInvoice.created_at),
            (SalesReturn.rep_id, SalesReturn.created_at),
            (vrep, Voucher.created_at),
            (StockTransfer.initiated_by, StockTransfer.created_at),
            (CouponReceipt.rep_user_id, CouponReceipt.created_at),
            (Inspection.rep_user_id, Inspection.created_at),
        ):
            for rid, at in db.execute(select(col, func.max(created))
                                      .where(col.in_(ids)).group_by(col)).all():
                if at is not None and (rid not in last or at > last[rid]):
                    last[rid] = at

    out_reps = []
    tot = {"sales": zero, "sales_count": 0, "returns": zero, "returns_count": 0,
           "collections": zero, "collections_count": 0, "customers_debt": zero}
    for rep in reps:
        sn, sv = sales.get(rep.id, (0, zero))
        rn, rv = returns.get(rep.id, (0, zero))
        cn, cd = cust.get(rep.id, (0, zero))
        coln, colv = coll_n.get(rep.id, 0), coll_s.get(rep.id, zero)
        tot["sales"] += sv
        tot["sales_count"] += sn
        tot["returns"] += rv
        tot["returns_count"] += rn
        tot["collections"] += colv
        tot["collections_count"] += coln
        tot["customers_debt"] += cd
        out_reps.append({
            "id": rep.id, "full_name": rep.full_name or rep.username, "username": rep.username,
            "sales": _money(sv), "sales_count": sn,
            "returns": _money(rv), "returns_count": rn,
            "collections": _money(colv), "collections_count": coln,
            "net": _money(sv - rv),
            "customers_count": cn, "customers_debt": _money(cd),
            "last_activity_at": _iso(last.get(rep.id)),
        })
    # الأكتر شغلاً فوق، والمتساويين بالاسم.
    out_reps.sort(key=lambda x: (-Decimal(x["net"]), x["full_name"]))

    return {
        "date_from": str(d1), "date_to": str(d2),
        "totals": {
            "sales": _money(tot["sales"]), "sales_count": tot["sales_count"],
            "returns": _money(tot["returns"]), "returns_count": tot["returns_count"],
            "collections": _money(tot["collections"]),
            "collections_count": tot["collections_count"],
            "net": _money(tot["sales"] - tot["returns"]),
            "customers_debt": _money(tot["customers_debt"]),
            "reps_count": len(reps),
        },
        "reps": out_reps,
    }


# ======================================================================
# سجل المندوب
# ======================================================================

def _item(kind: str, *, id: int, document_number: str | None, date_: str | None,
          created_at: datetime | None, party_name: str | None = None,
          amount=None, cash=None, credit=None, status_: str | None = None,
          note: str | None = None, lines_count: int | None = None, **extra) -> dict:
    return {
        "kind": kind, "id": id, "document_number": document_number, "date": date_,
        "created_at": _iso(created_at), "party_name": party_name,
        "amount": None if amount is None else _money(amount),
        "cash": None if cash is None else _money(cash),
        "credit": None if credit is None else _money(credit),
        "status": status_, "note": note or None, "lines_count": lines_count,
        **extra,
    }


def _customer_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(Customer.id, Customer.name).where(Customer.id.in_(ids))).all())


def _line_counts(db: Session, col, ids) -> dict[int, int]:
    ids = list({i for i in ids if i})
    if not ids:
        return {}
    return dict(db.execute(select(col, func.count()).where(col.in_(ids)).group_by(col)).all())


def _join(*parts) -> str | None:
    text = " · ".join(p.strip() for p in parts if p and str(p).strip())
    return text or None


class _Location:
    """اسم المكان: المخزن باسمه، والعهدة باسم المندوب اللي شايلها."""

    def __init__(self, db: Session):
        self.db = db
        self._wh: dict[int, str] | None = None
        self._cu: dict[int, str] | None = None

    def __call__(self, kind, loc_id) -> str | None:
        if loc_id is None:
            return None
        k = getattr(kind, "value", kind)
        if k == LocationKind.custody.value:
            if self._cu is None:
                users = dict(self.db.execute(select(User.id, User.full_name)).all())
                self._cu = {cid: f"عهدة {users.get(rid) or ''}".strip()
                            for cid, rid in self.db.execute(
                                select(Custody.id, Custody.rep_id)).all()}
            return self._cu.get(loc_id)
        if self._wh is None:
            self._wh = dict(self.db.execute(select(Warehouse.id, Warehouse.name)).all())
        return self._wh.get(loc_id)


def _sales_items(db: Session, rows: list[SalesInvoice]) -> list[dict]:
    names = _customer_names(db, (r.customer_id for r in rows))
    lines = _line_counts(db, SalesInvoiceLine.invoice_id, (r.id for r in rows))
    return [_item(
        "sales", id=r.id, document_number=r.document_number,
        date_=_day(r.invoice_date, r.created_at), created_at=r.created_at,
        party_name=names.get(r.customer_id),
        amount=Decimal(str(r.net or 0)) + Decimal(str(r.tax_amount or 0)),
        cash=r.cash_amount, credit=r.credit_amount,
        status_="بونص" if r.is_bonus else None,
        note=_join(r.statement1, r.notes), lines_count=lines.get(r.id, 0),
    ) for r in rows]


def _returns_items(db: Session, rows: list[SalesReturn]) -> list[dict]:
    names = _customer_names(db, (r.customer_id for r in rows))
    lines = _line_counts(db, SalesReturnLine.return_id, (r.id for r in rows))
    return [_item(
        "returns", id=r.id, document_number=r.document_number,
        date_=_day(r.return_date, r.created_at), created_at=r.created_at,
        party_name=names.get(r.customer_id),
        amount=Decimal(str(r.value or 0)) + Decimal(str(r.tax_amount or 0)),
        cash=r.cash_refund, credit=r.credit_reduction,
        status_="ملغي" if r.reversed_at else None,
        note=_join(r.statement1, r.notes), lines_count=lines.get(r.id, 0),
    ) for r in rows]


def _cash_invoice_items(db: Session, rows: list[SalesInvoice]) -> list[dict]:
    from src.services.voucher_service import cash_labeler

    names = _customer_names(db, (r.customer_id for r in rows))
    label = cash_labeler(db, treasury_ids=set(),
                         account_ids={r.cash_account_id for r in rows})
    return [_item(
        "collections", id=r.id, document_number=r.document_number,
        date_=_day(r.invoice_date, r.created_at), created_at=r.created_at,
        party_name=names.get(r.customer_id), amount=r.cash_amount,
        note=_join("نقدي مع الفاتورة", label(None, r.cash_account_id)),
        source="invoice", payment_method="cash", treasury=label(None, r.cash_account_id),
    ) for r in rows]


def _voucher_items(db: Session, rows: list[Voucher]) -> list[dict]:
    from src.services.voucher_service import cash_labeler

    names = _customer_names(db, (v.customer_id for v in rows))
    label = cash_labeler(db, treasury_ids={v.treasury_id for v in rows},
                         account_ids={v.cash_account_id for v in rows})
    ids = [v.id for v in rows]
    reversed_ids = set(db.scalars(select(Voucher.reverses_id)
                                  .where(Voucher.reverses_id.in_(ids))).all()) if ids else set()
    out = []
    for v in rows:
        method = v.payment_method or "cash"
        treasury = label(v.treasury_id, v.cash_account_id)
        out.append(_item(
            "collections", id=v.id, document_number=v.document_number,
            date_=_day(v.voucher_date, v.created_at), created_at=v.created_at,
            party_name=names.get(v.customer_id), amount=v.amount,
            status_=("ملغي" if v.id in reversed_ids else "عكس سند" if v.reverses_id else None),
            note=_join(_PAYMENT_METHOD.get(method, method), treasury,
                       v.statement1 or v.description),
            source="voucher", payment_method=method, treasury=treasury,
        ))
    return out


def _transfer_items(db: Session, rows: list[StockTransfer]) -> list[dict]:
    loc = _Location(db)
    lines = _line_counts(db, StockTransferLine.transfer_id, (t.id for t in rows))
    return [_item(
        "transfers", id=t.id, document_number=t.document_number,
        date_=_day(t.transfer_date, t.created_at), created_at=t.created_at,
        status_=_TRANSFER_STATUS.get(t.status, getattr(t.status, "value", t.status)),
        note=_join(f"من {loc(t.source_location_kind, t.source_location_id) or '—'} "
                   f"إلى {loc(t.dest_location_kind, t.dest_location_id) or '—'}",
                   t.statement1, t.reject_reason),
        # الإذن القديم صنف واحد على المستند نفسه من غير سطور.
        lines_count=lines.get(t.id) or (1 if t.item_id else 0),
    ) for t in rows]


def _coupon_items(db: Session, rows: list[CouponReceipt]) -> list[dict]:
    names = _customer_names(db, (r.customer_id for r in rows))
    lines = _line_counts(db, CouponReceiptLine.receipt_id, (r.id for r in rows))
    out = []
    for r in rows:
        item = _item(
            "coupons", id=r.id, document_number=r.document_number,
            date_=_day(r.received_date, r.created_at), created_at=r.created_at,
            party_name=names.get(r.customer_id),
            note=_join(f"{r.coupon_count or 0} كوبون", r.declared_kind, r.notes),
            lines_count=lines.get(r.id, 0),
        )
        # الكوبونات عدد مش فلوس — بيترجع رقم صحيح من غير كسور.
        item["amount"] = str(int(r.coupon_count or 0))
        out.append(item)
    return out


def _inspection_items(db: Session, rows: list[Inspection]) -> list[dict]:
    names = _customer_names(db, (r.customer_id for r in rows))
    lines = _line_counts(db, InspectionItem.inspection_id, (r.id for r in rows))
    out = []
    for r in rows:
        kind = _VISIT_KIND.get(r.visit_kind, getattr(r.visit_kind, "value", r.visit_kind))
        item = _item(
            "inspections", id=r.id, document_number=r.document_number,
            date_=_day(r.inspection_date, r.created_at), created_at=r.created_at,
            party_name=names.get(r.customer_id) or r.owner_name,
            status_="مرفوضة" if r.status == InspectionStatus.rejected else "مقبولة",
            note=_join(kind, r.visit_type if r.visit_kind == VisitKind.technician else None,
                       r.purchase_shop),
            lines_count=lines.get(r.id, 0),
        )
        # النقط مش فلوس — بتترجع زي ما هي (ممكن كسور: «٦ قطع = نقطة»).
        item["amount"] = str(r.total_points if r.total_points is not None else 0)
        out.append(item)
    return out


def _sources(db: Session, view: CurrentUser, rep_id: int, d1: date, d2: date, kinds):
    """(الاستعلام، ترتيبه، المحوّل) لكل مصدر — التحصيلات مصدرين (فاتورة + سند)."""
    out = []
    if "sales" in kinds:
        # البونص جوّه السجل (بعلامة «بونص») — المشرف بيشوف كل اللي المندوب عمله، والملخّص
        # بس هو اللي بيستبعده من رقم المبيعات.
        out.append((_sales_stmt(view, d1, d2, kind=None).where(SalesInvoice.rep_id == rep_id),
                    (_inv_day().desc(), SalesInvoice.created_at.desc(), SalesInvoice.id.desc()),
                    _sales_items))
    if "returns" in kinds:
        out.append((_returns_stmt(view, d1, d2, all_states=True)
                    .where(SalesReturn.rep_id == rep_id),
                    (func.coalesce(SalesReturn.return_date,
                                   cast(SalesReturn.created_at, Date)).desc(),
                     SalesReturn.created_at.desc(), SalesReturn.id.desc()),
                    _returns_items))
    if "collections" in kinds:
        out.append((_cash_invoices_stmt(view, d1, d2).where(SalesInvoice.rep_id == rep_id),
                    (_inv_day().desc(), SalesInvoice.created_at.desc(), SalesInvoice.id.desc()),
                    _cash_invoice_items))
        out.append((_receipts_stmt(view, d1, d2).where(_voucher_rep() == rep_id),
                    (Voucher.voucher_date.desc(), Voucher.created_at.desc(), Voucher.id.desc()),
                    _voucher_items))
    if "transfers" in kinds:
        out.append((_transfers_stmt(db, view, rep_id, d1, d2),
                    (_transfer_day().desc(), StockTransfer.created_at.desc(),
                     StockTransfer.id.desc()),
                    _transfer_items))
    if "coupons" in kinds:
        day = _coupon_day()
        out.append((branch_scope.scope(select(CouponReceipt), CouponReceipt, view).where(
                        CouponReceipt.rep_user_id == rep_id, day >= d1, day <= d2),
                    (day.desc(), CouponReceipt.created_at.desc(), CouponReceipt.id.desc()),
                    _coupon_items))
    if "inspections" in kinds:
        out.append((branch_scope.scope(select(Inspection), Inspection, view).where(
                        Inspection.rep_user_id == rep_id,
                        Inspection.inspection_date >= d1, Inspection.inspection_date <= d2),
                    (Inspection.inspection_date.desc(), Inspection.created_at.desc(),
                     Inspection.id.desc()),
                    _inspection_items))
    return out


@router.get("/reps/{rep_id}/activity", response_model=dict)
def rep_activity(
    rep_id: int,
    kind: str = Query("all"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current: CurrentUser = Depends(_gate),
    db: Session = Depends(get_db),
) -> dict:
    """كل مستندات المندوب في الفترة — نوع واحد أو الكل مدموجين، الأحدث فوق."""
    if kind != "all" and kind not in KINDS:
        raise HTTPException(422, {"code": "validation",
                                  "message": f"النوع لازم يبقى all أو واحد من: {', '.join(KINDS)}"})
    rep = _rep_or_404(db, current, rep_id)
    d1, d2 = _range(date_from, date_to)
    view = _doc_view(current)
    kinds = KINDS if kind == "all" else (kind,)

    # كل مصدر بيتعدّ لوحده، وبيتجاب منه أول (offset+limit) بس — الدمج والقص بعدها.
    # الصفحة رقم ن من الكل لازم تبقى جوّه أول (offset+limit) من كل مصدر، فده كفاية وصح.
    total = 0
    items: list[dict] = []
    want = offset + limit
    for stmt, order, convert in _sources(db, view, rep.id, d1, d2, kinds):
        total += db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = list(db.scalars(stmt.order_by(*order).limit(want)).all())
        items.extend(convert(db, rows))
    items.sort(key=lambda x: (x["date"] or "", x["created_at"] or "", x["id"]), reverse=True)

    return {
        "rep": {"id": rep.id, "full_name": rep.full_name or rep.username},
        "date_from": str(d1), "date_to": str(d2),
        "total": int(total),
        "items": items[offset:offset + limit],
    }


# ======================================================================
# تفاصيل مستند
# ======================================================================

def _item_info(db: Session, ids) -> dict[int, tuple[str, str]]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {i: (n, u) for i, n, u in db.execute(
        select(Item.id, Item.name, Item.unit_of_measure).where(Item.id.in_(ids))).all()}


def _line(info, item_id, quantity, unit, unit_price, line_total) -> dict:
    name, base_unit = info.get(item_id, (None, None))
    return {
        "item_id": item_id,
        "item_name": name or f"صنف #{item_id}",
        "quantity": str(to_qty(Decimal(str(quantity or 0)))),
        "unit": unit or base_unit,
        "unit_price": None if unit_price is None else _money(unit_price),
        "line_total": None if line_total is None else _money(line_total),
    }


@router.get("/reps/{rep_id}/documents/{kind}/{doc_id}", response_model=dict)
def rep_document(
    rep_id: int,
    kind: str,
    doc_id: int,
    current: CurrentUser = Depends(_gate),
    db: Session = Depends(get_db),
) -> dict:
    """سطور مستند واحد للمندوب — ٤٠٤ لو المستند مش بتاعه أو بره نطاق اللي بيسأل."""
    if kind not in DETAIL_KINDS:
        raise _not_found("التفاصيل للمبيعات والمرتجعات والتحويلات بس.")
    rep = _rep_or_404(db, current, rep_id)
    view = _doc_view(current)
    missing = _not_found("المستند غير موجود.")

    if kind == "sales":
        doc = db.get(SalesInvoice, doc_id)
        if doc is None or doc.rep_id != rep.id or not branch_scope.may_see(view, doc):
            raise missing
        header = _sales_items(db, [doc])[0]
        rows = sorted(doc.lines, key=lambda ln: ln.id)
        info = _item_info(db, (ln.item_id for ln in rows))
        lines = [_line(info, ln.item_id, ln.quantity, ln.unit, ln.unit_price, ln.line_total)
                 for ln in rows]
    elif kind == "returns":
        doc = db.get(SalesReturn, doc_id)
        if doc is None or doc.rep_id != rep.id or not branch_scope.may_see(view, doc):
            raise missing
        header = _returns_items(db, [doc])[0]
        rows = sorted(doc.lines, key=lambda ln: ln.id)
        info = _item_info(db, (ln.item_id for ln in rows))
        lines = [_line(info, ln.item_id, ln.quantity, ln.unit, ln.unit_price, ln.line_total)
                 for ln in rows]
    else:  # transfers
        doc = db.get(StockTransfer, doc_id)
        if doc is None or not branch_scope.may_see(view, doc):
            raise missing
        mine = doc.initiated_by == rep.id
        if not mine:
            store = rep_store(db, rep.id)
            mine = store is not None and store in (
                (doc.source_location_kind, doc.source_location_id),
                (doc.dest_location_kind, doc.dest_location_id))
        if not mine:
            raise missing
        header = _transfer_items(db, [doc])[0]
        rows = sorted(doc.lines, key=lambda ln: ln.id)
        if rows:
            pairs = [(ln.item_id, ln.quantity) for ln in rows]
        else:
            pairs = [(doc.item_id, doc.quantity)] if doc.item_id else []
        info = _item_info(db, (i for i, _ in pairs))
        lines = [_line(info, i, q, None, None, None) for i, q in pairs]

    return {"header": header, "lines": lines}
