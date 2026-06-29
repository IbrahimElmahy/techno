"""Sales router (T037). FR-017–021, FR-026/028. Rep → own custody origin + own customers."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_RETURN_WRITE, CAP_SALE_WRITE, CAP_SELL_BELOW_PRICE, role_has_capability
from src.core.db import get_db
from src.models.catalog import PriceTier
from src.models.customer import Customer
from src.models.sales import SalesInvoice
from src.models.stock import LocationKind
from src.models.warehouse import Custody
from src.services import sales_service
from src.services.sales_service import SaleLine, SalesError
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


class SaleCreate(BaseModel):
    customer_id: int
    origin: LocationIn
    variable_discount_pct: Decimal = Decimal("0")
    cash_amount: Decimal
    credit_amount: Decimal
    lines: list[SaleLineIn]


class ReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal


class ReturnCreate(BaseModel):
    lines: list[ReturnLineIn]


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


class InvoiceLineOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal
    price_tier: PriceTier | None = None


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
            lines=[SaleLine(l.item_id, l.quantity, l.tier, l.unit_price) for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, can_sell_below=can_sell_below,
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
    )


@router.get("", response_model=list[SalesInvoiceOut])
def list_sales(
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> list[SalesInvoiceOut]:
    stmt = select(SalesInvoice)
    if current.rep_id is not None:
        stmt = stmt.where(SalesInvoice.customer_id.in_(
            select(Customer.id).where(Customer.rep_id == current.rep_id)
        ))
    return [_inv_out(i) for i in db.scalars(stmt).all()]


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
                line_total=line.line_total,
                price_tier=line.price_tier,
            )
            for line in inv.lines
        ],
    )


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
            actor_user_id=current.id)
    except (SalesError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "return_invalid", "message": str(exc)})
    db.commit()
    return {"id": ret.id, "document_number": ret.document_number,
            "cash_refund": str(ret.cash_refund), "credit_reduction": str(ret.credit_reduction),
            "ledger_entry_id": ret.ledger_entry_id}
