from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, AccountType
from src.services import audit_service


def run(*, parent_code: str, code: str, name: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        parent = db.scalar(select(Account).where(Account.code == parent_code))
        if parent is None or parent.is_postable:
            raise SystemExit(f"مافيش مجموعة بالكود {parent_code}")
        if db.scalar(select(Account).where(Account.code == code)) is not None:
            raise SystemExit(f"الكود {code} مستخدم")
        same = db.scalar(select(Account).where(Account.parent_id == parent.id,
                                               Account.name == name))
        if same is not None:
            raise SystemExit(f"«{name}» موجود تحت «{parent.name}» بالكود {same.code}")
        sibling = db.scalar(select(Account).where(Account.parent_id == parent.id,
                                                  Account.is_postable.is_(True)).limit(1))
        nature = sibling.nature if sibling is not None else parent.nature
        side = sibling.normal_side if sibling is not None else parent.normal_side
        print(f"{code}  «{name}»  تحت «{parent.name}» ({parent.code})  "
              f"الفرع {parent.branch_id}  {nature.value}/{side.value}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        acc = Account(account_type=AccountType.user_defined, code=code, name=name,
                      nature=nature, normal_side=side, is_postable=True, is_system=False,
                      parent_id=parent.id, branch_id=parent.branch_id)
        db.add(acc)
        db.flush()
        audit_service.record(db, action="account.create", actor_user_id=None,
                             entity_type="account", entity_id=acc.id,
                             after={"code": code, "name": name, "parent": parent_code})
        db.commit()
        print(f"✔ اتعمل الحساب {acc.id}")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="إضافة حساب فرعي تحت مجموعة موجودة")
    ap.add_argument("--parent-code", required=True)
    ap.add_argument("--code", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(parent_code=a.parent_code, code=a.code, name=a.name, execute=a.yes)


if __name__ == "__main__":
    main()
