from __future__ import annotations

import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, text, update

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, LedgerLine
from src.services import customer_service

FAMILY_OF_ENTRY = text("""
    select ledger_entry_id, family from sales_invoice where ledger_entry_id is not null
    union all select ledger_entry_id, family from sales_return where ledger_entry_id is not null
    union all select reversal_entry_id, family from sales_return where reversal_entry_id is not null
    union all select ledger_entry_id, family from voucher where ledger_entry_id is not null
""")

A5_TWIN_BRANCHES = {"أكتوبر", "العلياء"}
A5_CARD_TYPES = {"trader", "showroom"}


def _a5_default_family(db, customer) -> str | None:
    from src.models.org import Branch

    branch = db.get(Branch, customer.branch_id) if customer.branch_id else None
    if branch is None or branch.name not in A5_TWIN_BRANCHES or "A5" not in (customer.code or ""):
        return None
    if getattr(customer.customer_type, "value", customer.customer_type) not in A5_CARD_TYPES:
        return None
    return "بولي" if customer.name.strip().startswith("تكنو") else "أبيض"


def _plan(db, *, a5_cards: bool = False):
    family_of = {eid: fam for eid, fam in db.execute(FAMILY_OF_ENTRY) if fam}
    by_customer: dict[int, list[CustomerAccount]] = defaultdict(list)
    for acc in db.scalars(select(CustomerAccount)).all():
        by_customer[acc.customer_id].append(acc)
    plans = []
    for customer_id, accounts in by_customer.items():
        if len(accounts) != 1 or accounts[0].family is not None:
            continue
        customer = db.get(Customer, customer_id)
        if customer is None or not customer_service._keeps_own_family_accounts(db, customer):
            continue
        acc = accounts[0]
        rows = db.execute(text("""
            select l.id, l.entry_id, e.inalterable_hash is not null,
                   case when l.direction::text = 'debit' then l.amount else -l.amount end
              from ledger_line l join ledger_entry e on e.id = l.entry_id
             where l.account_id = :a order by e.entry_date, l.id"""), {"a": acc.account_id}).all()
        typed = [r for r in rows if r[1] in family_of]
        untyped_net: dict[int, Decimal] = defaultdict(Decimal)
        for r in rows:
            if r[1] not in family_of:
                untyped_net[r[1]] += r[3]
        families: dict[str, list[int]] = {}
        if a5_cards:
            default = _a5_default_family(db, customer)
            if default is None or not any(untyped_net.values()):
                continue
            families[default] = []
            if any(r[2] for r in typed if family_of[r[1]] != default):
                continue
        elif not typed or any(r[2] for r in typed) or any(untyped_net.values()):
            continue
        for line_id, entry_id, _, _ in typed:
            families.setdefault(family_of[entry_id], []).append(line_id)
        plans.append((customer, acc, families))
    return plans


def run(*, execute: bool, a5_cards: bool = False) -> None:
    db = SessionLocal()
    try:
        plans = _plan(db, a5_cards=a5_cards)
        for customer, acc, families in plans:
            first, *others = list(families)
            print(f"{customer.code} {customer.name}: "
                  + " / ".join(f"{f} {len(ids)} سطر" for f, ids in families.items()))
            acc.family = first
            account = db.get(Account, acc.account_id)
            account.name = f"{customer.name} {first}"[:160]
            want = f"{customer.code}-{first}"[:40]
            if db.scalar(select(Account.id).where(Account.code == want)) is None:
                account.code = want
            for fam in others:
                new = customer_service.open_account(db, customer, family=fam)
                db.execute(update(LedgerLine).where(LedgerLine.id.in_(families[fam]))
                           .values(account_id=new.account_id))
        db.flush()
        print(f"عملاء: {len(plans)}")
        if execute:
            db.commit()
            print("تم الحفظ.")
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:], a5_cards="--a5-cards" in sys.argv[1:])
