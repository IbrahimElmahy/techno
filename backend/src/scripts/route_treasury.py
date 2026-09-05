"""يوجّه دور «الخزينة» لخزينة المكتب الحقيقية من a5 — بالكود، مش برقم الصف.

    python -m src.scripts.route_treasury          # يعرض بس
    python -m src.scripts.route_treasury --yes    # ينفّذ

بيتعاد تشغيله بأمان: التوجيه الموجود بيتساب، والناقص بس هو اللي بيتعمل.

---------------------------------------------------------------------------
**ليه موجود:** أول ترحيل نقدي على قاعدة اتبنت من الصفر بيخلّي
`account_resolver.get_or_create_singleton` **يخترع** حساب «الخزينة» لو مالقاش توجيه —
وده بالظبط ازدواج الخزينتين اللي `unify_general_treasury` اتكتب عشان يصلّحه: «الخزينة»
بتاعتنا جنب «خزينة المركز الرئيسى» بتاعة a5، وسؤال «في خزنة المكتب كام؟» محتاج جمع
رقمين. فالتوجيه لازم يتعمل **قبل** ما الخدمة تشتغل، مش بعد ما الغلط يحصل.

**بالكود مش بالرقم.** `unify_general_treasury` بيثبّت `OLD_ID = 9` و`NEW_ID = 1404` —
أرقام صفوف من نقل معيّن. بعد إعادة البناء الأرقام بتتغيّر كلها، والكود اللي مابيتغيّرش
هو `AL-A5S-1`: `AccBrnch_id = 1` تحت «الخزينة» في شجرة العلياء = «خزينة المركز
الرئيسى». والحارس بيتأكد إن الاسم فيه «الرئيس» قبل ما يكتب — كود صح على حساب غلط أسوأ
من رسالة خطأ.

**خزنة واحدة لكل الفروع.** الخزنة الفعلية واحدة في المكتب، وده اللي a5 نفسه عامله:
مافيش خزنة لأكتوبر في شجرة أكتوبر. فالتوجيه بيتعمل على كل فرع نشط لنفس الحساب.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.account_routing import AccountRouting
from src.models.ledger import Account, AccountType
from src.models.org import Branch
from src.models.treasury import Treasury, TreasuryKind
from src.services import account_resolver

# خزينة المكتب في شجرة a5 — العلياء، الحساب الفرعي رقم ١ تحت «الخزينة».
MAIN_SAFE_CODE = "AL-A5S-1"
MUST_CONTAIN = "الرئيس"


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        acc = db.scalar(select(Account).where(Account.code == MAIN_SAFE_CODE))
        if acc is None:
            raise SystemExit(
                f"مافيش حساب كوده {MAIN_SAFE_CODE} — "
                "شغّل import_a5_phase2 للعلياء الأول.")
        if MUST_CONTAIN not in (acc.name or ""):
            raise SystemExit(
                f"{MAIN_SAFE_CODE} اسمه «{acc.name}» — مش خزينة المركز الرئيسى. وقفت.")

        branches = db.scalars(select(Branch).where(Branch.active.is_(True))).all()
        routed = {r.branch_id: r for r in db.scalars(
            select(AccountRouting).where(AccountRouting.role == "treasury")).all()}
        default_t = db.scalar(select(Treasury).where(Treasury.is_default.is_(True)))

        print(f"الحساب: #{acc.id} «{acc.name}» ({acc.code})")
        print(f"   النوع دلوقتي: {getattr(acc.account_type, 'value', acc.account_type)}"
              f" · نظام={acc.is_system} · ترحيل={acc.is_postable}")
        print("\nهيتعمل:")
        need = [b for b in branches if b.id not in routed or routed[b.id].account_id != acc.id]
        for b in branches:
            r = routed.get(b.id)
            if r is None:
                print(f"   · توجيه «الخزينة» لفرع «{b.name}» → #{acc.id}")
            elif r.account_id != acc.id:
                print(f"   · فرع «{b.name}» كان موجّه لـ#{r.account_id} → #{acc.id}")
            else:
                print(f"   · فرع «{b.name}» موجّه صح خلاص")
        if default_t is None:
            print(f"   · صف خزنة افتراضي «{acc.name}» → #{acc.id}")
        elif default_t.account_id != acc.id:
            print(f"   · صف الخزنة الافتراضي «{default_t.name}» → #{acc.id} وبالاسم الجديد")
        else:
            print("   · صف الخزنة الافتراضي مظبوط خلاص")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        acc.account_type = AccountType.treasury
        acc.is_system = True
        acc.is_postable = True
        acc.active = True
        for b in need:
            r = routed.get(b.id)
            if r is None:
                db.add(AccountRouting(role="treasury", account_id=acc.id, branch_id=b.id))
            else:
                r.account_id = acc.id
        if default_t is None:
            db.add(Treasury(name=acc.name, kind=TreasuryKind.cash, account_id=acc.id,
                            branch_id=acc.branch_id, is_default=True, active=True))
        else:
            default_t.account_id = acc.id
            default_t.name = acc.name or default_t.name
        db.commit()

        # التحقق بعد الكتابة — بنفس الدالة اللي الترحيل بيستعملها، مش بقراءتنا إحنا.
        bad = 0
        for b in branches:
            got = account_resolver.treasury_account(db, branch_id=b.id)
            mark = "✔" if got.id == acc.id else "✘"
            bad += got.id != acc.id
            print(f"{mark} خزنة فرع «{b.name}» = #{got.id} {got.name}")
        if bad:
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
