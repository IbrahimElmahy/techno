from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountType
from src.models.supplier import Supplier, SupplierAccount
from src.services import chart_service


def main() -> None:
    execute = "--yes" in sys.argv
    db = SessionLocal()
    rows = db.scalars(select(Account).where(
        Account.parent_id.is_(None),
        Account.account_type.in_([AccountType.customer_receivable, AccountType.supplier_payable,
                                  AccountType.opening_balance_equity]))).all()
    for acc in rows:
        if acc.account_type == AccountType.opening_balance_equity:
            if not acc.name:
                acc.name = "فروق الأرصدة الافتتاحية"
            print(f"{acc.id:>6} افتتاحي ← {acc.name}")
            continue
        if acc.account_type == AccountType.customer_receivable:
            link = db.scalars(select(CustomerAccount).where(CustomerAccount.account_id == acc.id)).first()
            party = db.get(Customer, link.customer_id) if link else None
            chart_service.place_party_account(
                db, acc, kind="customer", name=party.name if party else "عميل بدون كارت",
                code=party.code if party else None, family=link.family if link else None)
        else:
            link = db.scalars(select(SupplierAccount).where(SupplierAccount.account_id == acc.id)).first()
            party = db.get(Supplier, link.supplier_id) if link else None
            chart_service.place_party_account(
                db, acc, kind="supplier", name=party.name if party and party.name else "مورد بدون كارت",
                code=party.code if party else None)
        parent = db.get(Account, acc.parent_id) if acc.parent_id else None
        print(f"{acc.id:>6} {acc.code or '':<16} {acc.name or '':<34} ← {parent.code if parent else 'بدون أب'}")
    if execute:
        db.commit()
        print("APPLIED")
    else:
        db.rollback()
        print("DRY RUN")


if __name__ == "__main__":
    main()
