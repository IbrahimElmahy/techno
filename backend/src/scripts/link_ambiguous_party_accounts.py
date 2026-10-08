from __future__ import annotations

import re
import sys
from collections import defaultdict

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account
from src.models.sales import SalesInvoice

CUSTOMER_GROUP = "العملاء"


def _norm(s: str) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s or "")
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    return re.sub(r"\s+", " ", s).strip()


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        parents = {a.id for a in db.scalars(select(Account))
                   if (a.name or "").strip() == CUSTOMER_GROUP and not a.is_postable}
        book: dict[tuple[int | None, str], list[Account]] = defaultdict(list)
        for a in db.scalars(select(Account).where(Account.parent_id.in_(parents))):
            book[(a.branch_id, _norm(a.name or ""))].append(a)

        taken = {a.account_id for a in db.scalars(select(CustomerAccount))}
        linked = {a.customer_id for a in db.scalars(select(CustomerAccount))}

        rows = db.scalars(select(Customer).where(Customer.active.is_(True))).all()
        by_name: dict[tuple[int | None, str], int] = defaultdict(int)
        for c in rows:
            by_name[(c.branch_id, _norm(c.name))] += 1

        plan: list[tuple[Customer, Account, int]] = []
        skipped: list[str] = []
        for c in rows:
            if c.id in linked:
                continue
            key = (c.branch_id, _norm(c.name))
            hits = [a for a in book.get(key, []) if a.id not in taken]
            n = db.scalar(select(func.count()).select_from(SalesInvoice)
                          .where(SalesInvoice.customer_id == c.id)) or 0
            if not hits:
                continue
            if len(hits) > 1 or by_name[key] > 1:
                skipped.append(f"{c.name} ({c.code}) — {len(hits)} حساب × "
                               f"{by_name[key]} كارت")
                continue
            taken.add(hits[0].id)
            plan.append((c, hits[0], n))

        print(f"{'العميل':<26}{'الحساب':<16}{'فواتير':>7}")
        print("-" * 52)
        for c, a, n in sorted(plan, key=lambda r: -r[2]):
            print(f"{(c.name or '')[:24]:<26}{(a.code or ''):<16}{n:>7}")
        print(f"\nهيتربط: {len(plan)}   (منهم عليهم فواتير: "
              f"{sum(1 for _c, _a, n in plan if n)})")

        if skipped:
            print(f"\n⚠️ لسه ملتبس — مش هيتربط ({len(skipped)}):")
            for s in skipped[:12]:
                print(f"   {s}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, a, _n in plan:
            db.add(CustomerAccount(customer_id=c.id, account_id=a.id))
        db.commit()

        left = db.scalar(
            select(func.count()).select_from(Customer)
            .where(Customer.active.is_(True),
                   ~Customer.id.in_(select(CustomerAccount.customer_id)),
                   Customer.id.in_(select(SalesInvoice.customer_id)))) or 0
        print(f"\n✔ اتربط {len(plan)} عميل. لسه عليهم فواتير وبلا حساب: {left}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
