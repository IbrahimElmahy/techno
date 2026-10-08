# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import case, func, select

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.customer import CustomerAccount
from src.models.ledger import Account, LedgerEntry, LedgerLine
from src.models.sales import SalesInvoice
from src.services.ledger_service import is_posted_sql

ZERO = Decimal("0")


def balance_before(db, account_ids: list[int], entry_id: int | None) -> Decimal:
    if not account_ids:
        return ZERO
    signed = case(
        (LedgerLine.direction == Account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    q = (select(func.coalesce(func.sum(signed), 0))
         .select_from(LedgerLine)
         .join(Account, Account.id == LedgerLine.account_id)
         .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
         .where(LedgerLine.account_id.in_(account_ids), is_posted_sql()))
    if entry_id:
        q = q.where(LedgerEntry.id < entry_id)
    return to_money(db.scalar(q) or 0)


def main() -> None:
    ap = argparse.ArgumentParser(description="الحساب السابق بحساب نوع الفاتورة")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=12)
    args = ap.parse_args()

    db = SessionLocal()
    try:
        split = {cid for (cid,) in db.execute(
            select(CustomerAccount.customer_id)
            .group_by(CustomerAccount.customer_id)
            .having(func.count() > 1)).all()}
        invoices = db.scalars(
            select(SalesInvoice)
            .where(SalesInvoice.prior_balance.is_not(None),
                   SalesInvoice.customer_id.in_(split or {-1}))
            .order_by(SalesInvoice.id)).all()

        accounts: dict[int, list[CustomerAccount]] = {}
        for a in db.scalars(select(CustomerAccount).where(
                CustomerAccount.customer_id.in_(split or {-1}))).all():
            accounts.setdefault(a.customer_id, []).append(a)

        changed = []
        for inv in invoices:
            accs = accounts.get(inv.customer_id, [])
            mine = [a for a in accs if inv.family and a.family == inv.family]
            others = [a for a in accs if inv.family and a.family and a.family != inv.family]
            if not mine:
                continue
            new_other = (balance_before(db, [a.account_id for a in others], inv.ledger_entry_id)
                         if others else None)
            new_prior = (to_money(to_money(inv.prior_balance) - new_other)
                         if new_other is not None
                         else balance_before(db, [a.account_id for a in mine], inv.ledger_entry_id))
            other_name = (others[0].family if len({a.family for a in others}) == 1
                          else None) if others else None
            old = to_money(inv.prior_balance or 0)
            if (old == new_prior and inv.other_family_balance == new_other
                    and inv.other_family == other_name):
                continue
            changed.append((inv.document_number, inv.family, old, new_prior,
                            other_name, new_other))
            if args.yes:
                inv.prior_balance = new_prior
                inv.other_family_balance = new_other
                inv.other_family = other_name

        print(f"{'فواتير عملاء بخطّين وليها حساب سابق':<40}{len(invoices):>8,}")
        print(f"{'هتتصلّح':<40}{len(changed):>8,}")
        if changed:
            print(f"\n{'المستند':<14}{'النوع':<8}{'كان':>14}{'بقى':>14}   {'التاني':<8}{'رصيده':>14}")
            for doc, fam, old, new, oname, oval in changed[: args.limit]:
                print(f"{doc:<14}{fam or '-':<8}{float(old):>14,.2f}{float(new):>14,.2f}"
                      f"   {oname or '-':<8}{float(oval or 0):>14,.2f}")
            if len(changed) > args.limit:
                print(f"   … و{len(changed) - args.limit:,} تانيين")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتصلّح {len(changed):,}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
