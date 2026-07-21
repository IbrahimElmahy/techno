"""Resolve/create the ledger accounts Sales & Inventory posts to (T002).

Reuses the Foundation `account` table and ledger — no new ledger, no balance store. Singleton
P&L accounts (sales_revenue, purchases_expense) and the consolidated treasury are get-or-created;
the actor's cash location resolves to their custody (rep) or the treasury (branch/back-office).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import Account, AccountNature, AccountType, Direction
from src.models.role import RoleName
from src.models.warehouse import Custody

# Normal balance side per account type (debit-normal assets/expenses, credit-normal income/liabs).
NORMAL_SIDE: dict[AccountType, Direction] = {
    AccountType.treasury: Direction.debit,
    AccountType.custody: Direction.debit,
    AccountType.customer_receivable: Direction.debit,
    AccountType.supplier_payable: Direction.credit,
    AccountType.sales_revenue: Direction.credit,
    AccountType.purchases_expense: Direction.debit,
    AccountType.loyalty_expense: Direction.debit,
    # General Ledger (005) — equity that opening-balance entries offset against.
    AccountType.opening_balance_equity: Direction.credit,
}

# Chart classification (005): which AccountNature each system account type belongs to, and the
# normal side each nature posts on (asset/expense → debit; liability/equity/income → credit).
NATURE_NORMAL_SIDE: dict[AccountNature, Direction] = {
    AccountNature.asset: Direction.debit,
    AccountNature.expense: Direction.debit,
    AccountNature.liability: Direction.credit,
    AccountNature.equity: Direction.credit,
    AccountNature.income: Direction.credit,
}


class AccountResolutionError(Exception):
    """Raised when a required account (e.g., a rep's custody) cannot be resolved."""


def get_or_create_singleton(
    db: Session, account_type: AccountType, *, branch_id: int | None = None
) -> Account:
    """Get-or-create the one owner-less system account of a type **for a branch** (024).

    Each branch has its own treasury / revenue / purchases / equity. When no branch is given
    the default (main) branch is used, which keeps the pre-multi-branch callers working
    unchanged — and a legacy branch-less account is adopted into the main branch rather than
    duplicated, so existing balances stay intact.
    """
    from src.services import org_service

    bid = org_service.resolve_branch_id(db, branch_id)
    acc = db.scalar(
        select(Account).where(
            Account.account_type == account_type,
            Account.owner_ref.is_(None),
            Account.branch_id == bid,
        )
    )
    if acc is not None:
        return acc
    # Adopt a pre-024 branch-less account into the main branch (never into a secondary branch).
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
    """The equity account that opening-balance entries offset against (005)."""
    return get_or_create_singleton(
        db, AccountType.opening_balance_equity, branch_id=branch_id)


def resolve_cash_account(db: Session, *, role: RoleName, user_id: int) -> Account:
    """The actor's cash location: a Sales Rep's custody, else the consolidated treasury (Q3)."""
    if role == RoleName.sales_rep:
        custody = db.scalar(select(Custody).where(Custody.rep_id == user_id))
        if custody is None or custody.account_id is None:
            raise AccountResolutionError("Sales Rep has no custody account; create one first.")
        return db.get(Account, custody.account_id)
    return treasury_account(db)
