from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import LedgerLine
from src.models.supplier import SupplierAccount
from src.scripts.link_a5_party_accounts import CUSTOMER_GROUPS, _accounts_under, _norm
from src.services import customer_service

from src.services.customer_service import NO_RECEIVABLE_TYPES as SKIPPED_TYPES


def _orphan_customer_accounts(db):
    used = {a.account_id for a in db.scalars(select(CustomerAccount)).all()}
    used |= {a.account_id for a in db.scalars(select(SupplierAccount)).all()}
    book = _accounts_under(db, CUSTOMER_GROUPS)
    free: dict[int | None, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    total = 0
    for branch_id, by_name in book.items():
        for key, accounts in by_name.items():
            rest = [a for a in accounts if a.id not in used]
            if rest:
                free[branch_id][key] = rest
                total += len(rest)
    return free, total


def run(*, execute: bool, include_plumbers: bool, force: bool = False) -> None:
    db = SessionLocal()
    try:
        customers = db.scalars(select(Customer)).all()
        with_account = {a.customer_id for a in db.scalars(select(CustomerAccount)).all()}
        orphans, orphan_total = _orphan_customer_accounts(db)

        same_name: dict[tuple[int | None, str], int] = defaultdict(int)
        for c in customers:
            same_name[(c.branch_id, _norm(c.name or ""))] += 1

        tally: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        planned: list[Customer] = []
        deferred: list[tuple[Customer, str]] = []
        skipped_plumbers = 0
        skipped_inactive = 0

        for c in customers:
            kind = c.customer_type or "—"
            if c.id in with_account:
                tally[kind]["عنده حساب"] += 1
                continue
            tally[kind]["مالوش"] += 1
            if not c.active:
                skipped_inactive += 1
                continue
            if kind in SKIPPED_TYPES and not include_plumbers:
                skipped_plumbers += 1
                continue
            key = _norm(c.name or "")
            hits = orphans.get(c.branch_id, {}).get(key, [])
            if hits:
                if len(hits) > 1 or same_name[(c.branch_id, key)] > 1:
                    deferred.append((c, "ملتبس"))
                else:
                    deferred.append((c, "عنده حساب a5 مش متربط"))
                continue
            planned.append(c)

        print(f"العملاء: {len(customers)}   عندهم حساب: {len(with_account)}   "
              f"من غير حساب: {len(customers) - len(with_account)}\n")
        print(f"   {'النوع':<16}{'عنده حساب':>12}{'مالوش':>10}")
        for kind in sorted(tally):
            print(f"   {kind:<16}{tally[kind]['عنده حساب']:>12}{tally[kind]['مالوش']:>10}")

        print(f"\n   هيتفتحلهم حساب      {len(planned):>6}")
        if skipped_plumbers:
            print(f"   سباكين اتسابوا       {skipped_plumbers:>6}   "
                  f"(--include-plumbers لو عايزهم)")
        if skipped_inactive:
            print(f"   معطّلين اتسابوا      {skipped_inactive:>6}   (غالباً مدموجين)")

        moved_accounts = set(db.scalars(select(LedgerLine.account_id).distinct()).all())
        orphans_with_moves = sum(
            1 for by_name in orphans.values() for accounts in by_name.values()
            for a in accounts if a.id in moved_accounts)
        if orphan_total:
            print(f"\n   حسابات يتيمة تحت «العملاء»  {orphan_total:>6}   "
                  f"(عليها حركة: {orphans_with_moves})")

        if deferred:
            by_reason: dict[str, list[Customer]] = defaultdict(list)
            for c, reason in deferred:
                by_reason[reason].append(c)
            for reason in sorted(by_reason):
                rows = by_reason[reason]
                print(f"\n{reason} — شغّل link_a5_party_accounts الأول ({len(rows)}):")
                for c in rows[:10]:
                    print(f"    {c.code:<16}{c.name}")
                if len(rows) > 10:
                    print(f"    … و{len(rows) - 10} غيرهم")

        if planned:
            print("\nأمثلة:")
            for c in planned[:10]:
                print(f"    {c.code:<16}{c.name}")
            if len(planned) > 10:
                print(f"    … و{len(planned) - 10} غيرهم")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        if orphans_with_moves and not force:
            print(f"\n⛔ مااتنفذش. فيه {orphans_with_moves} حساب يتيم تحت «العملاء» عليه حركة "
                  f"في الأستاذ — يعني فيه فلوس ومالوش صاحب مربوط.")
            print("   شغّل الأول:  python -m src.scripts.link_a5_party_accounts --yes")
            print("   وبعد ما تراجع اللي فضل يتيم، عيد ده بـ--force.")
            return

        made = 0
        for c in planned:
            _, created = customer_service.ensure_account(db, c)
            if created:
                made += 1
        db.commit()
        print(f"\nاتفتح {made} حساب ذمم.")
        if deferred:
            print(f"اتساب {len(deferred)} عميل عنده حساب a5 مش متربط — "
                  f"link_a5_party_accounts هو اللي بيربطهم.")
        print("تم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    run(execute="--yes" in args,
        include_plumbers="--include-plumbers" in args,
        force="--force" in args)
