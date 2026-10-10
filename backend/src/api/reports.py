from __future__ import annotations

import io
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_ACCOUNTING_TRIAL_BALANCE_READ, CAP_SALES_READ, CAP_STOCK_READ
from src.core.db import get_db
from src.lib import (health, ledger_analysis, report_statement, reporting, stock_analysis,
                     stocktake, trade_analysis, trade_reports)
from src.models.customer import Customer
from src.models.ledger import Account, AccountType
from src.models.purchasing import PurchaseInvoice
from src.models.sales import SalesInvoice
from src.models.supplier import Supplier
from src.services import ledger_service
from src.auth import branch_scope

router = APIRouter(tags=["reports"], prefix="/reports")


@router.get("/production")
def production_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    period: str = Query("month"), product_id: int | None = Query(None),
    statement: str | None = Query(None, description="البيان — جزء من النص، مع توحيد الهمزات"),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    return reporting.production_consumption(
        db, date_from=date_from, date_to=date_to, period=period, product_id=product_id,
        statement=statement, branch_id=branch_scope.visible_branch_id(current))


@router.get("/inventory")
def inventory_report(
    warehouse_id: int | None = Query(None), item_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.inventory(db, warehouse_id=warehouse_id, item_id=item_id,
                               branch_id=branch_scope.visible_branch_id(current))


@router.get("/wastage")
def wastage_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    item_id: int | None = Query(None), warehouse_id: int | None = Query(None),
    statement: str | None = Query(None, description="البيان — جزء من النص، مع توحيد الهمزات"),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.wastage(db, date_from=date_from, date_to=date_to, item_id=item_id,
                             warehouse_id=warehouse_id, statement=statement,
                             branch_id=branch_scope.visible_branch_id(current))


@router.get("/stagnant")
def stagnant_report(
    days: int = Query(90, ge=0), warehouse_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.stagnant_stock(db, days=days, warehouse_id=warehouse_id,
                                    branch_id=branch_scope.visible_branch_id(current))


@router.get("/trade")
def trade_report(
    doc_type: str = Query("sale", description="sale | sale_return | purchase | purchase_return"),
    level: str = Query("document", description="document | line"),
    group_by: str = Query(
        "none",
        description="none | party | item | warehouse | category | main_category"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    party_id: int | None = Query(None),
    item_id: int | None = Query(None),
    warehouse_id: int | None = Query(None),
    statement: str | None = Query(None, description="البيان — جزء من النص، مع توحيد الهمزات"),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    try:
        return trade_reports.trade(
            db, doc_type=doc_type, level=level, group_by=group_by,
            date_from=date_from, date_to=date_to, party_id=party_id,
            item_id=item_id, warehouse_id=warehouse_id, statement=statement,
            branch_id=branch_scope.visible_branch_id(current),
        )
    except trade_reports.TradeReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/analysis")
def trade_analysis_report(
    side: str = Query("sales", description="sales | purchases"),
    dims: str | None = Query(None, description="أبعاد التجميع مفصولة بفاصلة"),
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    branch_id: str | None = Query(None), warehouse_id: str | None = Query(None),
    party_id: str | None = Query(None), party_type: str | None = Query(None),
    rep_id: str | None = Query(None), territory_id: str | None = Query(None),
    governorate_id: str | None = Query(None), item_id: str | None = Query(None),
    category: str | None = Query(None), price_tier: str | None = Query(None),
    kind: str | None = Query(None, description="sale | return"),
    include_bonus: bool = Query(True),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    scoped = branch_scope.visible_branch_id(current)
    try:
        return trade_analysis.analyse(
            db, side=side, dims=[d.strip() for d in (dims or "").split(",") if d.strip()],
            date_from=date_from, date_to=date_to,
            branch_id=scoped if scoped is not None else branch_id,
            warehouse_id=warehouse_id, party_id=party_id, party_type=party_type,
            rep_id=rep_id, territory_id=territory_id, governorate_id=governorate_id,
            item_id=item_id, category=category, price_tier=price_tier, kind=kind,
            include_bonus=include_bonus)
    except trade_analysis.TradeAnalysisError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/stock-analysis")
def stock_analysis_report(
    dims: str | None = Query(None),
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    branch_id: str | None = Query(None), warehouse_id: str | None = Query(None),
    item_id: str | None = Query(None), category: str | None = Query(None),
    include_custody: bool = Query(False), hide_zero: bool = Query(True),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    scoped = branch_scope.visible_branch_id(current)
    try:
        return stock_analysis.analyse(
            db, dims=[d.strip() for d in (dims or "").split(",") if d.strip()],
            date_from=date_from, date_to=date_to,
            branch_id=scoped if scoped is not None else branch_id,
            warehouse_id=warehouse_id, item_id=item_id, category=category,
            include_custody=include_custody, hide_zero=hide_zero)
    except stock_analysis.StockAnalysisError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/ledger-analysis")
def ledger_analysis_report(
    dims: str | None = Query(None),
    date_from: date | None = Query(None), date_to: date | None = Query(None),
    branch_id: str | None = Query(None), account_id: str | None = Query(None),
    account_type: str | None = Query(None), party_kind: str | None = Query(None),
    party_id: str | None = Query(None), territory_id: str | None = Query(None),
    rep_id: str | None = Query(None), cost_center_id: str | None = Query(None),
    nonzero: bool = Query(True), posted_only: bool = Query(True),
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_TRIAL_BALANCE_READ)),
    db: Session = Depends(get_db),
):
    scoped = branch_scope.visible_branch_id(current)
    try:
        return ledger_analysis.analyse(
            db, dims=[d.strip() for d in (dims or "").split(",") if d.strip()],
            date_from=date_from, date_to=date_to,
            branch_id=scoped if scoped is not None else branch_id,
            account_id=account_id, account_type=account_type, party_kind=party_kind,
            party_id=party_id, territory_id=territory_id, rep_id=rep_id,
            cost_center_id=cost_center_id, nonzero=nonzero, posted_only=posted_only)
    except ledger_analysis.LedgerAnalysisError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/stock-as-of")
def stock_as_of_report(
    as_of: str | None = Query(None, description="ISO date; the stock as it stood that day"),
    date_to: str | None = Query(None, description="Alias for as_of — the day the balance is read"),
    warehouse_id: int | None = Query(None),
    item_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return stocktake.stock_as_of(db, as_of=date_to or as_of,
                                 warehouse_id=warehouse_id, item_id=item_id,
                                 branch_id=branch_scope.visible_branch_id(current))


@router.get("/stock-value")
def stock_value_report(
    warehouse_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.stock_value(db, warehouse_id=warehouse_id,
                                 branch_id=branch_scope.visible_branch_id(current))


@router.get("/reorder")
def reorder_report(
    include_all: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.reorder(db, branch_id=branch_scope.visible_branch_id(current),
                             include_all=include_all)


@router.get("/sales")
def sales_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    period: str = Query("month"),
    statement: str | None = Query(None, description="البيان — جزء من النص، مع توحيد الهمزات"),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    return reporting.sales(db, date_from=date_from, date_to=date_to, period=period,
                           statement=statement, branch_id=branch_scope.visible_branch_id(current))


@router.get("/summary")
def get_summary(
    date_from: str | None = Query(None, description="ISO date; include docs on/after this day"),
    date_to: str | None = Query(None, description="ISO date; include docs on/before this day"),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    d_from = date.fromisoformat(str(date_from)[:10]) if date_from else None
    d_to = date.fromisoformat(str(date_to)[:10]) if date_to else None

    def _apply_dates(stmt, doc_date, created):
        when = func.coalesce(doc_date, cast(created, Date))
        if d_from:
            stmt = stmt.where(when >= d_from)
        if d_to:
            stmt = stmt.where(when <= d_to)
        return stmt

    sales_stmt = _apply_dates(branch_scope.scope(select(
        func.sum(SalesInvoice.gross).label("gross"),
        func.sum(SalesInvoice.net).label("net")
    ), SalesInvoice, current), SalesInvoice.invoice_date, SalesInvoice.created_at)
    sales_res = db.execute(sales_stmt).first()
    sales_gross = sales_res.gross or Decimal("0")
    sales_net = sales_res.net or Decimal("0")

    purchases_stmt = _apply_dates(branch_scope.scope(select(
        func.sum(PurchaseInvoice.cash_amount + PurchaseInvoice.credit_amount).label("total")
    ), PurchaseInvoice, current), PurchaseInvoice.purchase_date, PurchaseInvoice.created_at)
    purchases_res = db.execute(purchases_stmt).first()
    purchases_total = purchases_res.total or Decimal("0")

    treasury_acc = db.scalar(branch_scope.scope(
        select(Account).where(Account.account_type == AccountType.treasury),
        Account, current))
    treasury_balance = Decimal("0")
    if treasury_acc:
        treasury_balance = ledger_service.balance_of(db, treasury_acc.id)

    return {
        "sales_gross": sales_gross,
        "sales_net": sales_net,
        "purchases_total": purchases_total,
        "treasury_balance": treasury_balance,
    }


@router.get("/export")
def export_report(
    report_type: str = Query(..., description="Type of report: sales, purchases, treasury"),
    date_from: date | None = Query(None, description="تاريخ المستند من"),
    date_to: date | None = Query(None, description="تاريخ المستند إلى"),
    statement: str | None = Query(None, description="البيان — جزء من النص"),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    output = io.StringIO()
    wanted = report_statement.needle(statement)

    def _csv(*values) -> str:
        return ",".join('"' + str("" if v is None else v).replace('"', '""') + '"'
                        for v in values) + "\n"

    def _window(stmt, doc_date):
        if date_from:
            stmt = stmt.where(doc_date >= date_from)
        if date_to:
            stmt = stmt.where(doc_date <= date_to)
        return stmt

    if report_type == "sales":
        names = dict(db.execute(select(Customer.id, Customer.name)).all())
        output.write(_csv("رقم الفاتورة", "التاريخ", "العميل", "البيان", "الإجمالي قبل الخصم",
                          "الصافي بعد الخصم", "المدفوع نقداً", "المدفوع آجل"))
        doc_date = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
        invoices = db.scalars(_window(
            branch_scope.scope(select(SalesInvoice), SalesInvoice, current), doc_date)
            .order_by(doc_date.desc(), SalesInvoice.id.desc())).all()
        for inv in invoices:
            if not report_statement.matches_obj(inv, wanted):
                continue
            output.write(_csv(inv.document_number, inv.invoice_date or inv.created_at.date(),
                              names.get(inv.customer_id, ""), report_statement.text_of(inv),
                              inv.gross, inv.net, inv.cash_amount, inv.credit_amount))

    elif report_type == "purchases":
        names = dict(db.execute(select(Supplier.id, Supplier.name)).all())
        output.write(_csv("رقم الفاتورة", "التاريخ", "المورد", "البيان",
                          "المدفوع نقداً", "المدفوع آجل"))
        doc_date = func.coalesce(PurchaseInvoice.purchase_date,
                                 cast(PurchaseInvoice.created_at, Date))
        invoices = db.scalars(_window(
            branch_scope.scope(select(PurchaseInvoice), PurchaseInvoice, current), doc_date)
            .order_by(doc_date.desc(), PurchaseInvoice.id.desc())).all()
        for inv in invoices:
            if not report_statement.matches_obj(inv, wanted):
                continue
            output.write(_csv(inv.document_number, inv.purchase_date or inv.created_at.date(),
                              names.get(inv.supplier_id, ""), report_statement.text_of(inv),
                              inv.cash_amount, inv.credit_amount))

    else:
        from src.services import chart_service

        output.write(_csv("رقم الحساب", "اسم الحساب", "المجموعة", "الرصيد المتاح"))
        accounts = db.scalars(branch_scope.scope(select(Account), Account, current)).all()
        owners = chart_service.bulk_owner_names(db, list(accounts))
        for acc in accounts:
            bal = ledger_service.balance_of(db, acc.id)
            output.write(_csv(acc.code or "", acc.name or owners.get(acc.id) or "",
                              chart_service.owner_group_label(acc.account_type) or "", bal))

    csv_bytes = output.getvalue().encode('utf-8-sig')
    
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=report_{report_type}.csv"}
    )


@router.get("/health")
def system_health(
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    return health.run_all(db, branch_id=branch_scope.visible_branch_id(current))
