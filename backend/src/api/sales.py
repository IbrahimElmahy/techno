"""Sales router (T037). FR-017–021, FR-026/028. Rep → own custody origin + own customers."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import (
    CAP_RETURN_WRITE,
    CAP_SALE_WRITE,
    CAP_SELL_BELOW_PRICE,
    role_has_capability,
)
from src.core.db import get_db
from src.models.catalog import PriceTier
from src.models.customer import Customer
from src.models.sales import SalesInvoice, SalesReturn
from src.models.stock import LocationKind
from src.models.warehouse import Custody
from src.services import sales_service
from src.services.sales_service import ReturnLine, SaleLine, SalesError
from src.services.stock_service import StockError

router = APIRouter(tags=["sales"], prefix="/sales")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class SaleLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    tier: PriceTier | None = None          # (007) override the customer's default tier per line
    unit_price: Decimal | None = None      # (007) manual price; below tier needs sell.below_price
    unit: str | None = None                # (008) unit of measure; None = base
    serials: list[str] | None = None       # (009) serials for a serialized item
    discount_pct: Decimal | None = None    # (027) per-line discount; None = item's fixed default
    # (030) serve this line from its own warehouse; None = the document's location
    warehouse_id: int | None = None


class InvoiceExpenseIn(BaseModel):
    account_id: int
    amount: Decimal
    kind: str = "billed"
    description: str | None = None


class SaleCreate(BaseModel):
    customer_id: int
    origin: LocationIn
    variable_discount_pct: Decimal = Decimal("0")
    cash_amount: Decimal
    credit_amount: Decimal
    lines: list[SaleLineIn]
    # (030) document fields — who sold it, where revenue posts, the customer's paper number,
    # and free text. All optional: an existing client that sends none behaves exactly as before.
    rep_id: int | None = None
    revenue_account_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    statement1: str | None = None
    statement2: str | None = None
    statement3: str | None = None
    # Coupons handed to the customer with this invoice, as a serial range off the book.
    coupon_serial_from: str | None = None
    coupon_serial_to: str | None = None
    coupon_count: int | None = None
    # The day the sale happened — dates the document and its ledger entry alike.
    invoice_date: date | None = None
    # مصروفات الفاتورة — billed (على العميل، بتزيد الصافي) أو operating (على الشركة).
    expenses: list[InvoiceExpenseIn] = []


class ReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    serials: list[str] | None = None       # (009) serials being returned (serialized items)
    # (011) expiry of the perishable goods coming back — required for a perishable item, since a
    # sale does not record which lot each unit came from.
    expiry_date: date | None = None


class ReturnCreate(BaseModel):
    lines: list[ReturnLineIn]


class StandaloneReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal                    # refunded price per unit (defaults to last sold price)
    unit: str | None = None                # (008) unit of measure; None = base
    discount_pct: Decimal | None = None    # (027) per-line discount; None = 0
    warehouse_id: int | None = None        # (030) this line returns into its own warehouse


class StandaloneReturnCreate(BaseModel):
    customer_id: int
    origin: LocationIn
    variable_discount_pct: Decimal = Decimal("0")
    cash_refund: Decimal = Decimal("0")
    credit_reduction: Decimal = Decimal("0")
    lines: list[StandaloneReturnLineIn]


class SalesInvoiceOut(BaseModel):
    id: int
    document_number: str
    customer_id: int
    gross: Decimal
    combined_pct: Decimal
    net: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    cash_account_id: int
    ledger_entry_id: int
    created_at: str | None = None
    # (030)
    rep_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    # The coupon range issued with this invoice — the mobile app reads it when the customer
    # brings the coupons back, to check a serial belongs to a sale that really happened.
    coupon_serial_from: str | None = None
    coupon_serial_to: str | None = None
    coupon_count: int | None = None
    invoice_date: date | None = None
    expenses_billed: Decimal | None = None
    expenses_operating: Decimal | None = None


class InvoiceLineOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal | None = None
    line_total: Decimal
    price_tier: PriceTier | None = None
    unit: str | None = None
    unit_factor: Decimal | None = None
    # (030) the warehouse this line was served from, and the cost of goods frozen at sale time
    warehouse_id: int | None = None
    unit_cost: Decimal | None = None


class SalesInvoiceDetail(BaseModel):
    id: int
    document_number: str
    customer_id: int
    gross: Decimal
    combined_pct: Decimal
    net: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    cash_account_id: int
    ledger_entry_id: int
    lines: list[InvoiceLineOut]


def _rep_scope_check(db: Session, current: CurrentUser, customer_id: int, origin: LocationIn) -> None:
    if current.rep_id is None:
        return
    cust = db.get(Customer, customer_id)
    if cust is None or cust.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    own = db.scalar(select(Custody).where(Custody.rep_id == current.rep_id))
    if origin.location_kind != LocationKind.custody or own is None or own.id != origin.location_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Must sell from your own custody"})


@router.post("", response_model=SalesInvoiceOut, status_code=status.HTTP_201_CREATED)
def create_sale(
    body: SaleCreate,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> SalesInvoiceOut:
    _rep_scope_check(db, current, body.customer_id, body.origin)
    can_sell_below = role_has_capability(current.role, CAP_SELL_BELOW_PRICE)
    try:
        inv = sales_service.create_sale(
            db, customer_id=body.customer_id, origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id, variable_discount_pct=body.variable_discount_pct,
            cash_amount=body.cash_amount, credit_amount=body.credit_amount,
            lines=[SaleLine(l.item_id, l.quantity, l.tier, l.unit_price, l.unit, l.serials,
                            l.discount_pct, l.warehouse_id)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, can_sell_below=can_sell_below,
            rep_id=body.rep_id, revenue_account_id=body.revenue_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            coupon_serial_from=body.coupon_serial_from,
            coupon_serial_to=body.coupon_serial_to, coupon_count=body.coupon_count,
            invoice_date=body.invoice_date,
            expenses=[e.model_dump() for e in body.expenses],
            statement1=body.statement1, statement2=body.statement2, statement3=body.statement3,
        )
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": "sale_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "no_negative_stock", "message": str(exc)})
    db.commit()
    return _inv_out(inv)


def _inv_out(inv: SalesInvoice) -> SalesInvoiceOut:
    return SalesInvoiceOut(
        id=inv.id, document_number=inv.document_number, customer_id=inv.customer_id,
        gross=inv.gross, combined_pct=inv.combined_pct, net=inv.net, cash_amount=inv.cash_amount,
        credit_amount=inv.credit_amount, cash_account_id=inv.cash_account_id,
        ledger_entry_id=inv.ledger_entry_id,
        created_at=str(inv.created_at) if inv.created_at else None,
        rep_id=inv.rep_id, external_document_number=inv.external_document_number,
        coupon_serial_from=inv.coupon_serial_from, coupon_serial_to=inv.coupon_serial_to,
        coupon_count=inv.coupon_count, invoice_date=inv.invoice_date,
        expenses_billed=getattr(inv, "expenses_billed", None),
        expenses_operating=getattr(inv, "expenses_operating", None),
        notes=inv.notes,
    )


@router.get("", response_model=list[SalesInvoiceOut])
def list_sales(
    q: str | None = None,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    payment: str | None = None,   # cash | credit | partial
    rep_id: int | None = None,            # (030)
    external_document_number: str | None = None,  # (030)
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> list[SalesInvoiceOut]:
    """List sales invoices with search + filters, newest first."""
    stmt = select(SalesInvoice)
    if rep_id is not None:
        stmt = stmt.where(SalesInvoice.rep_id == rep_id)
    if external_document_number:
        stmt = stmt.where(SalesInvoice.external_document_number.like(
            f"%{external_document_number.strip()}%"))
    if current.rep_id is not None:
        stmt = stmt.where(SalesInvoice.customer_id.in_(
            select(Customer.id).where(Customer.rep_id == current.rep_id)
        ))
    if q:
        stmt = stmt.where(SalesInvoice.document_number.like(f"%{q.strip()}%"))
    if customer_id is not None:
        stmt = stmt.where(SalesInvoice.customer_id == customer_id)
    if date_from is not None:
        stmt = stmt.where(func.date(SalesInvoice.created_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(SalesInvoice.created_at) <= date_to)
    if payment == "cash":       # fully paid (nothing on credit)
        stmt = stmt.where(SalesInvoice.credit_amount == 0)
    elif payment == "credit":   # fully on credit (nothing paid)
        stmt = stmt.where(SalesInvoice.cash_amount == 0)
    elif payment == "partial":  # a mix
        stmt = stmt.where(SalesInvoice.cash_amount > 0, SalesInvoice.credit_amount > 0)
    return [_inv_out(i) for i in db.scalars(stmt.order_by(SalesInvoice.id.desc())).all()]


# --- Standalone returns (028): "return like a sale, reversed" ---------------------------------
# Declared BEFORE /{sale_id} so the literal "returns"/"customer-item-history" paths win over the
# int path param.

def _standalone_return_out(r: SalesReturn) -> dict:
    return {
        "id": r.id, "document_number": r.document_number, "customer_id": r.customer_id,
        "gross": str(r.gross), "combined_pct": str(r.combined_pct), "net": str(r.value),
        "tax_amount": str(r.tax_amount), "cash_refund": str(r.cash_refund),
        "credit_reduction": str(r.credit_reduction), "ledger_entry_id": r.ledger_entry_id,
        "created_at": str(r.created_at) if r.created_at else None,
    }


@router.get("/customer-item-history", response_model=dict)
def customer_item_history(
    customer_id: int,
    item_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """Last price this customer paid for this item + short purchase history (028). Empty if never
    bought — the return line then just keeps its typed price."""
    data = sales_service.last_sold_price(db, customer_id=customer_id, item_id=item_id)
    return data or {"last_price": None, "history": []}


@router.get("/returns", response_model=list[dict])
def list_standalone_returns(
    q: str | None = None,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List standalone sales returns (customer-based), newest first."""
    stmt = select(SalesReturn).where(SalesReturn.customer_id.isnot(None))
    if current.rep_id is not None:
        stmt = stmt.where(SalesReturn.customer_id.in_(
            select(Customer.id).where(Customer.rep_id == current.rep_id)
        ))
    if q:
        stmt = stmt.where(SalesReturn.document_number.like(f"%{q.strip()}%"))
    if customer_id is not None:
        stmt = stmt.where(SalesReturn.customer_id == customer_id)
    if date_from is not None:
        stmt = stmt.where(func.date(SalesReturn.created_at) >= date_from)
    if date_to is not None:
        stmt = stmt.where(func.date(SalesReturn.created_at) <= date_to)
    return [_standalone_return_out(r) for r in db.scalars(stmt.order_by(SalesReturn.id.desc())).all()]


@router.post("/returns", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_standalone_return(
    body: StandaloneReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    _rep_scope_check(db, current, body.customer_id, body.origin)
    try:
        ret = sales_service.create_standalone_return(
            db, customer_id=body.customer_id, origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id,
            variable_discount_pct=body.variable_discount_pct,
            cash_refund=body.cash_refund, credit_reduction=body.credit_reduction,
            lines=[ReturnLine(l.item_id, l.quantity, l.unit_price, l.unit, l.discount_pct,
                              l.warehouse_id)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id,
        )
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "return_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "no_negative_stock", "message": str(exc)})
    db.commit()
    return _standalone_return_out(ret)


@router.get("/returns/{return_id}", response_model=dict)
def get_standalone_return(
    return_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(SalesReturn, return_id)
    if r is None:
        raise HTTPException(404, {"code": "not_found", "message": "Return not found"})
    out = _standalone_return_out(r)
    out["origin_location_kind"] = r.origin_location_kind.value if r.origin_location_kind else None
    out["origin_location_id"] = r.origin_location_id
    out["lines"] = [
        {
            "item_id": ln.item_id, "quantity": str(ln.quantity),
            "unit_price": str(ln.unit_price) if ln.unit_price is not None else None,
            "discount_pct": str(ln.discount_pct), "unit": ln.unit,
            "line_total": str(ln.line_total) if ln.line_total is not None else None,
            "warehouse_id": ln.location_id,   # (030)
        }
        for ln in r.lines
    ]
    return out


@router.get("/{sale_id}", response_model=SalesInvoiceDetail)
def get_sale(
    sale_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> SalesInvoiceDetail:
    inv = db.get(SalesInvoice, sale_id)
    if inv is None:
        raise HTTPException(404, {"code": "not_found", "message": "Sale not found"})
    return SalesInvoiceDetail(
        id=inv.id,
        document_number=inv.document_number,
        customer_id=inv.customer_id,
        gross=inv.gross,
        combined_pct=inv.combined_pct,
        net=inv.net,
        cash_amount=inv.cash_amount,
        credit_amount=inv.credit_amount,
        cash_account_id=inv.cash_account_id,
        ledger_entry_id=inv.ledger_entry_id,
        lines=[
            InvoiceLineOut(
                item_id=line.item_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount_pct=line.discount_pct,
                line_total=line.line_total,
                price_tier=line.price_tier,
                unit=line.unit,
                unit_factor=line.unit_factor,
                warehouse_id=line.location_id,
                unit_cost=line.unit_cost,
            )
            for line in inv.lines
        ],
    )


@router.get("/{sale_id}/returns", response_model=list[dict])
def list_sale_returns(
    sale_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(
        select(SalesReturn).where(SalesReturn.sales_invoice_id == sale_id)
        .order_by(SalesReturn.id.desc())
    ).all()
    return [
        {
            "id": r.id, "document_number": r.document_number, "value": str(r.value),
            "cash_refund": str(r.cash_refund), "credit_reduction": str(r.credit_reduction),
            "created_at": str(r.created_at),
            "lines": [{"item_id": ln.item_id, "quantity": str(ln.quantity)} for ln in r.lines],
        }
        for r in rows
    ]


@router.post("/{sale_id}/returns", response_model=dict, status_code=status.HTTP_201_CREATED)
def return_sale(
    sale_id: int,
    body: ReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    try:
        ret = sales_service.return_sale(
            db, sales_invoice_id=sale_id, lines=[(l.item_id, l.quantity) for l in body.lines],
            actor_user_id=current.id,
            serials={l.item_id: l.serials for l in body.lines if l.serials},
            expiry_dates={l.item_id: l.expiry_date for l in body.lines if l.expiry_date},
        )
    except (SalesError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "return_invalid", "message": str(exc)})
    db.commit()
    return {"id": ret.id, "document_number": ret.document_number,
            "cash_refund": str(ret.cash_refund), "credit_reduction": str(ret.credit_reduction),
            "ledger_entry_id": ret.ledger_entry_id}
