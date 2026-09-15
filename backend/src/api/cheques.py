"""Cheques + financial statements + aging router — 020-finance-reports."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_VOUCHER_READ, CAP_VOUCHER_WRITE
from src.core.db import get_db
from src.models.cheque import ChequeDirection, ChequeStatus
from src.models.role import RoleName
from src.services.report_options import ReportOptions
from src.services import (
    cash_flow_service,
    cheque_service,
    financial_reports_service,
    partner_ledger_service,
)
from src.services.cheque_service import ChequeError
from src.services.ledger_service import LedgerError
from src.services.treasury_service import TreasuryError
from src.services.voucher_service import VoucherError

router = APIRouter(tags=["cheques"])


class ChequeIn(BaseModel):
    direction: ChequeDirection
    cheque_number: str = Field(min_length=1, max_length=40)
    amount: Decimal
    due_date: date
    issue_date: date | None = None
    bank_name: str | None = Field(default=None, max_length=120)
    customer_id: int | None = None
    supplier_id: int | None = None
    treasury_id: int | None = None
    description: str | None = Field(default=None, max_length=255)


class ChequeSettleIn(BaseModel):
    settled_on: date | None = None
    treasury_id: int | None = None


class ChequeOut(BaseModel):
    id: int
    document_number: str
    direction: ChequeDirection
    status: ChequeStatus
    cheque_number: str
    bank_name: str | None
    amount: Decimal
    issue_date: date
    due_date: date
    customer_id: int | None
    supplier_id: int | None
    treasury_id: int | None
    description: str | None
    settled_on: date | None


class ReportLineOut(BaseModel):
    account_id: int
    code: str | None
    name: str | None
    amount: Decimal


class IncomeStatementOut(BaseModel):
    date_from: date | None
    date_to: date | None
    income: list[ReportLineOut]
    expenses: list[ReportLineOut]
    total_income: Decimal
    total_expenses: Decimal
    net_profit: Decimal
    # الخيارات المشتركة — نفس الشكل في كل تقرير.
    posted_only: bool = True
    comparison_label: str | None = None
    comparison: "IncomeStatementOut | None" = None


class BalanceSheetOut(BaseModel):
    as_of: date | None
    assets: list[ReportLineOut]
    liabilities: list[ReportLineOut]
    equity: list[ReportLineOut]
    total_assets: Decimal
    total_liabilities: Decimal
    total_equity: Decimal
    net_profit: Decimal
    balanced: bool
    posted_only: bool = True
    comparison_label: str | None = None
    comparison: "BalanceSheetOut | None" = None


class AgingRowOut(BaseModel):
    party_id: int
    party_name: str
    total: Decimal
    buckets: dict[str, Decimal]


def _out(c) -> ChequeOut:
    return ChequeOut(
        id=c.id, document_number=c.document_number, direction=c.direction, status=c.status,
        cheque_number=c.cheque_number, bank_name=c.bank_name, amount=c.amount,
        issue_date=c.issue_date, due_date=c.due_date, customer_id=c.customer_id,
        supplier_id=c.supplier_id, treasury_id=c.treasury_id, description=c.description,
        settled_on=c.settled_on,
    )


def _lines(rows) -> list[ReportLineOut]:
    return [ReportLineOut(account_id=r.account_id, code=r.code, name=r.name, amount=r.amount)
            for r in rows]


def _conflict(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT,
                         {"code": "cheque_invalid", "message": str(exc)})


def _office_only(current: CurrentUser) -> None:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "الشيكات من المكتب فقط."})


@router.post("/cheques", response_model=ChequeOut, status_code=status.HTTP_201_CREATED)
def register_cheque(
    body: ChequeIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> ChequeOut:
    """تسجيل شيك وارد من عميل أو صادر لمورد — القيمة تدخل حساب الشيكات لا الخزينة."""
    _office_only(current)
    try:
        c = cheque_service.register_cheque(
            db, direction=body.direction, cheque_number=body.cheque_number,
            amount=body.amount, due_date=body.due_date, issue_date=body.issue_date,
            bank_name=body.bank_name, customer_id=body.customer_id,
            supplier_id=body.supplier_id, treasury_id=body.treasury_id,
            description=body.description, actor_user_id=current.id)
    except (ChequeError, VoucherError, TreasuryError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(c)


@router.post("/cheques/{cheque_id}/settle", response_model=ChequeOut)
def settle_cheque(
    cheque_id: int,
    body: ChequeSettleIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> ChequeOut:
    """تحصيل شيك وارد أو صرف شيك صادر."""
    _office_only(current)
    try:
        c = cheque_service.settle_cheque(
            db, cheque_id=cheque_id, actor_user_id=current.id, settled_on=body.settled_on,
            treasury_id=body.treasury_id)
    except (ChequeError, TreasuryError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(c)


@router.post("/cheques/{cheque_id}/bounce", response_model=ChequeOut)
def bounce_cheque(
    cheque_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> ChequeOut:
    """ارتداد شيك وارد — الدين يرجع على العميل."""
    _office_only(current)
    try:
        c = cheque_service.bounce_cheque(db, cheque_id=cheque_id, actor_user_id=current.id)
    except (ChequeError, VoucherError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(c)


@router.post("/cheques/{cheque_id}/unsettle", response_model=ChequeOut)
def unsettle_cheque(
    cheque_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> ChequeOut:
    """عكس تحصيل/صرف شيك — القيمة ترجع للحساب الوسيط والشيك يرجع تحت التحصيل."""
    _office_only(current)
    try:
        c = cheque_service.unsettle_cheque(db, cheque_id=cheque_id, actor_user_id=current.id)
    except (ChequeError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(c)


@router.post("/cheques/{cheque_id}/cancel", response_model=ChequeOut)
def cancel_cheque(
    cheque_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> ChequeOut:
    _office_only(current)
    try:
        c = cheque_service.cancel_cheque(db, cheque_id=cheque_id, actor_user_id=current.id)
    except (ChequeError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(c)


@router.get("/cheques", response_model=list[ChequeOut])
def list_cheques(
    direction: ChequeDirection | None = Query(default=None),
    status_filter: ChequeStatus | None = Query(default=None, alias="status"),
    customer_id: int | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    due_from: date | None = Query(default=None),
    due_to: date | None = Query(default=None),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[ChequeOut]:
    rows = cheque_service.list_cheques(
        db, direction=direction, status=status_filter, customer_id=customer_id,
        supplier_id=supplier_id, due_from=due_from, due_to=due_to)
    return [_out(c) for c in rows]


@router.get("/reports/income-statement", response_model=IncomeStatementOut)
def income_statement(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    # سلوك تقارير أودو المشترك — نفس الخيارين في كل تقرير بنفس المعنى.
    posted_only: bool = Query(default=True),
    comparison: str = Query(default="none", pattern="^(none|previous|last_year)$"),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> IncomeStatementOut:
    """قائمة الدخل — مع عمود مقارنة اختياري."""
    options = ReportOptions(date_from=date_from, date_to=date_to,
                            posted_only=posted_only, comparison=comparison)
    # مدير الفرع بيشوف قائمة دخل فرعه. المستندات مفلترة من زمان، والتقرير كان
    # لسه بيجمّع على الشركة كلها — يعني رقم مش بتاعه على شاشته.
    both = financial_reports_service.income_statement_compared(
        db, options, branch_id=branch_scope.visible_branch_id(current))
    s = both["current"]
    prev = both["comparison"]
    return IncomeStatementOut(
        date_from=s.date_from, date_to=s.date_to, income=_lines(s.income),
        expenses=_lines(s.expenses), total_income=s.total_income,
        total_expenses=s.total_expenses, net_profit=s.net_profit,
        posted_only=posted_only,
        comparison_label=both["comparison_label"],
        comparison=(IncomeStatementOut(
            date_from=prev.date_from, date_to=prev.date_to, income=_lines(prev.income),
            expenses=_lines(prev.expenses), total_income=prev.total_income,
            total_expenses=prev.total_expenses, net_profit=prev.net_profit,
        ) if prev else None),
    )


@router.get("/reports/balance-sheet", response_model=BalanceSheetOut)
def balance_sheet(
    as_of: date | None = Query(default=None),
    posted_only: bool = Query(default=True),
    comparison: str = Query(default="none", pattern="^(none|previous|last_year)$"),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> BalanceSheetOut:
    """الميزانية / المركز المالي — مع عمود مقارنة اختياري."""
    options = ReportOptions(date_to=as_of, posted_only=posted_only, comparison=comparison)
    both = financial_reports_service.balance_sheet_compared(
        db, options, branch_id=branch_scope.visible_branch_id(current))
    s = both["current"]
    prev = both["comparison"]

    def out(x: object) -> BalanceSheetOut:
        return BalanceSheetOut(
            as_of=x.as_of, assets=_lines(x.assets), liabilities=_lines(x.liabilities),
            equity=_lines(x.equity), total_assets=x.total_assets,
            total_liabilities=x.total_liabilities, total_equity=x.total_equity,
            net_profit=x.net_profit, balanced=x.balanced,
        )

    result = out(s)
    result.posted_only = posted_only
    result.comparison_label = both["comparison_label"]
    result.comparison = out(prev) if prev else None
    return result


@router.get("/reports/aging", response_model=list[AgingRowOut])
def aging(
    party: str = Query(default="customers", pattern="^(customers|suppliers)$"),
    as_of: date | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[AgingRowOut]:
    """أعمار الديون — عملاء أو موردين."""
    branch_id = branch_scope.visible_branch_id(current)
    rows = (financial_reports_service.receivables_aging(db, as_of=as_of, branch_id=branch_id)
            if party == "customers"
            else financial_reports_service.payables_aging(db, as_of=as_of, branch_id=branch_id))
    return [AgingRowOut(party_id=r.party_id, party_name=r.party_name, total=r.total,
                        buckets=r.buckets) for r in rows]


# ------------------------------------------------- دفتر الشريك (المرحلة ٤ — موديل أودو)


class PartnerLedgerLineOut(BaseModel):
    line_id: int
    entry_id: int
    entry_number: str | None = None
    entry_date: date
    date_maturity: date | None = None
    journal_code: str | None = None
    move_type: str | None = None
    move_type_label: str | None = None
    account_id: int
    account_code: str | None = None
    account_name: str | None = None
    description: str = ""
    statement: str | None = None
    debit: Decimal
    credit: Decimal
    balance: Decimal
    residual: Decimal | None = None
    reconcile_number: str | None = None


class PartnerLedgerRowOut(BaseModel):
    partner_kind: str
    partner_id: int
    partner_name: str
    opening: Decimal
    debit: Decimal
    credit: Decimal
    closing: Decimal
    open_residual: Decimal
    lines: list[PartnerLedgerLineOut]


@router.get("/reports/partner-ledger", response_model=list[PartnerLedgerRowOut])
def partner_ledger(
    partner_kind: str | None = Query(default=None, pattern="^(customer|supplier|employee)$"),
    partner_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    only_open: bool = Query(default=False),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[PartnerLedgerRowOut]:
    """دفتر الشريك — حركة كل طرف في الفترة برصيد جاري ومتبقّي كل سطر."""
    rows = partner_ledger_service.partner_ledger(
        db, partner_kind=partner_kind, partner_id=partner_id,
        date_from=date_from, date_to=date_to, only_open=only_open)
    return [
        PartnerLedgerRowOut(
            partner_kind=r.partner_kind, partner_id=r.partner_id,
            partner_name=r.partner_name, opening=r.opening, debit=r.debit,
            credit=r.credit, closing=r.closing, open_residual=r.open_residual,
            lines=[PartnerLedgerLineOut(**vars(ln)) for ln in r.lines],
        )
        for r in rows
    ]


# --------------------------------------------- التدفق النقدي (المرحلة ٤ — موديل أودو)


class CashFlowLineOut(BaseModel):
    account_id: int | None = None
    code: str | None = None
    name: str | None = None
    inflow: Decimal
    outflow: Decimal
    net: Decimal


class CashFlowSectionOut(BaseModel):
    key: str
    label: str
    net: Decimal
    lines: list[CashFlowLineOut]


class CashFlowOut(BaseModel):
    date_from: date | None = None
    date_to: date | None = None
    opening: Decimal
    closing: Decimal
    net_change: Decimal
    consistent: bool
    sections: list[CashFlowSectionOut]


@router.get("/reports/cash-flow", response_model=CashFlowOut)
def cash_flow(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> CashFlowOut:
    """التدفق النقدي — حركة الخزن والبنوك منسوبة لحسابها المقابل."""
    s = cash_flow_service.cash_flow(db, date_from=date_from, date_to=date_to)
    return CashFlowOut(
        date_from=s.date_from, date_to=s.date_to, opening=s.opening, closing=s.closing,
        net_change=s.net_change, consistent=s.consistent,
        sections=[
            CashFlowSectionOut(
                key=sec.key, label=sec.label, net=sec.net,
                lines=[CashFlowLineOut(**vars(ln)) for ln in sec.lines],
            )
            for sec in s.sections
        ],
    )
