"""Chart of Accounts service (005, T010/T012).

The chart is the Foundation `account` table viewed as a hierarchy (research R1). This module:
- seeds the standard group headings and re-homes the system accounts under them (T029 reuses this);
- creates/updates/deactivates user-defined accounts with the segmented-code + postable-leaf rules;
- derives an account's balance (leaf = Σ lines; group = subtree roll-up) — never stored (Princ. VI).

No new ledger. Postable leaves accept journal lines; group nodes only aggregate.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, AccountNature, AccountType
from src.services import ledger_service
from src.services.account_resolver import (
    NATURE_NORMAL_SIDE,
    get_or_create_singleton,
)


class ChartError(Exception):
    """Invalid chart operation (bad code/parent, non-group parent, delete-with-history, ...)."""


# --- Standard chart definition (research R2) -------------------------------------------------

# Group headings: (code, Arabic name, nature, parent_code)
_GROUPS: list[tuple[str, str, AccountNature, str | None]] = [
    ("1", "الأصول", AccountNature.asset, None),
    ("1.01", "الأصول المتداولة", AccountNature.asset, "1"),
    ("1.02", "الذمم المدينة", AccountNature.asset, "1"),
    ("2", "الالتزامات", AccountNature.liability, None),
    ("2.01", "الذمم الدائنة", AccountNature.liability, "2"),
    ("3", "حقوق الملكية", AccountNature.equity, None),
    ("4", "الإيرادات", AccountNature.income, None),
    ("5", "التكلفة والمصروفات", AccountNature.expense, None),
]

# Which group each system account_type lives under, and its nature.
_GROUP_CODE_BY_TYPE: dict[AccountType, str] = {
    AccountType.treasury: "1.01",
    AccountType.custody: "1.01",
    AccountType.customer_receivable: "1.02",
    AccountType.supplier_payable: "2.01",
    AccountType.sales_revenue: "4",
    AccountType.purchases_expense: "5",
    AccountType.loyalty_expense: "5",
    AccountType.opening_balance_equity: "3",
}

_NATURE_BY_TYPE: dict[AccountType, AccountNature] = {
    AccountType.treasury: AccountNature.asset,
    AccountType.custody: AccountNature.asset,
    AccountType.customer_receivable: AccountNature.asset,
    AccountType.supplier_payable: AccountNature.liability,
    AccountType.sales_revenue: AccountNature.income,
    AccountType.purchases_expense: AccountNature.expense,
    AccountType.loyalty_expense: AccountNature.expense,
    AccountType.opening_balance_equity: AccountNature.equity,
}

# Singleton system leaves to seed with explicit codes/names: (account_type, code, name).
_SINGLETON_LEAVES: list[tuple[AccountType, str, str]] = [
    (AccountType.treasury, "1.01.001", "الخزينة"),
    (AccountType.opening_balance_equity, "3.001", "أرصدة افتتاحية"),
    (AccountType.sales_revenue, "4.001", "إيرادات المبيعات"),
    (AccountType.purchases_expense, "5.001", "المشتريات"),
    (AccountType.loyalty_expense, "5.002", "مصروف نقاط الولاء"),
]


def seed_standard_chart(db: Session) -> dict[str, Account]:
    """Idempotently create group headings, re-home system accounts, seed singleton leaves.

    Shared by the 0004 migration and the test `chart` fixture. Returns groups keyed by code.
    """
    groups: dict[str, Account] = {}
    for code, name, nature, parent_code in _GROUPS:
        node = db.scalar(select(Account).where(Account.code == code))
        if node is None:
            node = Account(
                account_type=AccountType.user_defined,
                normal_side=NATURE_NORMAL_SIDE[nature],
                code=code,
                name=name,
                nature=nature,
                is_postable=False,
                is_system=True,
                parent_id=(groups[parent_code].id if parent_code else None),
            )
            db.add(node)
            db.flush()
        groups[code] = node

    # Singleton system leaves: get-or-create the account, then set its chart columns.
    for account_type, code, name in _SINGLETON_LEAVES:
        acc = get_or_create_singleton(db, account_type)
        acc.code = code
        acc.name = name
        acc.nature = _NATURE_BY_TYPE[account_type]
        acc.is_postable = True
        acc.is_system = True
        acc.parent_id = groups[_GROUP_CODE_BY_TYPE[account_type]].id
        db.flush()

    # Backfill per-owner system accounts (custody / customer_receivable / supplier_payable):
    # classify and re-home under their group; codes stay NULL (labelled by owner at read time).
    backfill_types = (
        AccountType.custody,
        AccountType.customer_receivable,
        AccountType.supplier_payable,
    )
    for acc in db.scalars(select(Account).where(Account.account_type.in_(backfill_types))).all():
        acc.nature = _NATURE_BY_TYPE[acc.account_type]
        acc.is_postable = True
        acc.is_system = True
        if acc.parent_id is None:
            acc.parent_id = groups[_GROUP_CODE_BY_TYPE[acc.account_type]].id
        db.flush()

    return groups


def effective_parent_id(db: Session, account: Account) -> int | None:
    """The account's group: its explicit parent_id, else derived from account_type (per-owner
    accounts created after the seed). Used by the tree builder and trial-balance roll-up."""
    if account.parent_id is not None:
        return account.parent_id
    group_code = _GROUP_CODE_BY_TYPE.get(account.account_type)
    if group_code is None:
        return None
    grp = db.scalar(select(Account).where(Account.code == group_code))
    return grp.id if grp else None


# --- User-defined account CRUD ---------------------------------------------------------------

def create_account(
    db: Session,
    *,
    code: str,
    name: str,
    nature: AccountNature,
    is_postable: bool,
    parent_id: int | None,
) -> Account:
    """Create a chart node. Enforces: unique code, child code prefixed by parent code, and that
    the parent (if any) is a group node (FR-001/002/003/017)."""
    code = code.strip()
    if not code:
        raise ChartError("Account code is required.")
    if db.scalar(select(Account).where(Account.code == code)) is not None:
        raise ChartError(f"Account code '{code}' already exists.")

    parent: Account | None = None
    if parent_id is not None:
        parent = db.get(Account, parent_id)
        if parent is None:
            raise ChartError("Parent account not found.")
        if parent.is_postable:
            raise ChartError("Parent must be a group (non-postable) account.")
        if not code.startswith(parent.code + "."):
            raise ChartError(
                f"Child code '{code}' must be prefixed by its parent's code '{parent.code}.'"
            )
    elif "." in code:
        raise ChartError("A root account code must have no dot segment.")

    acc = Account(
        account_type=AccountType.user_defined,
        normal_side=NATURE_NORMAL_SIDE[nature],
        code=code,
        name=name,
        nature=nature,
        is_postable=is_postable,
        is_system=False,
        parent_id=parent_id,
    )
    db.add(acc)
    db.flush()
    return acc


def update_account(
    db: Session, *, account_id: int, name: str | None = None, active: bool | None = None
) -> Account:
    """Rename and/or (de)activate. System accounts may be renamed but not deactivated if they
    still have active children (FR-005)."""
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("Account not found.")
    if name is not None:
        acc.name = name
    if active is not None:
        if active is False:
            _assert_deactivatable(db, acc)
        acc.active = active
    db.flush()
    return acc


def deactivate_account(db: Session, *, account_id: int) -> Account:
    """Soft-delete: never hard-delete an account with children or posted lines (FR-005/IV)."""
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("Account not found.")
    _assert_deactivatable(db, acc)
    acc.active = False
    db.flush()
    return acc


def _assert_deactivatable(db: Session, acc: Account) -> None:
    if acc.is_system:
        raise ChartError("System accounts cannot be deactivated.")
    has_active_child = db.scalar(
        select(Account.id).where(Account.parent_id == acc.id, Account.active.is_(True))
    )
    if has_active_child is not None:
        raise ChartError("Account has active children; deactivate them first.")


def account_balance(db: Session, account_id: int) -> Decimal:
    """Derived balance: a leaf = signed Σ of its lines; a group = Σ of its descendant leaves."""
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("Account not found.")
    if acc.is_postable:
        return ledger_service.balance_of(db, account_id)
    total = ZERO
    for child in db.scalars(select(Account).where(Account.parent_id == account_id)).all():
        total += account_balance(db, child.id)
    return to_money(total)


def is_postable_leaf(db: Session, account_id: int) -> bool:
    acc = db.get(Account, account_id)
    return bool(acc and acc.is_postable and acc.active)
