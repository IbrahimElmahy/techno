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
from src.models.contact import PhoneOwner
from src.models.ledger import Account, AccountType, Direction
from src.models.supplier import Supplier, SupplierAccount
from src.services import audit_service, contact_service, ledger_service

router = APIRouter(tags=["suppliers"], prefix="/suppliers")


class SupplierCreate(BaseModel):
    name: str
    phone: str | None = None
    address: str | None = None            # (v4)
    phones: list[str] | None = None       # (v4) extra numbers


class SupplierUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    active: bool | None = None
    address: str | None = None
    phones: list[str] | None = None


class SupplierOut(BaseModel):
    id: int
    code: str
    name: str
    phone: str | None
    active: bool
    address: str | None = None
    phones: list[str] = []


def _sup_out(s: Supplier, db: Session | None = None) -> SupplierOut:
    extra = contact_service.phone_values(db, PhoneOwner.supplier, s.id) if db is not None else []
    return SupplierOut(id=s.id, code=s.code, name=s.name, phone=s.phone, active=s.active,
                       address=s.address, phones=extra)


class AccountBalanceOut(BaseModel):
    account_id: int
    balance: Decimal
    derived: bool = True


@router.get("", response_model=list[SupplierOut])
def list_suppliers(
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> list[SupplierOut]:
    return [_sup_out(s, db) for s in db.scalars(select(Supplier)).all()]


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
    supplier = Supplier(code=f"SUP-{n + 1:05d}", name=body.name, phone=body.phone,
                        address=body.address)
    db.add(supplier)
    db.flush()
    sa = SupplierAccount(supplier_id=supplier.id, account_id=acc.id)
    db.add(sa)
    db.flush()
    acc.owner_ref = sa.id
    contact_service.set_phones(db, PhoneOwner.supplier, supplier.id, body.phones)
    db.commit()
    return _sup_out(supplier, db)


@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> SupplierOut:
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    return _sup_out(s, db)


@router.patch("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    current: CurrentUser = Depends(require_capability(CAP_SUPPLIER_WRITE)),
    db: Session = Depends(get_db),
) -> SupplierOut:
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    if body.name is not None:
        s.name = body.name
    if body.phone is not None:
        s.phone = body.phone
    if body.active is not None:
        s.active = body.active
    if body.address is not None:
        s.address = body.address
    contact_service.set_phones(db, PhoneOwner.supplier, s.id, body.phones)
    db.flush()
    audit_service.record(db, action="supplier.update", actor_user_id=current.id,
                         entity_type="supplier", entity_id=s.id)
    db.commit()
    return _sup_out(s, db)


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_supplier(
    supplier_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SUPPLIER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    s.active = False
    db.flush()
    audit_service.record(db, action="supplier.deactivate", actor_user_id=current.id,
                         entity_type="supplier", entity_id=s.id)
    db.commit()


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
