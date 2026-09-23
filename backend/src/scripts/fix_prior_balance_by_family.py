# -*- coding: utf-8 -*-
"""«الحساب السابق» على الفواتير القديمة — بحساب نوع الفاتورة، مش الاتنين مع بعض.

    python -m src.scripts.fix_prior_balance_by_family
    python -m src.scripts.fix_prior_balance_by_family --yes

---------------------------------------------------------------------------
`prior_balance` كان بيتقاس على **كل** حسابات العميل. للعميل اللي عنده خطّين (أبيض
وبولي) ده بيطلع رقم مخلوط: فاتورة أبيض فوقيها مديونية أبيض + بولي، والورقة بتجمعهم
في «الإجمالي» — رقم مالوش حساب يتسدّ فيه.

الخدمة اتصلّحت للفواتير الجاية. ده بيصلّح اللي اتكتب قبلها، عشان الفاتورة القديمة
لما تتطبع تاني تقول نفس اللي الجديدة بتقوله.

## بيتحسب إزاي

زي ما الخدمة بتحسبه **لحظة الترحيل**: رصيد الحساب من القيود اللي كانت مترحّلة قبل قيد
الفاتورة دي (`entry_id < قيد الفاتورة`). الأرقام مسلسلة بالوقت في اللي اتكتب عندنا،
فده نفس الرقم اللي كانت الخدمة هتشوفه ساعتها لو كانت بتقيس صح.

## بيمسّ إيه

الفواتير اللي **ليها** `prior_balance` خلاص بس — دي اللي بتطبع السطر. المنقولة من a5
مالهاش الرقم أصلاً ومابتطبعش السطر، فمابتتلمسش.

والعميل اللي عنده حساب واحد رقمه صح من الأول — مش في الكشف.

بيتعاد بأمان: اللي رقمه مظبوط بيتخطّى.
"""
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
    """رصيد الحسابات دي من القيود اللي قبل `entry_id`."""
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
            # **المجموع القديم هو الأصل، والتقسيمة بس اللي بتتحسب.**
            #
            # الحساب المباشر (رصيد خط الفاتورة قبل قيدها) بيطابق الرقم المتخزّن في ٧٠ من
            # ٨٩، والـ١٩ الباقيين بيختلفوا — لحد ٦٦ ألف. دول فواتير **اتعدّلت**: التعديل
            # بيعمل قيد جديد برقم أكبر، فـ«قبل القيد» بقى بيشمل حركات حصلت بين الترحيل
            # الأول والتعديل، والرقم المتخزّن اتاخد يوم الترحيل الأول.
            #
            # والرقم المتخزّن ده **اتطبع واتسلّم للعميل**. فبيفضل مجموعه زي ما هو، واللي
            # بيتحسب هو الخط التاني بس: خط الفاتورة = المتخزّن − التاني. في الـ٧٠ ده نفس
            # الحساب المباشر بالظبط؛ وفي الـ١٩ الورقة الجديدة بتجمع لنفس الرقم اللي اتقال.
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
