"""فتح المتبقّي على السطور القديمة ومطابقتها — المرحلة ٣ من إعادة الهيكلة على موديل أودو.

    python -m src.scripts.backfill_reconcile              # عرض بس
    python -m src.scripts.backfill_reconcile --yes        # يفتح المتبقّي بس
    python -m src.scripts.backfill_reconcile --yes --match  # ويطابق الأقدم أولاً كمان

**المشكلة:** المتبقّي بيتفتح عند الترحيل، فالقيود اللي اتكتبت قبل المرحلة دي
`amount_residual` فيها NULL. يعني كل فواتير العملاء القديمة مش هتظهر في شاشة
المطابقة، وتقرير الأعمار هيفضل شغّال بالطريقة القديمة عليها.

**اللي بيحصل هنا:**

١. كل سطر على حساب قابل للتسوية (ذمم عميل أو مورد) بياخد متبقّيه الابتدائي =
   قيمته بإشارتها. والسطر على حساب تاني بيتساب NULL — مش صفر.
٢. `payment_state` بيتحسب على كل مستند من سطوره.
٣. `--match` بيشغّل المطابقة التلقائية لكل طرف: الأقدم استحقاقاً يتقفل الأول.

**ليه `--match` منفصل؟** المطابقة بتقول «الدفعة دي قفلت الفاتورة دي»، وده ادّعاء
عن الماضي. الافتراض (الأقدم الأول) هو **نفس** اللي تقرير الأعمار كان شغّال بيه من
غير ما يكتبه، فتشغيله بيخلّي الأرقام زي ما هي بالظبط ويخلّي الادّعاء مكتوب ينفع
يتفك. بس القرار ده بتاع صاحب الشغل مش بتاع السكربت، فمحتاج طلب صريح.

**بيتعاد بأمان:** السطر اللي معاه متبقّي بيتسكّت عنه، والمطابقة التانية مش هتلاقي
مفتوح تقفله.
"""
from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.db import SessionLocal
from src.core.money import ZERO, to_money
from src.models.ledger import Account, LedgerEntry, LedgerLine
from src.services import ledger_service, reconcile_service

SAMPLE = 15


def run(*, execute: bool, match: bool) -> None:
    db = SessionLocal()
    try:
        accounts = {a.id: a for a in db.scalars(select(Account)).all()}
        reconcilable = {
            aid for aid, acc in accounts.items() if reconcile_service.is_reconcilable(acc)
        }
        print(f"حسابات قابلة للتسوية: {len(reconcilable)} من {len(accounts)}")

        lines = db.scalars(
            select(LedgerLine)
            .options(selectinload(LedgerLine.entry))
            .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
            .where(
                LedgerLine.account_id.in_(reconcilable),
                LedgerLine.amount_residual.is_(None),
                ledger_service.is_posted_sql(),
            )
        ).all() if reconcilable else []
        print(f"سطور محتاجة تفتح: {len(lines)}")

        by_partner: dict[tuple[str, int], int] = defaultdict(int)
        total = ZERO
        for line in lines:
            key = (line.partner_kind or "—", int(line.partner_id or 0))
            by_partner[key] += 1
            total = to_money(total + to_money(line.amount))
            if execute:
                line.amount_residual = reconcile_service.signed_amount(line)

        print(f"إجمالي قيمتها: {total}")
        no_partner = sum(n for (kind, _pid), n in by_partner.items() if kind == "—")
        if no_partner:
            print(f"⚠ منها {no_partner} سطر بلا شريك — شغّل `backfill_moves` الأول "
                  "عشان المطابقة تعرف تلمّها على أطرافها.")

        if execute:
            db.flush()
            entry_ids = {line.entry_id for line in lines}
            reconcile_service.refresh_payment_state(db, entry_ids)
            db.commit()
            print(f"✔ اتفتح متبقّي {len(lines)} سطر، وحالة الدفع اتحسبت لـ{len(entry_ids)} مستند.")

        if not execute:
            print("\n(عرض بس — ضيف --yes للتنفيذ، و--match عشان المطابقة التلقائية)")
            return

        if not match:
            print("\n(من غير --match: السطور مفتوحة كلها، والمطابقة تتعمل من الشاشة)")
            return

        # --- المطابقة التلقائية ---------------------------------------------------------
        partners = db.execute(
            select(LedgerLine.partner_kind, LedgerLine.partner_id)
            .where(
                LedgerLine.amount_residual.is_not(None),
                LedgerLine.amount_residual != 0,
                LedgerLine.partner_id.is_not(None),
            )
            .distinct()
        ).all()
        print(f"\nأطراف عندها مفتوح: {len(partners)}")

        matched_total = ZERO
        groups = 0
        touched = 0
        for kind, partner_id in partners:
            if not kind or not partner_id:
                continue
            result = reconcile_service.auto_reconcile(
                db, partner_kind=kind, partner_id=int(partner_id))
            if result["matched"] > ZERO:
                touched += 1
                matched_total = to_money(matched_total + result["matched"])
                groups += result["groups"]
        db.commit()
        print(f"✔ اتقفل {matched_total} على {touched} طرف في {groups} مجموعة.")

        still_open = db.execute(
            select(LedgerLine.partner_kind, LedgerLine.partner_id, LedgerLine.amount_residual)
            .where(
                LedgerLine.amount_residual.is_not(None),
                LedgerLine.amount_residual != 0,
            )
        ).all()
        remaining = to_money(sum((abs(to_money(r[2])) for r in still_open), ZERO))
        print(f"فاضل مفتوح: {len(still_open)} سطر بقيمة {remaining} — "
              "ده المستحق الحقيقي (فواتير ماتدفعتش ودفعات ملهاش فواتير).")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv, match="--match" in sys.argv)
