"""يربط العملاء اللي الرابط رفض يخمّن فيهم — «العملاء» للعميل و«ذمم الموظفين» للموظف.

    python -m src.scripts.link_ambiguous_party_accounts          # يعرض بس
    python -m src.scripts.link_ambiguous_party_accounts --yes    # ينفّذ

**الحكاية من a5 نفسه، مش استنتاج.** فتحت الشجرة ولقيت إن **نفس الاسم له حسابين**:

    كامل هلول      العملاء→AL-A5S-1041   ذمم الموظفين→AL-A5S-9      ١٬٢٣٩ سطر
    حسن رمضان      العملاء→AL-A5S-1611   ذمم الموظفين→AL-A5S-1504      ٩٠
    معرض الزوغبي   العملاء→A5S-519       ذمم الموظفين→A5S-928          ٦٠
    ... ١٨ اسم كده

الموظف اللي بيشتري بيبقى ليه حساب عميل (مديونية البضاعة) وحساب ذمم موظفين (السلف
وخصومات المرتب) — حسابين لنفس الشخص بغرضين مختلفين، وده منطق a5 وسليم.

**والرابط عندنا كان بيدوّر في المجموعتين مع بعض:**

    CUSTOMER_GROUPS = ("العملاء", "ذمم الموظفين")

فبيلاقي حسابين للاسم الواحد، وقاعدته «الملتبس بيتساب مش بيتخمّن» بتوقّفه. القاعدة دي
**صح** — بس الالتباس هنا مش حقيقي: الحسابين مش بديلين، كل واحد له دور.

**الحل: الأولوية لـ«العملاء».** الكارت اللي بنربطه هو كارت العميل، ومديونية البيع
بتقعد على حساب العملاء. حساب «ذمم الموظفين» بتاع السلف — ملهوش دعوة بفاتورة بيع،
وبيفضل مستقل زي ما هو في a5.

⚠️ **بيربط اللي تحت «العملاء» بس.** اللي مالوش حساب هناك خالص (زي «تكنووو ثيرم»
و«المصنع السادات» — دول حساباتهم تحت **الموردون** لأنهم فروعنا) **مابيتلمسوش**:
الشرا والبيع معاهم بيمشي على حساب المورد، وده اللي a5 عامله ومالوش داعي يتغيّر.
"""
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
        # حسابات «العملاء» بس — مش «ذمم الموظفين» معاها.
        parents = {a.id for a in db.scalars(select(Account))
                   if (a.name or "").strip() == CUSTOMER_GROUP and not a.is_postable}
        book: dict[tuple[int | None, str], list[Account]] = defaultdict(list)
        for a in db.scalars(select(Account).where(Account.parent_id.in_(parents))):
            book[(a.branch_id, _norm(a.name or ""))].append(a)

        taken = {a.account_id for a in db.scalars(select(CustomerAccount))}
        linked = {a.customer_id for a in db.scalars(select(CustomerAccount))}

        rows = db.scalars(select(Customer).where(Customer.active.is_(True))).all()
        # الكروت اللي بنفس الاسم في نفس الفرع — التباس حقيقي، بيفضل مسكوت عنه.
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
