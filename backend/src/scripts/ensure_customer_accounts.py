"""يفتح حساب ذمم للعملاء اللي مالهمش واحد.

    python -m src.scripts.ensure_customer_accounts                    # يعرض بس
    python -m src.scripts.ensure_customer_accounts --yes              # ينفّذ
    python -m src.scripts.ensure_customer_accounts --include-plumbers # يضم السباكين كمان

بيتعاد تشغيله بأمان: اللي عنده حساب بيتساب زي ما هو، ومافيش حد بياخد حساب تاني.

---------------------------------------------------------------------------
## المشكلة

`create_customer` بيفتح حساب مع كل عميل جديد، بس ده الطريق الوحيد اللي بيفتح حساب. أي عميل
دخل بأي طريق تاني — نقل a5، استيراد ERP، دمج — دخل من غير حساب. القياس على السيرفر:
**٣٬٨٨٤ عميل، ١٬٤٦٥ عندهم حساب، ٢٬٤١٩ لأ** (٢٬١٠٩ سباك + ٣١٠ تاجر).

والعميل اللي مالوش حساب مش «شكله وحش» وخلاص — هو **ممنوع يتعامل**: البيع والسند
والمرتجع كلهم بيقفوا على «العميل ده مالوش حساب ذمم».

## قرار: السباكين مابياخدوش حسابات (إلا لو طلبتها بـ`--include-plumbers`)

السباك في الدورة دي مابيشتريش. الكوبون بيتصرف **للتاجر** من نقاط بيع اتعملت له، التاجر
بيدّي الورق للسباك تسويق، والسباك بيرجّعه لنا. استلام الكوبون من السباك مابيرحّلش أي قيد
(`coupon_receipt_service` مافيهوش ledger خالص)، والصرف بيترحّل على `coupon.customer_id`
— يعني على التاجر صاحب الكوبون، مش على السباك اللي رجّعه.

فـ٢٬١٠٩ حساب للسباكين = ٢٬١٠٩ عقدة زيادة تحت «العملاء» في الشجرة وفي ميزان المراجعة،
رصيدها صفر النهاردة وصفر بعد سنة. والمشكلة اللي كانت بتوجعهم — التوست الأحمر على كارت
السباك — اتحلّت في `customers.py` نفسها: العميل اللي مالوش حساب بقى بيرجّع قايمة فاضية
ورصيد صفر بدل 404.

لو يوم اتباع لسباك فعلاً: `--include-plumbers`، أو `create_customer` هيفتحله واحد لوحده.

## العميل المعطّل بيتساب

الدمج (`customer_merge_service`) بيعطّل الصف المكرر وبينقل **حسابه** للعميل الباقي. يعني
العميل المعطّل اللي مالوش حساب هو بالظبط النص التاني من دمج ناجح — وفتح حساب له بيرجّعه
عقدة في الشجرة تاني، وده عكس اللي الدمج اتعمل عشانه.
"""
from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.services import customer_service

# النوع الوحيد اللي مالوش طريق يوصل بيه لرصيد ذمم — شوف الشرح فوق.
SKIPPED_TYPES = {"plumber", "سباك"}


def run(*, execute: bool, include_plumbers: bool) -> None:
    db = SessionLocal()
    try:
        customers = db.scalars(select(Customer)).all()
        with_account = {a.customer_id for a in db.scalars(select(CustomerAccount)).all()}

        # (نوع، حالة) -> عدد، عشان الجدول اللي بيتطبع يقول نفس الأرقام اللي القرار اتبنى عليها.
        tally: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        planned: list[Customer] = []
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

        if planned:
            print("\nأمثلة:")
            for c in planned[:10]:
                print(f"    {c.code:<16}{c.name}")
            if len(planned) > 10:
                print(f"    … و{len(planned) - 10} غيرهم")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        made = 0
        for c in planned:
            _, created = customer_service.ensure_account(db, c)
            if created:
                made += 1
        db.commit()
        print(f"\nاتفتح {made} حساب ذمم.")
        print("تم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    run(execute="--yes" in args, include_plumbers="--include-plumbers" in args)
