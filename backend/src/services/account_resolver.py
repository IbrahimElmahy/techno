from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import Account, AccountNature, AccountType, Direction
from src.models.role import RoleName
from src.models.warehouse import Custody

NORMAL_SIDE: dict[AccountType, Direction] = {
    AccountType.treasury: Direction.debit,
    AccountType.custody: Direction.debit,
    AccountType.customer_receivable: Direction.debit,
    AccountType.supplier_payable: Direction.credit,
    AccountType.sales_revenue: Direction.credit,
    AccountType.purchases_expense: Direction.debit,
    AccountType.loyalty_expense: Direction.debit,
    AccountType.opening_balance_equity: Direction.credit,
}

NATURE_NORMAL_SIDE: dict[AccountNature, Direction] = {
    AccountNature.asset: Direction.debit,
    AccountNature.expense: Direction.debit,
    AccountNature.liability: Direction.credit,
    AccountNature.equity: Direction.credit,
    AccountNature.income: Direction.credit,
}


class AccountResolutionError(Exception):
    pass


def _routed(db: Session, account_type: AccountType, branch_id: int) -> Account | None:
    from src.services import account_routing_service

    for role, typ in account_routing_service.ROUTABLE.items():
        if typ == account_type:
            return account_routing_service.routed_account(db, role, branch_id=branch_id)
    return None


def get_or_create_singleton(
    db: Session, account_type: AccountType, *, branch_id: int | None = None
) -> Account:
    from src.services import org_service

    bid = org_service.resolve_branch_id(db, branch_id)
    routed = _routed(db, account_type, bid)
    if routed is not None:
        return routed
    acc = db.scalar(
        select(Account)
        .where(
            Account.account_type == account_type,
            Account.owner_ref.is_(None),
            Account.branch_id == bid,
        )
        .order_by(Account.is_system.desc(), Account.id)
    )
    if acc is not None:
        return acc
    if bid == org_service.default_branch(db).id:
        legacy = db.scalar(
            select(Account).where(
                Account.account_type == account_type,
                Account.owner_ref.is_(None),
                Account.branch_id.is_(None),
            )
        )
        if legacy is not None:
            legacy.branch_id = bid
            db.flush()
            return legacy
    acc = Account(
        account_type=account_type, owner_ref=None,
        normal_side=NORMAL_SIDE[account_type], branch_id=bid,
    )
    db.add(acc)
    db.flush()
    return acc


def treasury_account(db: Session, *, branch_id: int | None = None) -> Account:
    return get_or_create_singleton(db, AccountType.treasury, branch_id=branch_id)


def sales_revenue_account(db: Session, *, branch_id: int | None = None) -> Account:
    return get_or_create_singleton(db, AccountType.sales_revenue, branch_id=branch_id)


def purchases_expense_account(db: Session, *, branch_id: int | None = None) -> Account:
    return get_or_create_singleton(db, AccountType.purchases_expense, branch_id=branch_id)


def loyalty_expense_account(db: Session, *, branch_id: int | None = None) -> Account:
    return get_or_create_singleton(db, AccountType.loyalty_expense, branch_id=branch_id)


def opening_balance_equity_account(db: Session, *, branch_id: int | None = None) -> Account:
    return get_or_create_singleton(
        db, AccountType.opening_balance_equity, branch_id=branch_id)


def _rep_name(db: Session, user_id: int) -> str:
    from src.models.user import User

    u = db.get(User, user_id)
    return (u.full_name or u.username) if u is not None else f"#{user_id}"


def resolve_cash_account(
    db: Session, *, role: RoleName, user_id: int, family: str | None = None,
    branch_id: int | None = None,
) -> Account:
    if role != RoleName.sales_rep:
        if branch_id is None:
            from src.models.user import User

            user = db.get(User, user_id)
            branch_id = user.branch_id if user is not None else None
        return treasury_account(db, branch_id=branch_id)

    rows = db.scalars(
        select(Custody)
        .where(Custody.rep_id == user_id)
        .order_by(Custody.active.desc(), Custody.id)
    ).all()
    if not rows:
        raise AccountResolutionError(
            f"«{_rep_name(db, user_id)}» ليس له حساب عهدة — أنشئ له حساباً أولاً.")

    if family:
        match = [c for c in rows if c.family == family]
        if not match:
            raise AccountResolutionError(
                f"«{_rep_name(db, user_id)}» ليس له صندوق لخط «{family}» — "
                "لن تُرحَّل هذه الفاتورة حتى يُنشئ المكتب صندوقاً له."
            )
        custody = match[0]
    else:
        plain = [c for c in rows if c.family is None]
        if plain:
            custody = plain[0]
        elif len(rows) == 1:
            custody = rows[0]
        else:
            lines = "، ".join(c.family or "—" for c in rows)
            raise AccountResolutionError(
                f"«{_rep_name(db, user_id)}» لديه أكثر من صندوق ({lines}) "
                "ولم يحدد هذا المستند الخط.")

    if custody.account_id is None:
        raise AccountResolutionError(
            f"صندوق «{_rep_name(db, user_id)}»"
            + (f" — خط «{custody.family}»" if custody.family else "")
            + " ليس له حساب في الدفاتر.")
    return db.get(Account, custody.account_id)


def explicit_treasury(db: Session, account_id: int | None) -> Account | None:
    if account_id is None:
        return None
    acc = db.get(Account, account_id)
    if acc is None or acc.account_type not in (AccountType.treasury, AccountType.custody):
        raise AccountResolutionError("الخزنة المختارة غير موجودة أو ليست خزنة.")
    return acc
