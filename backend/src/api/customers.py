"""Customers router (T050). FR-018–021, FR-020a. No loyalty schema (After-Sales owns it)."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CUSTOMER_READ, CAP_CUSTOMER_REASSIGN, CAP_CUSTOMER_WRITE
from src.core.db import get_db
from src.models.customer import Customer, CustomerAccount, CustomerType
from src.services import customer_service, ledger_service

router = APIRouter(tags=["customers"], prefix="/customers")


class CustomerCreate(BaseModel):
    name: str
    customer_type: CustomerType
    rep_id: int
    territory_id: int
    phone: str | None = None


class CustomerOut(BaseModel):
    id: int
    code: str
    name: str
    customer_type: CustomerType
    phone: str | None
    rep_id: int
    territory_id: int
    active: bool


class CustomerCreated(CustomerOut):
    duplicate_phone_customer_ids: list[int] = []


class CustomerReassign(BaseModel):
    new_rep_id: int
    new_territory_id: int


class CustomerAccountOut(BaseModel):
    id: int
    customer_id: int
    account_id: int
    balance: Decimal
    balance_derived: bool = True


def _out(c: Customer) -> CustomerOut:
    return CustomerOut(
        id=c.id, code=c.code, name=c.name, customer_type=c.customer_type,
        phone=c.phone, rep_id=c.rep_id, territory_id=c.territory_id, active=c.active,
    )


def _scope_filter(stmt, current: CurrentUser):
    if current.is_admin:
        return stmt
    if current.rep_id is not None:  # Sales Rep -> only own customers (FR-009)
        return stmt.where(Customer.rep_id == current.rep_id)
    if current.branch_id is not None:  # branch-scoped -> own branch via territory
        from src.models.org import Territory

        branch_territories = select(Territory.id).where(Territory.branch_id == current.branch_id)
        return stmt.where(Customer.territory_id.in_(branch_territories))
    return stmt


@router.get("", response_model=list[CustomerOut])
def list_customers(
    rep_id: int | None = None,
    territory_id: int | None = None,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> list[CustomerOut]:
    stmt = _scope_filter(select(Customer), current)
    if rep_id is not None:
        stmt = stmt.where(Customer.rep_id == rep_id)
    if territory_id is not None:
        stmt = stmt.where(Customer.territory_id == territory_id)
    return [_out(c) for c in db.scalars(stmt).all()]


@router.post("", response_model=CustomerCreated, status_code=status.HTTP_201_CREATED)
def create_customer(
    body: CustomerCreate,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_WRITE)),
    db: Session = Depends(get_db),
) -> CustomerCreated:
    result = customer_service.create_customer(
        db,
        name=body.name,
        customer_type=body.customer_type,
        rep_id=body.rep_id,
        territory_id=body.territory_id,
        phone=body.phone,
        actor_user_id=current.id,
    )
    db.commit()
    c = result.customer
    return CustomerCreated(
        id=c.id, code=c.code, name=c.name, customer_type=c.customer_type, phone=c.phone,
        rep_id=c.rep_id, territory_id=c.territory_id, active=c.active,
        duplicate_phone_customer_ids=result.duplicate_phone_customer_ids,
    )


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> CustomerOut:
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    if current.rep_id is not None and c.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    return _out(c)


@router.post("/{customer_id}/reassign", response_model=CustomerOut)
def reassign_customer(
    customer_id: int,
    body: CustomerReassign,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_REASSIGN)),
    db: Session = Depends(get_db),
) -> CustomerOut:
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    customer_service.reassign_customer(
        db, customer=c, new_rep_id=body.new_rep_id,
        new_territory_id=body.new_territory_id, actor_user_id=current.id,
    )
    db.commit()
    return _out(c)


@router.get("/{customer_id}/account", response_model=CustomerAccountOut)
def customer_account(
    customer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> CustomerAccountOut:
    acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer_id))
    if acc is None:
        raise HTTPException(404, {"code": "not_found", "message": "Account not found"})
    return CustomerAccountOut(
        id=acc.id, customer_id=acc.customer_id, account_id=acc.account_id,
        balance=ledger_service.balance_of(db, acc.account_id),
    )
