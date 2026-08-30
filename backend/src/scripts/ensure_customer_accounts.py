"""يفتح حساب ذمم للعملاء اللي مالهمش واحد.

    python -m src.scripts.ensure_customer_accounts                    # يعرض بس
    python -m src.scripts.ensure_customer_accounts --yes              # ينفّذ
    python -m src.scripts.ensure_customer_accounts --include-plumbers # يضم السباكين كمان
    python -m src.scripts.ensure_customer_accounts --yes --force      # ينفّذ رغم وجود يتامى

بيتعاد تشغيله بأمان: اللي عنده حساب بيتساب زي ما هو، ومافيش حد بياخد حساب تاني.

---------------------------------------------------------------------------
## المشكلة

`create_customer` بيفتح حساب مع كل عميل جديد، بس ده الطريق الوحيد اللي بيفتح حساب. أي عميل
دخل بأي طريق تاني — نقل a5، استيراد ERP، دمج — دخل من غير حساب. القياس على السيرفر:
**٣٬٨٨٤ عميل، ١٬٤٦٥ عندهم حساب، ٢٬٤١٩ لأ** (٢٬١٠٩ سباك + ٣١٠ تاجر).

والعميل اللي مالوش حساب مش «شكله وحش» وخلاص — هو **ممنوع يتعامل**: البيع والسند
والمرتجع كلهم بيقفوا على «العميل ده مالوش حساب ذمم».

## 🚩 الترتيب مع `link_a5_party_accounts` — ده كان فخ صامت

العميل المنقول من a5 **حسابه موجود أصلاً** في الشجرة تحت «العملاء»، وفيه مديونيته الحقيقية؛
اللي ناقص هو الربط، و`link_a5_party_accounts` هو اللي بيعمله بالمطابقة على الاسم المتطبّع.

وسكربت الربط بيبني `linked_c = {a.customer_id for a in CustomerAccount}` وبيعدّي أي عميل في
السِت دي بـ«متربط قبل كده» (`link_a5_party_accounts.py:66,81-83`). يعني لو السكربت ده اشتغل
الأول وفتح لتاجر منقول **حساب جديد فاضي**، سكربت الربط بعد كده هيعدّيه في صمت، وحسابه
الحقيقي بمديونيته يفضل يتيم للأبد. الكارت هيقول «رصيد صفر» بدل «عليه كذا»، ومافيش حاجة
هتشتكي. والأرقام بتقول إن الحالة دي واردة فعلاً: ١٬٩٦٦ حساب تحت «العملاء» مقابل ١٬٤٦٥ عميل
متربط ⇒ ~٥٠٠ حساب لسه يتيم، مقابل ٣١٠ تاجر من غير حساب.

فالسكربت ده دلوقتي بيعمل حاجتين قبل ما يفتح أي حساب:

1. **بيطابق بنفس تطبيع الاسم بتاع سكربت الربط** (`_norm`) على الحسابات اليتيمة تحت
   «العملاء»/«ذمم الموظفين» في نفس فرع العميل. أي عميل بيطابق واحد — أو بيطابق أكتر من
   واحد، أو فيه أكتر من عميل بنفس الاسم في نفس الفرع — بيتشال من التنفيذ وبيتطبع في بند
   لوحده: **شغّل `link_a5_party_accounts` الأول**.
2. **بيعُدّ اليتامى اللي عليهم حركة في الأستاذ** — دول اللي فيهم فلوس فعلاً. لو فيه واحد
   منهم على الأقل بيرفض التنفيذ ويقول شغّل `link_a5_party_accounts --yes` الأول، لأن
   المطابقة بالاسم مابتلقطش اختلاف الإملا (لقب زايد، «عبد» و«عبدالـ»)، وحساب فيه مديونية
   ومربوطش = بالظبط الحالة اللي بتتخفي وراء حساب فاضي رصيده صفر. `--force` بيتخطاها لما
   تكون شغّلت سكربت الربط وراجعت الباقي بإيدك.

## قرار: السباكين مابياخدوش حسابات (إلا لو طلبتها بـ`--include-plumbers`)

السباك في الدورة دي مابيشتريش. الكوبون بيتصرف **للتاجر** من نقاط بيع اتعملت له، التاجر
بيدّي الورق للسباك تسويق، والسباك بيرجّعه لنا. استلام الكوبون من السباك مابيرحّلش أي قيد
(`coupon_receipt_service` مافيهوش ledger خالص)، والصرف بيترحّل على `coupon.customer_id`
— يعني على التاجر صاحب الكوبون، مش على السباك اللي رجّعه.

فـ٢٬١٠٩ حساب للسباكين = ٢٬١٠٩ عقدة زيادة تحت «العملاء» في الشجرة وفي ميزان المراجعة،
رصيدها صفر النهاردة وصفر بعد سنة.

⚠️ التوست الأحمر على كارت السباك **اتحل نُص**: `GET /customers/{id}/accounts` و`/account`
في `customers.py` بقوا يرجّعوا قايمة فاضية ورصيد صفر بدل 404، لكن
`GET /customers/{id}/statement` في `vouchers.py` لسه بيرمي 404 «العميل ليس له حساب ذمم»،
و`CustomerProfile.tsx` بينده عليه على كل فتح كارت، والـinterceptor بيطلّع التوست قبل أي
catch محلي. محتاجة تعديل في `vouchers.py` (برّه نطاق السكربت ده): عميل موجود ومالوش حساب
يرجّع كشف فاضي، والـ404 يفضل للعميل المش موجود بس.

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
from src.models.ledger import LedgerLine
from src.models.supplier import SupplierAccount
from src.scripts.link_a5_party_accounts import CUSTOMER_GROUPS, _accounts_under, _norm
from src.services import customer_service

# النوع الوحيد اللي مالوش طريق يوصل بيه لرصيد ذمم — شوف الشرح فوق.
SKIPPED_TYPES = {"plumber", "سباك"}


def _orphan_customer_accounts(db):
    """حسابات a5 تحت «العملاء»/«ذمم الموظفين» اللي لسه مامربوطش بيها أي طرف.

    نفس مصدر `link_a5_party_accounts` بالظبط — نفس المجموعات ونفس `_norm` — عشان اللي
    بيتحسب هنا «هيتربط بكرة» يبقى هو هو اللي سكربت الربط هيشوفه، مش تقريب ليه.
    """
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

        # كام عميل بنفس الاسم المتطبّع في نفس الفرع — الملتبس مابيتفتحلوش حساب جديد، زي
        # ما سكربت الربط مابيربطوش، عشان مايتحطّش قدام حسابه الحقيقي.
        same_name: dict[tuple[int | None, str], int] = defaultdict(int)
        for c in customers:
            same_name[(c.branch_id, _norm(c.name or ""))] += 1

        # (نوع، حالة) -> عدد، عشان الجدول اللي بيتطبع يقول نفس الأرقام اللي القرار اتبنى عليها.
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
                # عنده حساب في الشجرة فعلاً — فتح واحد جديد هنا معناه إن سكربت الربط
                # هيعدّيه بـ«متربط قبل كده»، ومديونيته تتيتّم في صمت.
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

        # اليتامى: حسابات تحت «العملاء» مامربوطش بيها حد. اللي عليها حركة هي الخطر —
        # فيها فلوس، وفتح حساب فاضي لصاحبها بيخفيها.
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
            # المطابقة بالاسم فوق بتلقط المطابق حرفياً بس؛ اختلاف إملا واحد بيخليها تفوت،
            # والنتيجة حساب فاضي رصيده صفر قدام مديونية حقيقية. فالتنفيذ بيقف هنا.
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
