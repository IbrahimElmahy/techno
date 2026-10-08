# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountNature, Direction, LedgerLine
from src.models.supplier import Supplier, SupplierAccount
from src.services.financial_reports_service import effective_nature


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--set", action="append", default=[], metavar="ID=NATURE",
                    help="تصنيف صريح لحساب مش مربوط بعميل ولا مورد، "
                         "مثلاً --set 3802=expense")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        signed = func.sum(case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
                               else_=-LedgerLine.amount))
        balances = dict(db.execute(
            select(LedgerLine.account_id, signed).group_by(LedgerLine.account_id)).all())
        cust = {a for (a,) in db.execute(select(CustomerAccount.account_id)).all()}
        sup = {a for (a,) in db.execute(select(SupplierAccount.account_id)).all()}
        cust_names = {n for (n,) in db.execute(select(Customer.name)).all() if n}
        sup_names = {n for (n,) in db.execute(select(Supplier.name)).all() if n}

        forced: dict[int, AccountNature] = {}
        for pair in args.set:
            aid, _, nat = pair.partition("=")
            forced[int(aid)] = AccountNature(nat.strip())

        rows, unknown = [], []
        for acc in db.scalars(select(Account)).all():
            if effective_nature(acc) is not None:
                continue
            bal = Decimal(str(balances.get(acc.id, 0) or 0))
            if acc.id in forced:
                rows.append((acc, forced[acc.id], "اتقال صراحةً", bal))
            elif acc.id in cust:
                rows.append((acc, AccountNature.asset, "مربوط بعميل", bal))
            elif acc.id in sup:
                rows.append((acc, AccountNature.liability, "مربوط بمورد", bal))
            elif acc.name and acc.name in cust_names:
                rows.append((acc, AccountNature.asset, "اسمه اسم عميل موجود", bal))
            elif acc.name and acc.name in sup_names:
                rows.append((acc, AccountNature.liability, "اسمه اسم مورد موجود", bal))
            elif abs(bal) > Decimal("0.005"):
                unknown.append((acc, bal))

        print(f"{'id':>6} {'الاسم':<28} {'الرصيد':>14} {'الطبيعة':<10} السبب")
        for acc, nat, why, bal in sorted(rows, key=lambda r: -abs(r[3])):
            print(f"{acc.id:>6} {str(acc.name)[:28]:<28} {bal:>14,.2f} {nat.value:<10} {why}")
        print()
        print(f"هيتصلّح: {len(rows)} حساب | إجمالي أرصدتهم "
              f"{sum(r[3] for r in rows):,.2f}")
        if unknown:
            print()
            print(f"⚠ مالهمش طبيعة ومش مربوطين بعميل ولا مورد — محتاجين تصنيف بإيدك ({len(unknown)}):")
            for acc, bal in unknown:
                print(f"   #{acc.id} {acc.code} {acc.name} = {bal:,.2f}")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        for acc, nat, _why, _bal in rows:
            acc.nature = nat
        db.commit()
        print()
        print(f"اتكتب: {len(rows)} حساب")

        left = [a for a in db.scalars(select(Account)).all()
                if effective_nature(a) is None
                and abs(Decimal(str(balances.get(a.id, 0) or 0))) > Decimal("0.005")]
        print(f"الباقي من غير طبيعة وعليه رصيد: {len(left)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
