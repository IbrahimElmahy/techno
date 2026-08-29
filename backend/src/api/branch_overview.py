"""نظرة مدير الشركة على الفروع — كل فرع بأرقامه، جنب بعض.

الشاشات كلها بتتفلتر بفرع اللي بيسأل، وده صح: مدير الفرع بيشوف فرعه. لكنه بيخلّي مدير
الشركة من غير أي مكان يقارن فيه — عنده كل الصلاحيات فبيشوف مجموع الشركة كرقم واحد، وهو
عايز يعرف الفرع اللي واقف والفرع اللي ماشي.

فده المسار الوحيد في النظام اللي **بيكسر العزل عن قصد**: بيرجّع الفروع كلها كصفوف، مش
مجموعها. ومقفول على مدير النظام وحده — لو أي دور تاني وصله، العزل كله بيبقى شكل.

مافيش تفاصيل مستندات هنا، أرقام مجمّعة بس. اللي عايز يفتح فاتورة بيروح لشاشتها.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.core.money import to_money
from src.models.customer import Customer
from src.models.org import Branch
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice, SalesReturn
from src.models.transfer import StockTransfer
from src.models.user import User
from src.models.voucher import Voucher, VoucherKind

router = APIRouter(tags=["branch-overview"])


def _admin_only(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "الشاشة دي لمدير الشركة وحده."})
    return current


class BranchRow(BaseModel):
    branch_id: int | None
    branch_name: str
    # المبيعات
    sales_count: int
    sales_net: str
    sales_cash: str
    sales_credit: str
    # المرتجعات
    returns_count: int
    returns_value: str
    # المشتريات
    purchases_count: int
    purchases_net: str
    purchase_returns_count: int
    # الحركة
    transfers_count: int
    receipts_total: str
    payments_total: str
    # الناس
    users_count: int
    reps_count: int
    customers_count: int


class OverviewOut(BaseModel):
    date_from: date | None
    date_to: date | None
    rows: list[BranchRow]


def _sum_by_branch(db: Session, model, column, *, where=None, date_col=None,
                   date_from=None, date_to=None) -> dict:
    stmt = select(model.branch_id, func.count(), func.coalesce(func.sum(column), 0))
    if where is not None:
        stmt = stmt.where(where)
    if date_col is not None and date_from:
        stmt = stmt.where(date_col >= date_from)
    if date_col is not None and date_to:
        stmt = stmt.where(date_col <= date_to)
    return {b: (n, v) for b, n, v in db.execute(stmt.group_by(model.branch_id)).all()}


def _count_by_branch(db: Session, model, where=None) -> dict:
    stmt = select(model.branch_id, func.count())
    if where is not None:
        stmt = stmt.where(where)
    return dict(db.execute(stmt.group_by(model.branch_id)).all())


@router.get("/branch-overview", response_model=OverviewOut)
def branch_overview(
    date_from: date | None = None,
    date_to: date | None = None,
    _: CurrentUser = Depends(_admin_only),
    db: Session = Depends(get_db),
) -> OverviewOut:
    branches = {b.id: b.name for b in db.scalars(select(Branch).order_by(Branch.id)).all()}

    sales = _sum_by_branch(db, SalesInvoice, SalesInvoice.net,
                           date_col=SalesInvoice.created_at,
                           date_from=date_from, date_to=date_to)
    cash = _sum_by_branch(db, SalesInvoice, SalesInvoice.cash_amount,
                          date_col=SalesInvoice.created_at,
                          date_from=date_from, date_to=date_to)
    credit = _sum_by_branch(db, SalesInvoice, SalesInvoice.credit_amount,
                            date_col=SalesInvoice.created_at,
                            date_from=date_from, date_to=date_to)
    rets = _sum_by_branch(db, SalesReturn, SalesReturn.value,
                          where=SalesReturn.reversed_at.is_(None),
                          date_col=SalesReturn.created_at,
                          date_from=date_from, date_to=date_to)
    purch = _sum_by_branch(db, PurchaseInvoice, PurchaseInvoice.net,
                           date_col=PurchaseInvoice.created_at,
                           date_from=date_from, date_to=date_to)
    prets = _count_by_branch(db, PurchaseReturn, PurchaseReturn.reversed_at.is_(None))
    transfers = _count_by_branch(db, StockTransfer)
    receipts = _sum_by_branch(db, Voucher, Voucher.amount,
                              where=Voucher.kind == VoucherKind.receipt,
                              date_col=Voucher.voucher_date,
                              date_from=date_from, date_to=date_to)
    payments = _sum_by_branch(db, Voucher, Voucher.amount,
                              where=Voucher.kind == VoucherKind.payment,
                              date_col=Voucher.voucher_date,
                              date_from=date_from, date_to=date_to)
    users = _count_by_branch(db, User, User.active.is_(True))
    customers = _count_by_branch(db, Customer)

    # عدد المندوبين — استعلام لوحده لأنه بيمرّ بجدول الأدوار.
    rep_role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
    reps = dict(db.execute(
        select(User.branch_id, func.count())
        .where(User.role_id == rep_role.id, User.active.is_(True))
        .group_by(User.branch_id)).all()) if rep_role else {}

    # كل فرع + سطر لـ«بلا فرع» لو فيه مستندات قديمة ماتعبّتش.
    keys: list[int | None] = list(branches.keys())
    seen_null = any(None in d for d in (sales, rets, purch, transfers, users, customers))
    if seen_null:
        keys.append(None)

    rows = []
    for b in keys:
        s_n, s_v = sales.get(b, (0, 0))
        rows.append(BranchRow(
            branch_id=b,
            branch_name=branches.get(b, "بلا فرع") if b else "بلا فرع",
            sales_count=s_n, sales_net=str(to_money(s_v)),
            sales_cash=str(to_money(cash.get(b, (0, 0))[1])),
            sales_credit=str(to_money(credit.get(b, (0, 0))[1])),
            returns_count=rets.get(b, (0, 0))[0],
            returns_value=str(to_money(rets.get(b, (0, 0))[1])),
            purchases_count=purch.get(b, (0, 0))[0],
            purchases_net=str(to_money(purch.get(b, (0, 0))[1])),
            purchase_returns_count=prets.get(b, 0),
            transfers_count=transfers.get(b, 0),
            receipts_total=str(to_money(receipts.get(b, (0, 0))[1])),
            payments_total=str(to_money(payments.get(b, (0, 0))[1])),
            users_count=users.get(b, 0),
            reps_count=reps.get(b, 0),
            customers_count=customers.get(b, 0),
        ))
    return OverviewOut(date_from=date_from, date_to=date_to, rows=rows)
