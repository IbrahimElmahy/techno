from __future__ import annotations

import argparse

from sqlalchemy import func, select, update

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountType, LedgerLine
from src.models.supplier import SupplierAccount
from src.services import audit_service


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Customer, CustomerAccount, SupplierAccount.account_id)
            .join(CustomerAccount, CustomerAccount.customer_id == Customer.id)
            .join(SupplierAccount, SupplierAccount.supplier_id == Customer.supplier_id)
            .where(Customer.supplier_id.is_not(None),
                   CustomerAccount.account_id != SupplierAccount.account_id)).all()
        plan = []
        for card, link, payable in rows:
            old = db.get(Account, link.account_id)
            if old is None or old.account_type != AccountType.customer_receivable:
                continue
            shared = db.scalar(select(func.count()).select_from(CustomerAccount).where(
                CustomerAccount.account_id == old.id, CustomerAccount.id != link.id))
            if shared:
                continue
            lines = db.scalar(select(func.count()).select_from(LedgerLine).where(
                LedgerLine.account_id == old.id))
            target = db.get(Account, payable)
            plan.append((card, link, old, target, lines))
            print(f"{card.name}: {old.code} ← {target.code} {target.name}  (سطور قيود: {lines})")
        print(f"كروت هتتصلّح: {len(plan)}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for card, link, old, target, lines in plan:
            db.execute(update(LedgerLine).where(LedgerLine.account_id == old.id)
                       .values(account_id=target.id))
            link.account_id = target.id
            old.active = False
            audit_service.record(db, action="customer.link_supplier_account", actor_user_id=None,
                                 entity_type="customer", entity_id=card.id,
                                 before={"account": old.code},
                                 after={"account": target.code, "moved_lines": lines})
        db.commit()
        print(f"تم: {len(plan)}")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(
        description="ربط كروت العملاء المفتوحة للموردين بحساب المورد نفسه ونقل قيودها إليه")
    ap.add_argument("--yes", action="store_true")
    run(execute=ap.parse_args().yes)


if __name__ == "__main__":
    main()
