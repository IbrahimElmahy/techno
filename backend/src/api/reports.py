from __future__ import annotations

import io
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SALES_READ, CAP_STOCK_READ
from src.core import clock
from src.core.db import get_db
from src.lib import reporting, stocktake, trade_reports
from src.models.ledger import Account, AccountType
from src.models.purchasing import PurchaseInvoice
from src.models.sales import SalesInvoice
from src.services import ledger_service

router = APIRouter(tags=["reports"], prefix="/reports")


@router.get("/production")
def production_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    period: str = Query("month"), product_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    return reporting.production_consumption(
        db, date_from=date_from, date_to=date_to, period=period, product_id=product_id)


@router.get("/inventory")
def inventory_report(
    warehouse_id: int | None = Query(None), item_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.inventory(db, warehouse_id=warehouse_id, item_id=item_id)


@router.get("/wastage")
def wastage_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    item_id: int | None = Query(None), warehouse_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.wastage(db, date_from=date_from, date_to=date_to, item_id=item_id,
                             warehouse_id=warehouse_id)


@router.get("/stagnant")
def stagnant_report(
    days: int = Query(90, ge=0), warehouse_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    return reporting.stagnant_stock(db, days=days, warehouse_id=warehouse_id)


@router.get("/trade")
def trade_report(
    doc_type: str = Query("sale", description="sale | sale_return | purchase | purchase_return"),
    level: str = Query("document", description="document | line"),
    group_by: str = Query("none", description="none | party | item | warehouse"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    party_id: int | None = Query(None),
    item_id: int | None = Query(None),
    warehouse_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    """Sales/purchase figures at any level and grouping, with profit where cost was captured.

    One endpoint covers what the legacy system spread over ~16 reports — see
    `src/lib/trade_reports.py` for why they are the same four shapes.
    """
    try:
        return trade_reports.trade(
            db, doc_type=doc_type, level=level, group_by=group_by,
            date_from=date_from, date_to=date_to, party_id=party_id,
            item_id=item_id, warehouse_id=warehouse_id,
        )
    except trade_reports.TradeReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/stock-as-of")
def stock_as_of_report(
    as_of: str | None = Query(None, description="ISO date; the stock as it stood that day"),
    warehouse_id: int | None = Query(None),
    item_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    """جرد حق تاريخ — every movement up to that day, nothing after it, valued at cost."""
    return stocktake.stock_as_of(db, as_of=as_of, warehouse_id=warehouse_id, item_id=item_id)


@router.get("/reorder")
def reorder_report(
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    """حد إعادة الطلب — items below their minimum or above their maximum stock (011)."""
    return reporting.reorder(db)


@router.get("/sales")
def sales_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    period: str = Query("month"),
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    return reporting.sales(db, date_from=date_from, date_to=date_to, period=period)


@router.get("/summary")
def get_summary(
    date_from: str | None = Query(None, description="ISO date; include docs on/after this day"),
    date_to: str | None = Query(None, description="ISO date; include docs on/before this day"),
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    def _apply_dates(stmt, col):
        if date_from:
            stmt = stmt.where(col >= clock.day_start_utc(date_from))
        if date_to:
            stmt = stmt.where(col < clock.day_end_utc(date_to))
        return stmt

    # Calculate total sales (optionally within the requested date range).
    sales_stmt = _apply_dates(select(
        func.sum(SalesInvoice.gross).label("gross"),
        func.sum(SalesInvoice.net).label("net")
    ), SalesInvoice.created_at)
    sales_res = db.execute(sales_stmt).first()
    sales_gross = sales_res.gross or Decimal("0")
    sales_net = sales_res.net or Decimal("0")

    # Calculate total purchases
    purchases_stmt = _apply_dates(select(
        func.sum(PurchaseInvoice.cash_amount + PurchaseInvoice.credit_amount).label("total")
    ), PurchaseInvoice.created_at)
    purchases_res = db.execute(purchases_stmt).first()
    purchases_total = purchases_res.total or Decimal("0")

    # Calculate treasury balance
    treasury_acc = db.scalar(select(Account).where(Account.account_type == AccountType.treasury))
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
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    output = io.StringIO()
    
    if report_type == "sales":
        output.write("رقم الفاتورة,كود العميل,الإجمالي قبل الخصم,الصافي بعد الخصم,المدفوع نقداً,المدفوع آجل\n")
        invoices = db.scalars(select(SalesInvoice)).all()
        for inv in invoices:
            output.write(f"{inv.document_number},{inv.customer_id},{inv.gross},{inv.net},{inv.cash_amount},{inv.credit_amount}\n")
            
    elif report_type == "purchases":
        output.write("رقم الفاتورة,كود المورد,المدفوع نقداً,المدفوع آجل\n")
        invoices = db.scalars(select(PurchaseInvoice)).all()
        for inv in invoices:
            output.write(f"{inv.document_number},{inv.supplier_id},{inv.cash_amount},{inv.credit_amount}\n")
            
    else: # treasury balance report
        output.write("كود الحساب,نوع الحساب,الرصيد المتاح\n")
        accounts = db.scalars(select(Account)).all()
        for acc in accounts:
            bal = ledger_service.balance_of(db, acc.id)
            output.write(f"{acc.id},{acc.account_type.value},{bal}\n")

    # Encode in UTF-8 with BOM for proper Arabic Excel compatibility
    csv_bytes = output.getvalue().encode('utf-8-sig')
    
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=report_{report_type}.csv"}
    )
