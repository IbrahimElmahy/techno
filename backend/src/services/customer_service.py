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


def open_account(db: Session, customer: Customer, *, family: str | None = None) -> CustomerAccount:
    """يفتح حساب ذمم للعميل ده ويربطه بيه.

    Receivable account is a normal-debit ledger account (assets increase on debit). It belongs to
    the customer's branch (024) so per-branch receivables aggregate correctly: his own branch
    first, then his territory's, then the main branch.

    It is opened with no name and no code **on purpose**. A per-owner account is labelled from the
    link table at read time (`chart_service.bulk_owner_names`) and homed under «العملاء» by
    `chart_service.effective_parent_id`, so a name copied in here would drift the first time
    somebody fixed a spelling on the customer.

    Written once, here, because it used to live inline in `create_customer` — which meant a
    customer who arrived any other way (an import, a merge, the a5 migration) got no account at
    all, and every sale, voucher and statement for him refused: «العميل ده مالوش حساب ذمم».
    """
    from src.models.org import Territory
    from src.services import org_service

    territory = db.get(Territory, customer.territory_id) if customer.territory_id else None
    branch_id = org_service.resolve_branch_id(
        db,
        customer.branch_id or (territory.branch_id if territory is not None else None),
    )
    account = Account(
        account_type=AccountType.customer_receivable,
        owner_ref=None,
        normal_side=Direction.debit,
        branch_id=branch_id,
    )
    db.add(account)
    db.flush()
    cust_account = CustomerAccount(
        customer_id=customer.id, account_id=account.id, family=family)
    db.add(cust_account)
    db.flush()
    account.owner_ref = cust_account.id
    db.flush()
    return cust_account


def ensure_account(db: Session, customer: Customer) -> tuple[CustomerAccount | None, bool]:
    """حساب ذمم العميل — الموجود، أو واحد جديد لو مالوش. الـ`bool` معناه «اتعمل دلوقتي».

    Idempotent by construction, because `ensure_customer_accounts` re-runs it over the whole file
    and a second run must not open anybody a second account.

    Finding is delegated to `customer_merge_service.receivable_account`, which is where the rule
    already lives: one account → that one; several with a family-less one → that one; several
    without → refuse, since there is no honest answer. The refusal is not a problem here — a
    customer who holds several accounts is precisely one who needs nothing opened — so it comes
    back as `(None, False)`: nothing created, and «اسأل عن الحساب بالعائلة» for whoever posts.
    """
    from src.services import customer_merge_service

    try:
        acc = customer_merge_service.receivable_account(db, customer.id)
    except customer_merge_service.MergeError:
        return None, False
    if acc is not None:
        return acc, False
    return open_account(db, customer), True


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

    open_account(db, customer)

    audit_service.record(
        db,
        action="customer.create",
        actor_user_id=actor_user_id,
        entity_type="customer",
        entity_id=customer.id,
        after={"code": customer.code, "rep_id": rep_id, "territory_id": territory_id},
    )
    return CreateResult(customer=customer, duplicate_phone_customer_ids=dup_ids)


def delete_customer(db: Session, *, customer: Customer, actor_user_id: int) -> None:
    """Permanently remove a customer that has never moved — otherwise refuse.

    Deleting a customer with invoices, receipts or ledger movement would orphan posted
    documents and silently change the books, so that case must stay a deactivation.
    """
    from src.models.cheque import Cheque
    from src.models.inspection import Inspection
    from src.models.ledger import LedgerLine
    from src.models.loyalty import Coupon, PointRecord
    from src.models.sales import SalesInvoice
    from src.models.voucher import Voucher

    blockers: list[str] = []
    checks = [
        ("فواتير بيع", select(func.count()).select_from(SalesInvoice)
         .where(SalesInvoice.customer_id == customer.id)),
        ("سندات", select(func.count()).select_from(Voucher)
         .where(Voucher.customer_id == customer.id)),
        ("شيكات", select(func.count()).select_from(Cheque)
         .where(Cheque.customer_id == customer.id)),
        ("معاينات", select(func.count()).select_from(Inspection)
         .where(Inspection.customer_id == customer.id)),
        ("نقاط ولاء", select(func.count()).select_from(PointRecord)
         .where(PointRecord.customer_id == customer.id)),
        ("كوبونات", select(func.count()).select_from(Coupon)
         .where(Coupon.customer_id == customer.id)),
    ]
    for label, stmt in checks:
        if (db.scalar(stmt) or 0) > 0:
            blockers.append(label)

    link = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer.id))
    if link is not None:
        moved = db.scalar(select(func.count()).select_from(LedgerLine)
                          .where(LedgerLine.account_id == link.account_id)) or 0
        if moved:
            blockers.append("حركات على الحساب")

    if blockers:
        raise CustomerError(
            "لا يمكن حذف العميل نهائياً لوجود " + "، ".join(blockers)
            + ". يمكنك إلغاء تفعيله بدلاً من الحذف."
        )

    audit_service.record(
        db, action="customer.delete", actor_user_id=actor_user_id,
        entity_type="customer", entity_id=customer.id,
        before={"code": customer.code, "name": customer.name},
    )
    if link is not None:
        account = db.get(Account, link.account_id)
        db.delete(link)
        db.flush()
        if account is not None:
            db.delete(account)
    db.delete(customer)
    db.flush()


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
