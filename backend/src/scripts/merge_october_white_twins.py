from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select, text, update

from src.core.db import SessionLocal
from src.models.customer import MERGED_MARK, Customer, CustomerAccount
from src.models.org import Branch
from src.models.user import User
from src.services import customer_merge_service as cms
from src.services import ledger_service

BRANCH = "أكتوبر"
WHITE_SUFFIXES = ("وايت",)


def _base_of(name: str) -> str | None:
    words = cms._normalise(name).split()
    if len(words) >= 2 and words[-1] in WHITE_SUFFIXES:
        return " ".join(words[:-1])
    return None


def _total(db) -> object:
    return ledger_service.total_balance_of(
        db, db.scalars(select(CustomerAccount.account_id)).all())


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        branch = db.scalars(select(Branch).where(Branch.name == BRANCH)).one()
        custs = db.scalars(select(Customer).where(
            Customer.branch_id == branch.id, Customer.active.is_(True))).all()
        by_key: dict[str, list[Customer]] = defaultdict(list)
        for c in custs:
            by_key[cms.match_key(c.name)].append(c)
        accounts: dict[int, list[CustomerAccount]] = defaultdict(list)
        for a in db.scalars(select(CustomerAccount)).all():
            accounts[a.customer_id].append(a)

        pairs: list[tuple[Customer, Customer]] = []
        skipped: list[tuple[str, str]] = []
        phones: list[str] = []
        alone: list[str] = []
        for c in custs:
            base = _base_of(c.name)
            if base is None:
                continue
            cands = [k for k in by_key.get(cms.match_key(base), []) if k.id != c.id]
            if not cands:
                alone.append(c.name)
                continue
            if len(cands) > 1:
                skipped.append((c.name, f"«{base}» متكرر {len(cands)} مرات"))
                continue
            keep = cands[0]
            pk, pd = cms._digits(keep.phone), cms._digits(c.phone)
            if pk and pd and pk != pd:
                phones.append(f"«{c.name}»: {keep.phone} / {c.phone}")
            ka, da = accounts.get(keep.id, []), accounts.get(c.id, [])
            if len(ka) > 1 or len(da) > 1 or any(a.family for a in ka + da):
                skipped.append((c.name, "حسابات متقسمة خلاص"))
                continue
            pairs.append((keep, c))

        print(f"فرع {BRANCH}: كروت «وايت» {sum(1 for c in custs if _base_of(c.name))}"
              f" · أزواج هتتدمج {len(pairs)} · متخطّي {len(skipped)} · «وايت» من غير توأم {len(alone)}")
        for keep, dupe in pairs[:15]:
            print(f"   #{dupe.id} «{dupe.name}» ⇒ #{keep.id} «{keep.name}»")
        if len(pairs) > 15:
            print(f"   … و{len(pairs) - 15} كمان")
        for n, why in skipped:
            print(f"   ⚠ اتخطّى «{n}»: {why}")
        if phones:
            print(f"   ℹ {len(phones)} زوج التليفون فيهم مختلف (اتدمجوا، والتليفون بتاع «فلان» فضل):")
            for x in phones:
                print(f"      {x}")
        for n in alone:
            print(f"   · «{n}» مالوش كارت بولي — بيفضل زي ما هو")
        if not execute or not pairs:
            if not execute:
                print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0

        before = _total(db)
        actor = db.scalars(select(User).order_by(User.id)).first()
        acc_changes, cust_changes = [], []
        moved: dict[int, int] = {}
        for keep, dupe in pairs:
            for a in accounts.get(keep.id, []):
                acc_changes.append({"id": a.id, "customer_id": keep.id, "family": cms.FAMILY_POLY})
            for a in accounts.get(dupe.id, []):
                acc_changes.append({"id": a.id, "customer_id": keep.id, "family": cms.FAMILY_WHITE})
            cust_changes.append({"id": dupe.id, "active": False,
                                 "name": f"{dupe.name} {MERGED_MARK}{keep.id})"})
            moved[dupe.id] = keep.id

        tagged = defaultdict(int)
        for t in ("sales_invoice", "sales_return", "voucher"):
            tagged[t] += db.execute(text(
                f"UPDATE {t} SET family = :f WHERE customer_id = ANY(:ids)"),
                {"f": cms.FAMILY_WHITE, "ids": list(moved)}).rowcount or 0
            tagged[t] += db.execute(text(
                f"UPDATE {t} SET family = :f WHERE customer_id = ANY(:ids)"),
                {"f": cms.FAMILY_POLY, "ids": list(moved.values())}).rowcount or 0

        db.execute(update(CustomerAccount), acc_changes)
        db.execute(update(Customer), cust_changes)
        for dupe_id, keep_id in moved.items():
            db.execute(text(
                "UPDATE customer k SET phone = COALESCE(NULLIF(k.phone, ''), d.phone), "
                "address = COALESCE(NULLIF(k.address, ''), d.address) "
                "FROM customer d WHERE k.id = :keep AND d.id = :dupe"),
                {"keep": keep_id, "dupe": dupe_id})
        docs = cms._move_documents(db, moved)
        for keep, dupe in pairs:
            cms._audit(db, actor.id if actor else None, dupe.id, keep.id, dupe.name, keep.name,
                       kind="october_white")
        db.flush()
        after = _total(db)
        if before != after:
            db.rollback()
            print(f"✘ المجموع اتغيّر {before} → {after} — رجعت كل حاجة.")
            return 1
        db.commit()
        print(f"\n✔ اتدمج {len(pairs)} زوج. النوع اتظبط على: {dict(tagged)}")
        print(f"   صفوف اتنقلت: {docs}")
        print(f"   مجموع أرصدة العملاء: {before} → {after}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
