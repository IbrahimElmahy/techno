from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, or_, select
from sqlalchemy.orm import Session

from src.auth.rbac import RoleName
from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.models.rep_efficiency import CustomerMonthlyCredit, EfficiencySetting, RepCreditAllowance
from src.models.sales import SalesInvoice, SalesReturn
from src.models.user import Role, User
from src.services.ledger_service import is_posted_sql

COLLECTION_TYPES = ("receipt", "sale", "sales_invoice", "journal")


def settings(db: Session) -> EfficiencySetting:
    row = db.scalar(select(EfficiencySetting).order_by(EfficiencySetting.id))
    if row is None:
        row = EfficiencySetting(allowed_debt_pct=Decimal("25"), penalty_per_thousand=Decimal("20"))
        db.add(row)
        db.flush()
    return row


def _by_rep(db: Session, stmt) -> dict[int, Decimal]:
    return {r: to_money(v or 0) for r, v in db.execute(stmt).all() if r is not None}


def _customer_filter(stmt, branch_id: int | None):
    stmt = stmt.where(Customer.rep_id.is_not(None))
    if branch_id is not None:
        stmt = stmt.where(Customer.branch_id == branch_id)
    return stmt


def _debt_at(db: Session, when: date, branch_id: int | None) -> dict[int, Decimal]:
    effective = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    signed = case((LedgerLine.direction == Account.normal_side, LedgerLine.amount),
                  else_=-LedgerLine.amount)
    stmt = (select(Customer.rep_id, func.sum(signed))
            .select_from(CustomerAccount)
            .join(Customer, Customer.id == CustomerAccount.customer_id)
            .join(LedgerLine, LedgerLine.account_id == CustomerAccount.account_id)
            .join(Account, Account.id == LedgerLine.account_id)
            .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
            .where(is_posted_sql(), effective <= when)
            .group_by(Customer.rep_id))
    return _by_rep(db, _customer_filter(stmt, branch_id))


def report(db: Session, *, year: int, month: int, branch_id: int | None,
           rep_id: int | None = None) -> dict:
    d1 = date(year, month, 1)
    d2 = date(year, month, calendar.monthrange(year, month)[1])
    days = (d2 - d1).days + 1
    cfg = settings(db)
    pct = Decimal(str(cfg.allowed_debt_pct))
    rate = Decimal(str(cfg.penalty_per_thousand))

    inv_date = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    sales = _by_rep(db, _customer_filter(
        select(Customer.rep_id, func.sum(SalesInvoice.net))
        .join(Customer, Customer.id == SalesInvoice.customer_id)
        .where(or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
               inv_date.between(d1, d2))
        .group_by(Customer.rep_id), branch_id))

    ret_date = func.coalesce(SalesReturn.return_date, cast(SalesReturn.created_at, Date))
    src_inv = select(SalesInvoice.customer_id).where(
        SalesInvoice.id == SalesReturn.sales_invoice_id).scalar_subquery()
    returns = _by_rep(db, _customer_filter(
        select(Customer.rep_id, func.sum(SalesReturn.value))
        .join(Customer, Customer.id == func.coalesce(SalesReturn.customer_id, src_inv))
        .where(SalesReturn.reversed_at.is_(None), ret_date.between(d1, d2))
        .group_by(Customer.rep_id), branch_id))

    effective = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    collected = _by_rep(db, _customer_filter(
        select(Customer.rep_id, func.sum(LedgerLine.amount))
        .select_from(CustomerAccount)
        .join(Customer, Customer.id == CustomerAccount.customer_id)
        .join(LedgerLine, LedgerLine.account_id == CustomerAccount.account_id)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(is_posted_sql(), LedgerLine.direction == Direction.credit,
               LedgerEntry.entry_type.in_(COLLECTION_TYPES), effective.between(d1, d2))
        .group_by(Customer.rep_id), branch_id))

    opening = _debt_at(db, d1 - timedelta(days=1), branch_id)
    closing = _debt_at(db, d2, branch_id)

    customer_credit = _by_rep(db, _customer_filter(
        select(Customer.rep_id, func.sum(CustomerMonthlyCredit.amount))
        .join(Customer, Customer.id == CustomerMonthlyCredit.customer_id)
        .group_by(Customer.rep_id), branch_id))
    rep_credit = {r: to_money(a) for r, a in db.execute(
        select(RepCreditAllowance.rep_user_id, RepCreditAllowance.amount)).all()}

    reps = set(sales) | set(returns) | set(collected) | set(closing) | set(opening)
    if rep_id is not None:
        reps &= {rep_id}
    names = {u.id: (u.full_name or u.username) for u in db.scalars(
        select(User).join(Role, Role.id == User.role_id)
        .where(User.id.in_(reps or {0}), Role.name == RoleName.sales_rep)).all()}
    reps &= set(names)

    rows = []
    for r in sorted(reps, key=lambda x: names.get(x, "")):
        net_sales = to_money(sales.get(r, ZERO) - returns.get(r, ZERO))
        debt = closing.get(r, ZERO)
        credit = rep_credit.get(r, customer_credit.get(r, ZERO))
        after_credit = to_money(debt - credit)
        allowed = to_money(net_sales * pct / 100) if net_sales > 0 else ZERO
        excess = to_money(max(after_credit - allowed, ZERO))
        base = opening.get(r, ZERO) + net_sales
        rows.append(dict(
            rep_user_id=r, rep_name=names.get(r, f"#{r}"),
            sales=sales.get(r, ZERO), returns=returns.get(r, ZERO), net_sales=net_sales,
            collected=collected.get(r, ZERO), opening_debt=opening.get(r, ZERO), debt=debt,
            credit=credit, credit_source="rep" if r in rep_credit else "customers",
            debt_after_credit=after_credit, allowed_debt=allowed, excess=excess,
            penalty=to_money(excess / 1000 * rate),
            collection_rate=(to_money(collected.get(r, ZERO) / base * 100) if base > 0 else None),
            dso=(to_money(debt / net_sales * days) if net_sales > 0 and debt > 0 else None),
        ))
    return dict(year=year, month=month, date_from=d1, date_to=d2, days=days,
                allowed_debt_pct=pct, penalty_per_thousand=rate, rows=rows)


def rep_customers(db: Session, rep_id: int, branch_id: int | None) -> list[dict]:
    stmt = (select(Customer.id, Customer.name, CustomerMonthlyCredit.amount)
            .outerjoin(CustomerMonthlyCredit, CustomerMonthlyCredit.customer_id == Customer.id)
            .where(Customer.rep_id == rep_id, Customer.active.is_(True)))
    if branch_id is not None:
        stmt = stmt.where(Customer.branch_id == branch_id)
    return [dict(customer_id=i, name=n, monthly_credit=to_money(a) if a is not None else None)
            for i, n, a in db.execute(stmt.order_by(Customer.name)).all()]
