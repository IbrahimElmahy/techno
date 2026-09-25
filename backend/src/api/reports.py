from __future__ import annotations

import io
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SALES_READ, CAP_STOCK_READ
from src.core.db import get_db
from src.lib import health, report_statement, reporting, stocktake, trade_reports
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
    statement: str | None = Query(None, description="البيان — جزء من الكلام، بتوحيد الهمزات"),
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
    # مخازن الفرع بس — المخازن نفسها مفلترة، والجرد كان بيجمّع عليها كلها.
    return reporting.inventory(db, warehouse_id=warehouse_id, item_id=item_id,
                               branch_id=branch_scope.visible_branch_id(current))


@router.get("/wastage")
def wastage_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    item_id: int | None = Query(None), warehouse_id: int | None = Query(None),
    statement: str | None = Query(None, description="البيان — جزء من الكلام، بتوحيد الهمزات"),
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
    statement: str | None = Query(None, description="البيان — جزء من الكلام، بتوحيد الهمزات"),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
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
            item_id=item_id, warehouse_id=warehouse_id, statement=statement,
            # مستندات الفرع بس — المستندات نفسها مفلترة من زمان في سجلاتها،
            # والتقرير كان لسه بيجمّع عليها كلها.
            branch_id=branch_scope.visible_branch_id(current),
        )
    except trade_reports.TradeReportError as exc:
        raise HTTPException(422, {"code": "report_invalid", "message": str(exc)}) from exc


@router.get("/stock-as-of")
def stock_as_of_report(
    as_of: str | None = Query(None, description="ISO date; the stock as it stood that day"),
    # (031) جرد من تاريخ إلى تاريخ. `date_to` is the day the balance is read at — an alias for
    # `as_of`, kept so callers that already use `as_of` are untouched.
    #
    # There is deliberately NO `date_from` here. A balance is a running total to a moment; summing
    # only the movements INSIDE a window gives net movement over it, which is a different number
    # and not a stocktake. The «من» date scopes the movement history a row drills into, and lives
    # on the screen that asks for it.
    date_to: str | None = Query(None, description="Alias for as_of — the day the balance is read"),
    warehouse_id: int | None = Query(None),
    item_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    """جرد حق تاريخ — every movement up to that day, nothing after it, valued at cost."""
    return stocktake.stock_as_of(db, as_of=date_to or as_of,
                                 warehouse_id=warehouse_id, item_id=item_id,
                                 branch_id=branch_scope.visible_branch_id(current))


@router.get("/reorder")
def reorder_report(
    current: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
):
    """حد إعادة الطلب — items below their minimum or above their maximum stock (011)."""
    return reporting.reorder(db, branch_id=branch_scope.visible_branch_id(current))


@router.get("/sales")
def sales_report(
    date_from: str | None = Query(None), date_to: str | None = Query(None),
    period: str = Query("month"),
    statement: str | None = Query(None, description="البيان — جزء من الكلام، بتوحيد الهمزات"),
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
    """أرقام الرئيسية الكبيرة — **وبفرع اللي بيقرا**.

    التلات أرقام دي (مبيعات، مشتريات، خزنة) كانت بتتحسب على الشركة كلها، فمدير فرع
    بيفتح الرئيسية فيلاقي إيراد الشركة كلها قدامه — رقم مش بتاعه، وبيخلّي أي مقارنة
    يعملها بفرعه غلط كمان.
    """
    # **بتاريخ المستند، مش بوقت كتابته.** `created_at` في الفواتير المنقولة من a5 هو يومين
    # النقل نفسهم، فأرقام «الشهر ده» في الرئيسية كانت بتلمّ شغل سنة كاملة أو ترجع صفر —
    # نفس الغلط اللي اتصلّح في تقارير المبيعات (`trade_reports`) من زمان. الفاتورة من غير
    # تاريخ بترجع لتاريخ كتابتها بدل ما تقع من الرقم.
    d_from = date.fromisoformat(str(date_from)[:10]) if date_from else None
    d_to = date.fromisoformat(str(date_to)[:10]) if date_to else None

    def _apply_dates(stmt, doc_date, created):
        when = func.coalesce(doc_date, cast(created, Date))
        if d_from:
            stmt = stmt.where(when >= d_from)
        if d_to:
            stmt = stmt.where(when <= d_to)
        return stmt

    # Calculate total sales (optionally within the requested date range).
    sales_stmt = _apply_dates(branch_scope.scope(select(
        func.sum(SalesInvoice.gross).label("gross"),
        func.sum(SalesInvoice.net).label("net")
    ), SalesInvoice, current), SalesInvoice.invoice_date, SalesInvoice.created_at)
    sales_res = db.execute(sales_stmt).first()
    sales_gross = sales_res.gross or Decimal("0")
    sales_net = sales_res.net or Decimal("0")

    # Calculate total purchases
    purchases_stmt = _apply_dates(branch_scope.scope(select(
        func.sum(PurchaseInvoice.cash_amount + PurchaseInvoice.credit_amount).label("total")
    ), PurchaseInvoice, current), PurchaseInvoice.purchase_date, PurchaseInvoice.created_at)
    purchases_res = db.execute(purchases_stmt).first()
    purchases_total = purchases_res.total or Decimal("0")

    # Calculate treasury balance
    # **وخزنة الفرع، مش أول خزنة في الشركة.** كل فرع عنده شجرة حسابات كاملة، فحساب
    # الخزنة بيتاخد من فرع اللي بيقرا — والقديم كان بياخد أول صف طالع من القاعدة.
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
    statement: str | None = Query(None, description="البيان — جزء من الكلام"),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    """تصدير CSV سريع من «التقارير الشاملة».

    **بالأسماء مش بالأرقام الداخلية.** الملف كان بيطلّع «كود العميل» = رقم الصف في قاعدتنا
    و«نوع الحساب» = اسم الـenum بالإنجليزي — أرقام مالهاش معنى عند اللي بيفتح الإكسل.
    **وبالفترة المختارة فوق:** كان بيصدّر كل فواتير الشركة من أول يوم مهما كانت الفترة.
    """
    output = io.StringIO()
    wanted = report_statement.needle(statement)

    def _csv(*values) -> str:
        # الفاصلة جوّه اسم عميل أو بيان كانت بتكسر العمود — كل قيمة بين علامتين.
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
            .order_by(doc_date, SalesInvoice.id)).all()
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
            .order_by(doc_date, PurchaseInvoice.id)).all()
        for inv in invoices:
            if not report_statement.matches_obj(inv, wanted):
                continue
            output.write(_csv(inv.document_number, inv.purchase_date or inv.created_at.date(),
                              names.get(inv.supplier_id, ""), report_statement.text_of(inv),
                              inv.cash_amount, inv.credit_amount))

    else: # treasury balance report
        from src.services import chart_service

        output.write(_csv("رقم الحساب", "اسم الحساب", "المجموعة", "الرصيد المتاح"))
        # حسابات فرع اللي بيصدّر بس — زي الرئيسية بالظبط.
        accounts = db.scalars(branch_scope.scope(select(Account), Account, current)).all()
        owners = chart_service.bulk_owner_names(db, list(accounts))
        for acc in accounts:
            bal = ledger_service.balance_of(db, acc.id)
            output.write(_csv(acc.code or "", acc.name or owners.get(acc.id) or "",
                              chart_service.owner_group_label(acc.account_type) or "", bal))

    # Encode in UTF-8 with BOM for proper Arabic Excel compatibility
    csv_bytes = output.getvalue().encode('utf-8-sig')
    
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=report_{report_type}.csv"}
    )


@router.get("/health")
def system_health(
    # `sales.read` rather than admin-only: the point of the screen is that the person who can act
    # on a finding sees it without asking. The findings name documents and items they already have
    # every right to open — the diagnosis is not more sensitive than the thing diagnosed.
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
):
    """فحص النظام — كل حاجة فيها خلل في نداء واحد.

    Read-only, and deliberately one call: the dashboard asking eleven endpoints would be eleven
    round trips to render one page, and would leave the page half-answered whenever one of them
    failed.
    """
    return health.run_all(db, branch_id=branch_scope.visible_branch_id(current))
