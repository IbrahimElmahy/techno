"""Per-branch chart of accounts — 024 phase 1.

The main branch behaves exactly as the pre-multi-branch system (one treasury, balances
intact); a second branch gets its own independent system accounts.
"""
from __future__ import annotations


def test_default_branch_singletons_are_stable(client, world, db):
    from src.services import account_resolver, org_service

    main = org_service.default_branch(db)
    t1 = account_resolver.treasury_account(db)
    t2 = account_resolver.treasury_account(db)
    # Same account every time, homed to the main branch.
    assert t1.id == t2.id
    assert t1.branch_id == main.id


def test_legacy_branchless_account_is_adopted_not_duplicated(client, world, db):
    """A pre-024 owner-less account (branch_id NULL) is adopted into the main branch."""
    from src.models.ledger import Account, AccountType, Direction
    from src.services import account_resolver, org_service

    legacy = Account(account_type=AccountType.sales_revenue, owner_ref=None,
                     normal_side=Direction.credit, branch_id=None)
    db.add(legacy)
    db.flush()

    resolved = account_resolver.sales_revenue_account(db)
    assert resolved.id == legacy.id  # adopted, not a new duplicate
    assert resolved.branch_id == org_service.default_branch(db).id
    # And only ONE owner-less revenue account exists.
    from sqlalchemy import func, select
    count = db.scalar(select(func.count()).select_from(Account).where(
        Account.account_type == AccountType.sales_revenue, Account.owner_ref.is_(None)))
    assert count == 1


def test_a_second_branch_gets_its_own_system_accounts(client, world, db):
    from src.models.org import Branch
    from src.services import account_resolver, org_service

    main = org_service.default_branch(db)
    other = Branch(name="فرع طنطا", governorate_id=main.governorate_id, is_head_office=False)
    db.add(other)
    db.flush()

    main_treasury = account_resolver.treasury_account(db, branch_id=main.id)
    other_treasury = account_resolver.treasury_account(db, branch_id=other.id)
    assert main_treasury.id != other_treasury.id
    assert other_treasury.branch_id == other.id

    # Each branch's revenue is separate too.
    main_rev = account_resolver.sales_revenue_account(db, branch_id=main.id)
    other_rev = account_resolver.sales_revenue_account(db, branch_id=other.id)
    assert main_rev.id != other_rev.id


def test_customer_receivable_belongs_to_its_branch(client, world, db, login):
    from src.models.customer import CustomerAccount
    from src.models.ledger import Account
    from src.services import customer_service, org_service

    result = customer_service.create_customer(
        db, name="عميل الفرع", customer_type="trader", rep_id=world["rep_a"],
        territory_id=world["terr_a"], phone=None, actor_user_id=world["admin"])
    db.commit()
    from sqlalchemy import select
    ca = db.scalar(select(CustomerAccount).where(
        CustomerAccount.customer_id == result.customer.id))
    acc = db.get(Account, ca.account_id)
    # terr_a is under branch_a; the receivable inherits that branch.
    assert acc.branch_id == world["branch_a"]
    assert acc.branch_id is not None
