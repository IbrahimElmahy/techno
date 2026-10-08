from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_STATS_VIEW
from src.core.db import get_db
from src.core.money import ZERO, to_money
from src.lib import reporting
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account
from src.models.loyalty import PointPurse
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.supplier import Supplier, SupplierAccount
from src.models.treasury import Treasury
from src.models.voucher import Voucher, VoucherKind
from src.services import (
    financial_reports_service,
    ledger_service,
    points_service,
    statement_service,
)

router = APIRouter(tags=["owner-stats"])


class MoneyBlock(BaseModel):
    count: int = 0
    total: Decimal = ZERO


class SalesBlock(BaseModel):
    invoices: MoneyBlock = MoneyBlock()
    returns: MoneyBlock = MoneyBlock()
    net: Decimal = ZERO


class ReceivablesBlock(BaseModel):
    due: Decimal = ZERO
    overdue: Decimal = ZERO
    debit_open: Decimal = ZERO
    credit_open: Decimal = ZERO
    current: Decimal = ZERO
    d30: Decimal = ZERO
    d60: Decimal = ZERO
    d90: Decimal = ZERO
    older: Decimal = ZERO


class TreasuryRow(BaseModel):
    id: int
    name: str
    balance: Decimal


class StatsOut(BaseModel):
    date_from: date | None = None
    date_to: date | None = None

    sales: SalesBlock = SalesBlock()
    purchases: SalesBlock = SalesBlock()

    income: Decimal = ZERO
    expenses: Decimal = ZERO
    net_profit: Decimal = ZERO

    total_assets: Decimal = ZERO
    total_liabilities: Decimal = ZERO
    total_equity: Decimal = ZERO
    balanced: bool = True

    treasuries: list[TreasuryRow] = []
    treasury_total: Decimal = ZERO
    receipts: Decimal = ZERO
    payments: Decimal = ZERO

    receivables: ReceivablesBlock = ReceivablesBlock()
    payables: ReceivablesBlock = ReceivablesBlock()

    stagnant_items: int = 0
    stagnant_value: Decimal = ZERO
    below_min: int = 0
    above_max: int = 0

    points_inspection: Decimal = ZERO
    points_coupon: Decimal = ZERO
    merchants_with_points: int = 0

    customers: int = 0
    suppliers: int = 0


def _doc_block(db: Session, model, date_col, amount_col, date_from, date_to) -> MoneyBlock:
    stmt = select(func.count(), func.coalesce(func.sum(amount_col), 0))
    if date_from:
        stmt = stmt.where(date_col >= date_from)
    if date_to:
        stmt = stmt.where(date_col <= date_to)
    count, total = db.execute(stmt).one()
    return MoneyBlock(count=int(count or 0), total=to_money(total))


def _voucher_total(db: Session, kind, date_from, date_to) -> Decimal:
    stmt = select(func.coalesce(func.sum(Voucher.amount), 0)).where(Voucher.kind == kind)
    if date_from:
        stmt = stmt.where(Voucher.voucher_date >= date_from)
    if date_to:
        stmt = stmt.where(Voucher.voucher_date <= date_to)
    return to_money(db.scalar(stmt))


def _party_block(db: Session, account_ids: list[int], as_of: date | None) -> ReceivablesBlock:
    if not account_ids:
        return ReceivablesBlock()
    due, overdue, aging = statement_service.due_summary(
        db, account_ids=account_ids, as_of=as_of)
    return ReceivablesBlock(
        due=due, overdue=overdue,
        debit_open=aging.debit_open, credit_open=aging.credit_open,
        current=aging.current, d30=aging.d30, d60=aging.d60, d90=aging.d90,
        older=aging.older,
    )


@router.get("/stats/overview", response_model=StatsOut)
def overview(
    date_from: date | None = None,
    date_to: date | None = None,
    _: CurrentUser = Depends(require_capability(CAP_STATS_VIEW)),
    db: Session = Depends(get_db),
) -> StatsOut:
    out = StatsOut(date_from=date_from, date_to=date_to)

    out.sales = SalesBlock(
        invoices=_doc_block(db, SalesInvoice, SalesInvoice.invoice_date,
                            SalesInvoice.net, date_from, date_to),
        returns=_doc_block(db, SalesReturn, SalesReturn.return_date,
                           SalesReturn.value, date_from, date_to),
    )
    out.sales.net = to_money(out.sales.invoices.total - out.sales.returns.total)

    out.purchases = SalesBlock(
        invoices=_doc_block(db, PurchaseInvoice, PurchaseInvoice.purchase_date,
                            PurchaseInvoice.total, date_from, date_to),
        returns=_doc_block(db, PurchaseReturn, PurchaseReturn.return_date,
                           PurchaseReturn.value, date_from, date_to),
    )
    out.purchases.net = to_money(out.purchases.invoices.total - out.purchases.returns.total)

    statement = financial_reports_service.income_statement(
        db, date_from=date_from, date_to=date_to)
    out.income = to_money(statement.total_income)
    out.expenses = to_money(statement.total_expenses)
    out.net_profit = to_money(statement.net_profit)

    sheet = financial_reports_service.balance_sheet(db, as_of=date_to)
    out.total_assets = to_money(sheet.total_assets)
    out.total_liabilities = to_money(sheet.total_liabilities)
    out.total_equity = to_money(sheet.total_equity)
    out.balanced = bool(sheet.balanced)

    out.treasuries = [
        TreasuryRow(id=t.id, name=t.name,
                    balance=to_money(ledger_service.balance_of(db, t.account_id))
                    if t.account_id else ZERO)
        for t in db.scalars(select(Treasury).order_by(Treasury.id)).all()
    ]
    out.treasury_total = to_money(sum((t.balance for t in out.treasuries), ZERO))
    out.receipts = _voucher_total(db, VoucherKind.receipt, date_from, date_to)
    out.payments = _voucher_total(db, VoucherKind.payment, date_from, date_to)

    customer_accounts = [a for (a,) in db.execute(
        select(CustomerAccount.account_id)).all() if a]
    supplier_accounts = [a for (a,) in db.execute(
        select(SupplierAccount.account_id)).all() if a]
    live = {a.id for a in db.scalars(
        select(Account).where(Account.reconcilable.is_(True))).all()}
    out.receivables = _party_block(db, [a for a in customer_accounts if a in live], date_to)
    out.payables = _party_block(db, [a for a in supplier_accounts if a in live], date_to)

    stagnant = reporting.stagnant_stock(db)
    out.stagnant_items = int(stagnant.get("item_count") or 0)
    out.stagnant_value = to_money(
        sum((Decimal(str(r.get("value") or 0)) for r in (stagnant.get("rows") or [])),
            Decimal("0")))
    order = reporting.reorder(db)
    out.below_min = len(order.get("below_min") or [])
    out.above_max = len(order.get("above_max") or [])

    inspection = points_service.balances(db, purse=PointPurse.inspection)
    coupon = points_service.balances(db, purse=PointPurse.coupon)
    out.points_inspection = to_money(sum(inspection.values(), Decimal("0")))
    out.points_coupon = to_money(sum(coupon.values(), Decimal("0")))
    out.merchants_with_points = len({c for c, v in inspection.items() if v})

    out.customers = int(db.scalar(select(func.count()).select_from(Customer)) or 0)
    out.suppliers = int(db.scalar(select(func.count()).select_from(Supplier)) or 0)
    return out
