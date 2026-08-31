"""توحيد الخزنة العامة — «خزينة المركز الرئيسى» (a5) هي خزنة المكتب الوحيدة.

    python -m src.scripts.unify_general_treasury
    python -m src.scripts.unify_general_treasury --yes

**المشكلة:** حسابين بيلعبوا دور «خزنة المكتب» جنب بعض. «الخزينة» (#9) عملها نظامنا
قبل نقل شجرة a5، والترحيل الأوتوماتيكي بيقع عليها؛ و«خزينة المركز الرئيسى» (#1418)
جت من a5 بكل التاريخ — دي اللي فيها فلوس المكتب الحقيقية. فسؤال «في خزنة المكتب
كام؟» بقى محتاج جمع رقمين من حسابين، وكل يوم شغل بيكبّر الفرق.

**اللي بيحصل هنا — بالترتيب:**

١. رصيد #9 بيتنقل لـ#1418 بقيد تحويل بيانه صريح — مافيش قيد قديم بيتلمس.
٢. «الخزينة» #9 بتتقفل وبتفقد صفة النظام. تاريخها بيفضل مقروء زي ما هو.
٣. صف `treasury` الافتراضي (اللي السندات المكتبية بتيجي منه) بيشاور على #1418
   وبياخد اسمها.
٤. **التوجيه المحاسبي**: دور «الخزينة» بيتوجّه لـ#1418 على كل الفروع — الخزنة
   الفعلية واحدة في المكتب، وده اللي a5 نفسه كان عامله.

إلغاء الرجوع: امسح صفوف التوجيه، رجّع صف الـtreasury لحساب 9، واعكس قيد التحويل.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.account_routing import AccountRouting
from src.models.ledger import Account, Direction
from src.models.org import Branch
from src.models.treasury import Treasury
from src.services import account_resolver, ledger_service
from src.services.ledger_service import LineInput

OLD_ID = 9      # «الخزينة» — بتاعتنا القديمة
NEW_ID = 1418   # «خزينة المركز الرئيسى» — a5


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        old = db.get(Account, OLD_ID)
        new = db.get(Account, NEW_ID)
        assert old is not None and new is not None, "الحسابين مش موجودين"
        assert "الرئيسى" in (new.name or "") or "الرئيسي" in (new.name or ""), \
            f"#{NEW_ID} مش المركز الرئيسى: {new.name}"

        bal_old = ledger_service.balance_of(db, OLD_ID)
        bal_new = ledger_service.balance_of(db, NEW_ID)
        print(f"«{old.name}» #{OLD_ID}: {bal_old} ج")
        print(f"«{new.name}» #{NEW_ID}: {bal_new} ج")

        branches = db.scalars(select(Branch).where(Branch.active.is_(True))).all()
        existing = {
            r.branch_id for r in db.scalars(select(AccountRouting).where(
                AccountRouting.role == "treasury")).all()
        }
        t = db.scalar(select(Treasury).where(Treasury.is_default.is_(True)))

        print("\nهيتعمل:")
        if bal_old != 0:
            print(f"  · قيد تحويل {bal_old} ج من #{OLD_ID} إلى #{NEW_ID}")
        else:
            print("  · مافيش رصيد يتنقل")
        print(f"  · قفل #{OLD_ID} وشيل صفة النظام منه")
        if t is not None:
            print(f"  · صف الخزنة الافتراضي «{t.name}» → حساب #{NEW_ID} وبالاسم الجديد")
        rows_needed = [b for b in branches if b.id not in existing]
        print(f"  · توجيه «الخزينة» → #{NEW_ID} على الفروع: "
              + "، ".join(b.name for b in rows_needed))

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        if bal_old != 0:
            # الرصيد ممكن يكون سالب نظرياً — الاتجاهات بتتعكس ساعتها.
            debit, credit = (NEW_ID, OLD_ID) if bal_old > 0 else (OLD_ID, NEW_ID)
            amount = abs(bal_old)
            stmt = "توحيد الخزنة العامة — نقل رصيد «الخزينة» لخزينة المركز الرئيسى"
            entry = ledger_service.post_entry(
                db, entry_type="journal", actor_user_id=1,
                description=stmt,
                lines=[
                    LineInput(debit, Direction.debit, amount, statement=stmt),
                    LineInput(credit, Direction.credit, amount, statement=stmt),
                ],
            )
            print(f"✔ قيد التحويل #{entry.id}")

        old.active = False
        old.is_system = False
        # ⚠️ سيب new.is_system زي ما هي — دي اللي بتخليها تكسب لو التوجيه اتشال.
        new.is_system = True

        if t is not None:
            t.account_id = NEW_ID
            t.name = new.name or t.name

        for b in rows_needed:
            db.add(AccountRouting(role="treasury", account_id=NEW_ID, branch_id=b.id))

        db.commit()

        # التحقق بعد الكتابة — بنفس الدوال اللي الترحيل بيستعملها، مش بقراءتنا إحنا.
        for b in branches:
            acc = account_resolver.treasury_account(db, branch_id=b.id)
            mark = "✔" if acc.id == NEW_ID else "✘"
            print(f"{mark} خزنة فرع «{b.name}» = #{acc.id} {acc.name}")
        print(f"رصيد #{OLD_ID} بعد النقل: {ledger_service.balance_of(db, OLD_ID)}")
        print(f"رصيد #{NEW_ID} بعد النقل: {ledger_service.balance_of(db, NEW_ID)}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
