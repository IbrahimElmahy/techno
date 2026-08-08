"""دمج «تكنو فلان» مع «فلان» — يتشغّل على أي قاعدة، وبيقف لو الفلوس اتحركت.

The merge itself lives in `customer_merge_service`; this is the way to RUN it against a database
that is not the one on this machine. The service was written, proved on a copy of the client's data
and never executed on production — because a push deploys code and does nothing to data, which is a
distinction that is invisible from the outside: «انت عملت حاجات كتير لوكل لكن معملتهاش علي السيرفر».

Two things make this safe enough to point at a live database.

**It reports before it does anything.** With no flags it runs the plan and prints it — which people
it found under two names, which it will rename, which it refuses to touch and why. Nothing is
written. `--apply` is a separate, deliberate act.

**It refuses to leave the books different from how it found them.** A merge moves a POINTER: the
duplicate's ledger account becomes the بولي account of the surviving customer, carrying its history
untouched. So the sum of every customer balance must be identical afterwards, to the piastre. This
totals them before and after and rolls the whole thing back if the two disagree — a merge that
changes a balance is a bug, and the moment to find that out is inside the transaction.

Usage — read the plan first, always:

    DATABASE_URL=... python -m src.scripts.merge_customers
    DATABASE_URL=... python -m src.scripts.merge_customers --apply
"""
from __future__ import annotations

import argparse
import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.services import customer_merge_service, ledger_service


def _total_receivable(db) -> Decimal:
    """Every customer account balance added up.

    The one number that must not move. A customer account has no balance of its own — it points at
    a LEDGER account, and that is where the money is. Totalling the ledger side is the point: the
    merge repoints a customer account at a different owner, so the sum over the ledger accounts is
    exactly the thing that must come out identical.
    """
    return ledger_service.total_balance_of(
        db, db.scalars(select(CustomerAccount.account_id)).all())


def _print_plan(result: dict) -> None:
    pairs = result.get("pairs", [])
    techno_only = result.get("techno_only", [])
    skipped = result.get("skipped", [])

    print(f"\n  عملاء اتلاقوا باسمين:  {len(pairs)}")
    for p in pairs[:200]:
        flag = "" if p.get("same_rep", True) else "   ← مندوب مختلف"
        # `keep` and `merge` are nested {id, name}. Read flat, every line printed «#None + #None»
        # — a plan that names nobody, which is the same as no plan.
        keep, merge = p.get("keep") or {}, p.get("merge") or {}
        print(f"    • {p.get('base_name')}: يفضل {keep.get('name')} #{keep.get('id')} "
              f"← يندمج فيه {merge.get('name')} #{merge.get('id')}{flag}")
    if len(pairs) > 200:
        print(f"    … و{len(pairs) - 200} كمان")

    print(f"\n  «تكنو» من غير أصل — هيتشال الاسم بس:  {len(techno_only)}")
    for t in techno_only[:50]:
        print(f"    • #{t.get('id')} {t.get('name')}")

    # A skip must always be spoken. A silent one is indistinguishable from a merge that did nothing.
    print(f"\n  اتخطّوا:  {len(skipped)}")
    for sk in skipped:
        print(f"    • {sk.get('name')}: {sk.get('reason')}")


def main() -> int:
    ap = argparse.ArgumentParser(description="دمج العملاء المكرّرين (أبيض/بولي)")
    ap.add_argument("--apply", action="store_true",
                    help="نفّذ فعلاً. من غيرها بيطبع الخطة ومابيغيّرش حاجة.")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        before_customers = len(db.scalars(select(Customer)).all())
        before_total = _total_receivable(db)

        print("=" * 70)
        print("  خطة الدمج" if not args.apply else "  تنفيذ الدمج")
        print("=" * 70)
        print(f"  عدد العملاء قبل:      {before_customers}")
        print(f"  إجمالي أرصدة العملاء: {before_total}")

        result = customer_merge_service.apply(db, dry_run=not args.apply)
        _print_plan(result)

        if not args.apply:
            print("\n  (تشغيل تجريبي — مفيش حاجة اتغيّرت. ضيف --apply للتنفيذ.)\n")
            db.rollback()
            return 0

        after_total = _total_receivable(db)
        after_customers = len(db.scalars(select(Customer)).all())
        print(f"\n  إجمالي أرصدة العملاء بعد: {after_total}")

        if after_total != before_total:
            # Inside the transaction, so this is a refusal and not a mess to clean up afterwards.
            db.rollback()
            print("\n  ✗ الأرصدة اتغيّرت — اترفض الدمج واترجع كل حاجة زي ما كانت.")
            print(f"    قبل {before_total} · بعد {after_total}")
            return 1

        db.commit()
        print(f"  عدد العملاء بعد:          {after_customers}")
        print("\n  ✓ اتنفّذ. الأرصدة زي ما هي بالمليم.\n")
        return 0
    except Exception as exc:                      # noqa: BLE001 — the CLI is the last line
        db.rollback()
        print(f"\n  ✗ وقف من غير ما ينفّذ حاجة: {exc}\n")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
