from __future__ import annotations

from decimal import Decimal
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.orm import Session
import io

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SALES_READ
from src.core.db import get_db
from src.models.sales import SalesInvoice
from src.models.purchasing import PurchaseInvoice
from src.models.ledger import Account, AccountType
from src.services import ledger_service

router = APIRouter(tags=["reports"], prefix="/reports")


@router.get("/summary")
def get_summary(
    _: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    # Calculate total sales
    sales_stmt = select(
        func.sum(SalesInvoice.gross).label("gross"),
        func.sum(SalesInvoice.net).label("net")
    )
    sales_res = db.execute(sales_stmt).first()
    sales_gross = sales_res.gross or Decimal("0")
    sales_net = sales_res.net or Decimal("0")

    # Calculate total purchases
    purchases_stmt = select(
        func.sum(PurchaseInvoice.cash_amount + PurchaseInvoice.credit_amount).label("total")
    )
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
