"""Suppliers router (T021). FR-009."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE
from src.core.db import get_db
from src.models.ledger import Account, AccountType, Direction
from src.models.supplier import Supplier, SupplierAccount
from src.services import ledger_service

router = APIRouter(tags=["suppliers"], prefix="/suppliers")


class SupplierCreate(BaseModel):
    name: str
    phone: str | None = None


class SupplierOut(BaseModel):
    id: int
    code: str
    name: str
    phone: str | None
    active: bool


class AccountBalanceOut(BaseModel):
    account_id: int
    balance: Decimal
    derived: bool = True


@router.get("", response_model=list[SupplierOut])
def list_suppliers(
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> list[SupplierOut]:
    return [
        SupplierOut(id=s.id, code=s.code, name=s.name, phone=s.phone, active=s.active)
        for s in db.scalars(select(Supplier)).all()
    ]


@router.post("", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
def create_supplier(
    body: SupplierCreate,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_WRITE)),
    db: Session = Depends(get_db),
) -> SupplierOut:
    n = db.scalar(select(func.count()).select_from(Supplier)) or 0
    acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit)
    db.add(acc)
    db.flush()
    supplier = Supplier(code=f"SUP-{n + 1:05d}", name=body.name, phone=body.phone)
    db.add(supplier)
    db.flush()
    sa = SupplierAccount(supplier_id=supplier.id, account_id=acc.id)
    db.add(sa)
    db.flush()
    acc.owner_ref = sa.id
    db.commit()
    return SupplierOut(id=supplier.id, code=supplier.code, name=supplier.name,
                       phone=supplier.phone, active=supplier.active)


@router.get("/{supplier_id}/account", response_model=AccountBalanceOut)
def supplier_account(
    supplier_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> AccountBalanceOut:
    sa = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id))
    if sa is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier account not found"})
    return AccountBalanceOut(account_id=sa.account_id, balance=ledger_service.balance_of(db, sa.account_id))
