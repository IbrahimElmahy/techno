"""Customer service (T048–T049): create + reassign.

FR-018a (system code + duplicate-phone flag), FR-021 (auto-create ledger-backed account),
FR-020a (reassignment preserves account/balance + history attribution).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountType, Direction
from src.services import audit_service


@dataclass
class CreateResult:
    customer: Customer
    duplicate_phone_customer_ids: list[int]


def _next_code(db: Session) -> str:
    count = db.scalar(select(func.count()).select_from(Customer)) or 0
    return f"CUST-{count + 1:06d}"


def create_customer(
    db: Session,
    *,
    name: str,
    customer_type: str,
    rep_id: int,
    territory_id: int,
    phone: str | None,
    actor_user_id: int,
) -> CreateResult:
    """Create a customer with a stable code + a ledger-backed receivable account.

    Duplicate phone is flagged (not blocked). No loyalty schema (owned by After-Sales).
    """
    dup_ids: list[int] = []
    if phone:
        dup_ids = list(
            db.scalars(select(Customer.id).where(Customer.phone == phone)).all()
        )

    customer = Customer(
        code=_next_code(db),
        name=name,
        customer_type=customer_type,
        phone=phone,
        rep_id=rep_id,
        territory_id=territory_id,
    )
    db.add(customer)
    db.flush()

    # Receivable account is a normal-debit ledger account (assets increase on debit).
    account = Account(
        account_type=AccountType.customer_receivable,
        owner_ref=None,
        normal_side=Direction.debit,
    )
    db.add(account)
    db.flush()
    cust_account = CustomerAccount(customer_id=customer.id, account_id=account.id)
    db.add(cust_account)
    db.flush()
    account.owner_ref = cust_account.id
    db.flush()

    audit_service.record(
        db,
        action="customer.create",
        actor_user_id=actor_user_id,
        entity_type="customer",
        entity_id=customer.id,
        after={"code": customer.code, "rep_id": rep_id, "territory_id": territory_id},
    )
    return CreateResult(customer=customer, duplicate_phone_customer_ids=dup_ids)


def reassign_customer(
    db: Session,
    *,
    customer: Customer,
    new_rep_id: int,
    new_territory_id: int,
    actor_user_id: int,
) -> Customer:
    """Move future ownership only. Account/balance untouched; history stays with old rep."""
    before = {"rep_id": customer.rep_id, "territory_id": customer.territory_id}
    customer.rep_id = new_rep_id
    customer.territory_id = new_territory_id
    db.flush()
    audit_service.record(
        db,
        action="customer.reassign",
        actor_user_id=actor_user_id,
        entity_type="customer",
        entity_id=customer.id,
        before=before,
        after={"rep_id": new_rep_id, "territory_id": new_territory_id},
    )
    return customer
