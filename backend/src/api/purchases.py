"""Purchases router (T024). FR-009–012."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PURCHASE_WRITE, CAP_RETURN_WRITE
from src.core.db import get_db
from src.models.stock import LocationKind
from src.services import purchase_service
from src.services.purchase_service import PurchaseError, PurchaseLine
from src.services.stock_service import StockError

router = APIRouter(tags=["purchases"], prefix="/purchases")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class PurchaseLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    unit: str | None = None    # (008) unit of measure; None = base


class PurchaseCreate(BaseModel):
    supplier_id: int
    location: LocationIn
    cash_amount: Decimal
    credit_amount: Decimal
    lines: list[PurchaseLineIn]


class ReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal


class ReturnCreate(BaseModel):
    lines: list[ReturnLineIn]


class DocOut(BaseModel):
    id: int
    document_number: str
    ledger_entry_id: int | None = None


@router.post("", response_model=DocOut, status_code=status.HTTP_201_CREATED)
def create_purchase(
    body: PurchaseCreate,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> DocOut:
    try:
        inv = purchase_service.create_purchase(
            db, supplier_id=body.supplier_id, location_kind=body.location.location_kind,
            location_id=body.location.location_id, cash_amount=body.cash_amount,
            credit_amount=body.credit_amount,
            lines=[PurchaseLine(l.item_id, l.quantity, l.unit_price, l.unit) for l in body.lines],
            actor_role=current.role, actor_user_id=current.id,
        )
    except (PurchaseError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "purchase_invalid", "message": str(exc)})
    db.commit()
    return DocOut(id=inv.id, document_number=inv.document_number, ledger_entry_id=inv.ledger_entry_id)


@router.post("/{purchase_id}/returns", response_model=DocOut, status_code=status.HTTP_201_CREATED)
def return_purchase(
    purchase_id: int,
    body: ReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> DocOut:
    try:
        ret = purchase_service.return_purchase(
            db, purchase_invoice_id=purchase_id,
            lines=[(l.item_id, l.quantity) for l in body.lines],
            actor_role=current.role, actor_user_id=current.id,
        )
    except (PurchaseError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "return_invalid", "message": str(exc)})
    db.commit()
    return DocOut(id=ret.id, document_number=ret.document_number, ledger_entry_id=ret.ledger_entry_id)
