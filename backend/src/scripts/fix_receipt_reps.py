from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.ledger import LedgerEntry
from src.models.role import RoleName
from src.models.user import User
from src.models.voucher import Voucher, VoucherKind


def _role_of(user: User | None) -> str | None:
    if user is None or user.role is None:
        return None
    name = user.role.name
    return getattr(name, "value", name)


def run(execute: bool = False) -> None:
    db = SessionLocal()
    try:
        url = db.get_bind().url
        print(f"القاعدة: {url.drivername}://{url.host}/{url.database}")

        users = {u.id: u for u in db.scalars(select(User)).all()}
        customer_rep = dict(db.execute(select(Customer.id, Customer.rep_id)).all())
        receipts = db.scalars(select(Voucher).where(
            Voucher.kind == VoucherKind.receipt).order_by(Voucher.id)).all()
        by_id = {v.id: v for v in receipts}

        from_actor = from_app = from_customer = no_rep = 0
        mirrors_copied = mirrors_linked = 0
        entry_rep = entry_branch = 0

        for v in receipts:
            if v.reverses_id is not None or v.rep_user_id is not None:
                continue
            if _role_of(users.get(v.actor_user_id)) == RoleName.sales_rep.value:
                v.rep_user_id = v.actor_user_id
                from_actor += 1
            elif v.client_uuid:
                v.rep_user_id = v.actor_user_id
                from_app += 1
            elif customer_rep.get(v.customer_id):
                v.rep_user_id = customer_rep[v.customer_id]
                from_customer += 1
            else:
                no_rep += 1

        for v in receipts:
            if v.reverses_id is None:
                continue
            original = by_id.get(v.reverses_id) or db.get(Voucher, v.reverses_id)
            if v.rep_user_id is None and original is not None and original.rep_user_id:
                v.rep_user_id = original.rep_user_id
                mirrors_copied += 1
            if v.ledger_entry_id is None and original is not None and original.ledger_entry_id:
                counters = db.scalars(select(LedgerEntry.id).where(
                    LedgerEntry.reverses_entry_id == original.ledger_entry_id)).all()
                if len(counters) == 1:
                    v.ledger_entry_id = counters[0]
                    mirrors_linked += 1
        db.flush()

        entry_ids = [v.ledger_entry_id for v in receipts if v.ledger_entry_id]
        entries = {}
        for i in range(0, len(entry_ids), 1000):
            for e in db.scalars(select(LedgerEntry).where(
                    LedgerEntry.id.in_(entry_ids[i:i + 1000]))).all():
                entries[e.id] = e
        for v in receipts:
            e = entries.get(v.ledger_entry_id)
            if e is None:
                continue
            if e.rep_id is None and v.rep_user_id:
                e.rep_id = v.rep_user_id
                entry_rep += 1
            if e.branch_id is None and v.branch_id:
                e.branch_id = v.branch_id
                entry_branch += 1
        db.flush()

        print("-" * 52)
        print(f"{'سندات قبض':<34}{len(receipts):>8}")
        print(f"{'مندوب = اللي كتبه (مندوب)':<34}{from_actor:>8}")
        print(f"{'مندوب = اللي كتبه (من التطبيق)':<34}{from_app:>8}")
        print(f"{'مندوب = مندوب العميل':<34}{from_customer:>8}")
        print(f"{'مالقيناش مندوب':<34}{no_rep:>8}")
        print(f"{'سند عكسي خد مندوب أصله':<34}{mirrors_copied:>8}")
        print(f"{'سند عكسي اتربط بقيده':<34}{mirrors_linked:>8}")
        print(f"{'قيود خدت مندوب':<34}{entry_rep:>8}")
        print(f"{'قيود خدت فرع':<34}{entry_branch:>8}")

        if not execute:
            db.rollback()
            print("[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print("✔ اتحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
