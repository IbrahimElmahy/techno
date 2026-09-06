"""يربط الأطراف الداخلية بحساباتها الحقيقية في شجرة a5.

    python -m src.scripts.link_house_party_accounts          # يعرض بس
    python -m src.scripts.link_house_party_accounts --yes    # ينفّذ

بيتعاد تشغيله بأمان: اللي متربط خلاص بيتخطّى.

---------------------------------------------------------------------------
**المشكلة:** `import_a5_docs` بيخترع كارت (`A5X{n}`) للطرف اللي على المستند ومش في
كشف `Cust`. تلاتة اتخترعوا كده، وكلهم كيانات تكنو نفسها مش زباين برّه:

| الكارت | المستندات | حساب a5 |
|---|---|---|
| `AL-A5X1` تكنووو ثيرم | ١١٦ فاتورة · ٥٤٦٬٥٦٦ | `AL-A5S-97` |
| `A5X1` المصنع السادات | فاتورة واحدة · ١٣٠ | `A5S-657` |
| `AL-A5X2` فرع اكتوبر | ٢٦ فاتورة | متربط خلاص بـ`AL-A5S-1435` |

الكارتين الأولانيين **مالهمش حساب ذمم**، فكشف حسابهم في النظام بيقرا صفر وهما
عليهم حركة حقيقية. **والدفتر نفسه مظبوط** — `import_a5_ledger` نقل قيود a5 كما هي،
والتحقق طلع ٩٤٥/٩٤٥ و٤٤٤/٤٤٤ مطابق. الناقص هو **الربط بين الكارت والحساب**، اللي
شاشة كشف الحساب بتقرا منه.

**الحسابين موجودين في a5 تحت «الموردون» مش «العملاء».** ده مقصود من العميل: تكنو
بتبيع لنفسها وبتشتري من نفسها على نفس الكارت، وa5 بيمسك الاتجاهين على حساب واحد
(`AL-A5S-97` رصيده **سالب ٢٧٥٬٤١١.٧٤** — يعني احنا مدينين له، و`A5S-657` **موجب
٣١٦٬١٠٣.٩٣**). فالربط بيتم على الحساب اللي a5 مستعمله فعلاً، **مش** على حساب ذمم
جديد بنعمله احنا — حساب جديد معناه رصيد بيتقسم على اتنين ومافيش واحد فيهم صح.

**المطابقة بكود الحساب مش بالاسم.** «تكنووو ثيرم» بتلات واوات، و«المصنع السادات»
متكرر تلات مرات في الشجرة تحت تلات آباء (`6` الموردون، `11`، `12`). الكود بيحدد
واحد بعينه — الاسم لأ.
"""
from __future__ import annotations

import sys

from sqlalchemy import case, func, select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, Direction, LedgerLine

# كود الكارت → كود حساب a5 اللي الحركة قاعدة عليه.
PAIRS: dict[str, str] = {
    "AL-A5X1": "AL-A5S-97",   # تكنووو ثيرم — تحت «الموردون»
    "A5X1": "A5S-657",        # المصنع السادات — تحت «الموردون»
}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        bal = dict(db.execute(
            select(LedgerLine.account_id,
                   func.sum(case((LedgerLine.direction == Direction.debit,
                                  LedgerLine.amount), else_=0))
                   - func.sum(case((LedgerLine.direction == Direction.credit,
                                    LedgerLine.amount), else_=0)))
            .group_by(LedgerLine.account_id)).all())

        plan: list[tuple[Customer, Account]] = []
        notes: list[str] = []
        for ccode, acode in PAIRS.items():
            c = db.scalar(select(Customer).where(Customer.code == ccode))
            a = db.scalar(select(Account).where(Account.code == acode))
            if c is None:
                notes.append(f"{ccode}: كارت مش موجود — اتخطّى")
                continue
            if a is None:
                notes.append(f"{acode}: حساب مش موجود — اتخطّى")
                continue
            have = db.scalar(select(CustomerAccount).where(
                CustomerAccount.customer_id == c.id))
            if have is not None:
                notes.append(f"{ccode} «{c.name}»: ليه حساب خلاص ({have.account_id})")
                continue
            # الحساب مايكونش شغّال لكارت تاني — رصيد واحد مايتقسمش على اتنين.
            other = db.scalar(select(CustomerAccount).where(
                CustomerAccount.account_id == a.id))
            if other is not None:
                oc = db.get(Customer, other.customer_id)
                notes.append(f"{acode}: مربوط بـ{oc.code if oc else other.customer_id} — اتخطّى")
                continue
            plan.append((c, a))

        print(f"{'':<14}{'الكارت':<24}{'الحساب':<14}{'رصيد الحساب':>16}")
        for c, a in plan:
            print(f"   هيتربط  {c.code:<12}{c.name[:20]:<22}{a.code:<14}"
                  f"{bal.get(a.id, 0):>16}")
        if notes:
            print("\nملاحظات:")
            for n in notes:
                print("   •", n)
        if not plan:
            print("\nمافيش حاجة تتربط.")
            return
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, a in plan:
            db.add(CustomerAccount(customer_id=c.id, account_id=a.id))
        db.commit()

        print(f"\n✔ اتربط {len(plan)} كارت")
        left = []
        for c in db.scalars(select(Customer).where(Customer.code.like("%A5X%"))).all():
            if db.scalar(select(CustomerAccount).where(
                    CustomerAccount.customer_id == c.id)) is None:
                left.append(c.code)
        print(f"   كروت مخترعة لسه بلا حساب: {left or 'مافيش'}")
    finally:
        db.close()


def main() -> None:
    run(execute="--yes" in sys.argv[1:])


if __name__ == "__main__":
    main()
