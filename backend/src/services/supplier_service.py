from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import Account, AccountType, Direction
from src.models.supplier import Supplier, SupplierAccount


class SupplierError(Exception):
    pass


def account_of(db: Session, supplier_id: int) -> SupplierAccount | None:
    return db.scalar(
        select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id)
    )


def require_account(db: Session, supplier_id: int) -> SupplierAccount:
    existing = account_of(db, supplier_id)
    if existing is not None:
        return existing

    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise SupplierError("المورد غير موجود.")

    acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit,
                  branch_id=getattr(supplier, "branch_id", None))
    db.add(acc)
    db.flush()
    link = SupplierAccount(supplier_id=supplier_id, account_id=acc.id)
    db.add(link)
    db.flush()
    acc.owner_ref = link.id
    db.flush()
    return link
