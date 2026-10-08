from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services.numbering import next_document_number
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountType, Direction
from src.services import audit_service


@dataclass
class CreateResult:
    customer: Customer
    duplicate_phone_customer_ids: list[int]


def _next_code(db: Session) -> str:
    return next_document_number(db, Customer, "CUST", column=Customer.code, width=6)


class CustomerError(Exception):
    pass


NO_RECEIVABLE_TYPES = {"plumber", "سباك"}


def _norm_type(value) -> str:
    return getattr(value, "value", value) or ""


def open_account(db: Session, customer: Customer, *, family: str | None = None) -> CustomerAccount:
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
    from src.services import customer_merge_service

    try:
        acc = customer_merge_service.receivable_account(db, customer.id)
    except customer_merge_service.MergeError:
        return None, False
    if acc is not None:
        return acc, False
    return open_account(db, customer), True


def require_account(db: Session, customer_id: int, *, family: str | None = None) -> CustomerAccount:
    from src.services import customer_merge_service

    customer = db.get(Customer, customer_id)
    if customer is None:
        raise CustomerError("العميل غير موجود.")
    acc = customer_merge_service.receivable_account(db, customer_id, family)
    if acc is not None:
        return acc
    if _norm_type(customer.customer_type) in NO_RECEIVABLE_TYPES:
        raise CustomerError(
            f"«{customer.name}» عميل من نوع «سباك» — لا يُفتح له حساب ذمم ولا يُباع له. "
            "إن كان سيشتري فغيّر نوع العميل أولاً."
        )
    return open_account(db, customer)


AFTER_SALES_TYPES = {"plumber"}


def assert_rep_matches_type(db: Session, *, customer_type: str, rep_id: int | None) -> None:
    if customer_type not in AFTER_SALES_TYPES or rep_id is None:
        return
    from src.models.role import Role, RoleName
    from src.models.user import User

    rep = db.get(User, rep_id)
    role = db.get(Role, rep.role_id) if rep else None
    if role is None or role.name != RoleName.after_sales_staff:
        raise CustomerError(
            "يجب أن يكون المندوب المسؤول عن العميل من نوع «سباك» مندوب خدمة ما بعد البيع."
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

    if _norm_type(customer_type) not in NO_RECEIVABLE_TYPES:
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
    new_rep_id: int | None,
    new_territory_id: int,
    actor_user_id: int,
) -> Customer:
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
