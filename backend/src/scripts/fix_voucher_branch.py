from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, LedgerEntry, LedgerLine
from src.models.user import User
from src.models.voucher import Voucher
from src.services import audit_service


def run(*, username: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            raise SystemExit(f"مافيش يوزر اسمه «{username}»")
        plan = []
        for v in db.scalars(select(Voucher).where(Voucher.actor_user_id == user.id)
                            .order_by(Voucher.id)).all():
            if not v.ledger_entry_id:
                continue
            branches = set(db.scalars(
                select(Account.branch_id).join(LedgerLine, LedgerLine.account_id == Account.id)
                .where(LedgerLine.entry_id == v.ledger_entry_id)).all())
            if len(branches) != 1 or None in branches:
                continue
            target = branches.pop()
            entry = db.get(LedgerEntry, v.ledger_entry_id)
            if v.branch_id != target or (entry and entry.branch_id != target):
                plan.append((v, entry, target))
                print(f"{v.document_number:<12} {v.branch_id} ← {target}")
        print(f"سندات هتتصلح: {len(plan)}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for v, entry, target in plan:
            before = v.branch_id
            v.branch_id = target
            if entry is not None:
                entry.branch_id = target
            audit_service.record(db, action="voucher.fix_branch", actor_user_id=None,
                                 entity_type="voucher", entity_id=v.id,
                                 before={"branch_id": before}, after={"branch_id": target})
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تصحيح فرع السندات حسب فرع حسابات قيدها")
    ap.add_argument("--user", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(username=a.user, execute=a.yes)


if __name__ == "__main__":
    main()
