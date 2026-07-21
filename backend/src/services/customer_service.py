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


class CustomerError(Exception):
    """Invalid customer data (e.g. a plumber assigned to a non after-sales rep)."""


# (v4) Customer types whose responsible rep must be after-sales (customer-service) staff.
AFTER_SALES_TYPES = {"plumber"}


def assert_rep_matches_type(db: Session, *, customer_type: str, rep_id: int) -> None:
    """A plumber's responsible rep must be After-Sales staff (client rule, v4)."""
    if customer_type not in AFTER_SALES_TYPES:
        return
    from src.models.role import Role, RoleName
    from src.models.user import User

    rep = db.get(User, rep_id)
    role = db.get(Role, rep.role_id) if rep else None
    if role is None or role.name != RoleName.after_sales_staff:
        raise CustomerError(
            "عميل من نوع «سباك» لازم يكون المندوب المسؤول عنه مندوب خدمة ما بعد البيع."
        )


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
    (v4) A plumber must be owned by an after-sales rep — see `assert_rep_matches_type`.
    """
    assert_rep_matches_type(db, customer_type=customer_type, rep_id=rep_id)
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
    # It belongs to the customer's branch (024 — via his territory), so per-branch receivables
    # aggregate correctly; falls back to the main branch when the territory has none.
    from src.models.org import Territory
    from src.services import org_service

    territory = db.get(Territory, territory_id)
    branch_id = org_service.resolve_branch_id(
        db, territory.branch_id if territory is not None else None)
    account = Account(
        account_type=AccountType.customer_receivable,
        owner_ref=None,
        normal_side=Direction.debit,
        branch_id=branch_id,
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
