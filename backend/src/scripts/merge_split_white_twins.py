from __future__ import annotations

import re
import sys
from collections import defaultdict

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.customer import MERGED_MARK, Customer, CustomerAccount
from src.services import customer_merge_service as cms
from src.services import ledger_service

WHITE = re.compile(r"\s*وايت\s*$")


def run(*, execute: bool, actor: int) -> None:
    db = SessionLocal()
    try:
        active = db.scalars(select(Customer).where(Customer.active.is_(True))).all()
        by_key = defaultdict(list)
        for c in active:
            by_key[(c.branch_id, cms.match_key(c.name))].append(c)
        accounts = defaultdict(list)
        for ca in db.scalars(select(CustomerAccount)).all():
            accounts[ca.customer_id].append(ca)
        before = ledger_service.total_balance_of(db, [ca.account_id for lst in accounts.values() for ca in lst])
        done = 0
        for dupe in active:
            if not WHITE.search(dupe.name or "") or MERGED_MARK in dupe.name:
                continue
            base = WHITE.sub("", dupe.name)
            twins = [c for c in by_key.get((dupe.branch_id, cms.match_key(base)), []) if c.id != dupe.id]
            if len(twins) != 1:
                continue
            keep = twins[0]
            white = [a for a in accounts[keep.id] if a.family == cms.FAMILY_WHITE]
            if len(white) != 1:
                continue
            target = white[0].account_id
            lines = 0
            for ca in accounts[dupe.id]:
                if ca.account_id != target:
                    lines += db.execute(text("update ledger_line set account_id = :t where account_id = :a"),
                                        {"t": target, "a": ca.account_id}).rowcount or 0
                db.delete(ca)
            moved = cms._move_documents(db, {dupe.id: keep.id})
            old_name = dupe.name
            dupe.name = f"{old_name} {MERGED_MARK}{keep.id})"[:160]
            dupe.active = False
            cms._audit(db, actor, dupe.id, keep.id, old_name, keep.name, kind="split_white_twin")
            done += 1
            print(f"«{old_name}» ← «{keep.name}» (#{keep.id}) · سطور قيد اتنقلت: {lines} · مستندات: {moved}")
        db.flush()
        after = ledger_service.total_balance_of(db, [ca.account_id for ca in db.scalars(select(CustomerAccount)).all()])
        print(f"اتدمج {done} · إجمالي أرصدة العملاء قبل {before} بعد {after}")
        if execute:
            db.commit()
            print("اتحفظ.")
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    actor_arg = next((a for a in sys.argv if a.startswith("--actor=")), "--actor=1")
    run(execute="--yes" in sys.argv, actor=int(actor_arg.split("=")[1]))
