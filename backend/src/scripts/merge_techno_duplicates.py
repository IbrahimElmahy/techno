from __future__ import annotations

import sys
from collections import Counter, defaultdict
from decimal import Decimal

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.customer import MERGED_MARK, Customer, CustomerAccount
from src.models.user import User
from src.services import customer_merge_service as cms
from src.services import ledger_service

COMPANY_PREFIXES = ("تكنو ثيرم", "تكنوثيرم", "تكنو ثرم", "تكنووو")


def _balances(db, account_ids) -> dict[int, Decimal]:
    ids = list(account_ids)
    if not ids:
        return {}
    rows = db.execute(text("""
        SELECT ll.account_id,
               COALESCE(SUM(CASE WHEN ll.direction = a.normal_side THEN ll.amount
                                 ELSE -ll.amount END), 0)
        FROM ledger_line ll
        JOIN account a ON a.id = ll.account_id
        JOIN ledger_entry le ON le.id = ll.entry_id
        WHERE ll.account_id = ANY(:ids) AND (le.state IS NULL OR le.state = 'posted')
        GROUP BY ll.account_id"""), {"ids": ids}).all()
    out = {i: Decimal("0") for i in ids}
    out.update({int(a): Decimal(b) for a, b in rows})
    return out


def _total(db) -> Decimal:
    return ledger_service.total_balance_of(
        db, db.scalars(select(CustomerAccount.account_id)).all())


def _fmt_refs(refs: dict[str, int]) -> str:
    parts = [f"{k.replace('.customer_id', '')}={v}" for k, v in sorted(refs.items())]
    return "، ".join(parts) or "فاضي"


def _actor(db, username: str | None) -> int | None:
    if username:
        u = db.scalars(select(User).where(User.username == username)).first()
        if u is None:
            raise SystemExit(f"مافيش يوزر اسمه «{username}»")
        return u.id
    u = db.scalars(select(User).order_by(User.id)).first()
    return u.id if u else None


def run(*, execute: bool, actor: str | None) -> int:
    db = SessionLocal()
    try:
        if not execute:
            db.execute(text("SET TRANSACTION READ ONLY"))

        customers = db.scalars(select(Customer)).all()
        by_id = {c.id: c for c in customers}
        accounts: dict[int, list[CustomerAccount]] = defaultdict(list)
        for acc in db.scalars(select(CustomerAccount)).all():
            accounts[acc.customer_id].append(acc)

        plan = cms.plan(db)
        ids = {i for p in plan.pairs for i in (p.keep_customer_id, p.merge_customer_id)}
        refs = cms.count_refs(db, ids)
        bal = _balances(db, [a.account_id for i in ids for a in accounts.get(i, [])])

        print("=" * 78)
        print(f"  {'تنفيذ' if execute else 'عرض فقط'} — دمج «تكنو فلان» في «فلان»")
        print("=" * 78)
        print(f"\n[1] أزواج جديدة هتتدمج: {len(plan.pairs)}")
        for p in plan.pairs:
            keep, dupe = by_id[p.keep_customer_id], by_id[p.merge_customer_id]
            before, after = Counter(), Counter()
            for a in accounts.get(keep.id, []):
                v = bal.get(a.account_id, Decimal("0"))
                before[f"«{keep.name}»/{a.family or 'بدون'}"] += v
                after[a.family or cms.FAMILY_WHITE] += v
            for a in accounts.get(dupe.id, []):
                v = bal.get(a.account_id, Decimal("0"))
                before[f"«{dupe.name}»/{a.family or 'بدون'}"] += v
                after[cms.FAMILY_POLY] += v
            rep = "" if p.same_rep else "   ← مندوب مختلف"
            print(f"  • يفضل #{keep.id} {keep.code} «{keep.name}»  ←  يتقفل #{dupe.id} "
                  f"{dupe.code} «{dupe.name}»  [{keep.branch_id}]{rep}")
            print(f"      مستندات الباقي: {_fmt_refs(refs.get(keep.id, {}))}")
            print(f"      مستندات المكرر (هتتنقل): {_fmt_refs(refs.get(dupe.id, {}))}")
            print("      قبل: " + " | ".join(f"{k}={v}" for k, v in before.items()))
            print("      بعد: " + " | ".join(f"«{keep.name}»/{k}={v}" for k, v in after.items())
                  + f"   (المجموع {sum(before.values())} → {sum(after.values())})")

        leftovers = cms.plan_leftovers(db)
        ok = [x for x in leftovers if x.problem is None]
        moving = Counter()
        for x in ok:
            moving.update(x.refs)
        print(f"\n[2] كروت مدموجة لسه عليها حاجات: {len(leftovers)}"
              f"   (هتتنقل: {len(ok)} · محتاج قرار: {len(leftovers) - len(ok)})")
        print("    صفوف هتتنقل للكارت الشغّال: " + _fmt_refs(dict(moving)))
        untagged = 0
        if ok:
            untagged = db.execute(text(
                "SELECT count(*) FROM sales_invoice WHERE customer_id = ANY(:ids) "
                "AND family IS NULL"), {"ids": [x.dupe_id for x in ok]}).scalar() or 0
        print(f"    فواتير منهم من غير نوع (هتاخد «{cms.FAMILY_POLY}»): {untagged}")
        hashed = db.execute(text(
            "SELECT count(*) FROM ledger_entry WHERE partner_kind = 'customer' "
            "AND partner_id = ANY(:ids) AND inalterable_hash IS NOT NULL"),
            {"ids": [x.dupe_id for x in ok] or [0]}).scalar() or 0
        if hashed:
            print(f"    ⚠ {hashed} قيد متجزّأ طرفه على كارت مدموج — بيفضل زي ما هو (البصمة)")
        for x in ok:
            print(f"  • #{x.dupe_id} «{x.dupe_name}» → #{x.keep_id} «{x.keep_name}»: "
                  f"{_fmt_refs(x.refs)}")

        review: list[str] = []
        for name, why in plan.skipped:
            review.append(f"«{name}»: {why}")
        for x in leftovers:
            if x.problem:
                review.append(f"#{x.dupe_id} «{x.dupe_name}»: {x.problem} ({_fmt_refs(x.refs)})")
        keyed: dict[str, list[Customer]] = defaultdict(list)
        for c in customers:
            if c.active:
                keyed[cms.match_key(c.name)].append(c)
        company = 0
        for cid, name in plan.techno_only:
            c = by_id[cid]
            norm = cms._normalise(name)
            if norm.startswith(COMPANY_PREFIXES):
                company += 1
                for pre in COMPANY_PREFIXES:
                    if norm.startswith(pre):
                        base = cms.match_key(norm[len(pre):])
                        hits = [h for h in keyed.get(base, []) if h.id != cid]
                        if hits:
                            review.append(
                                f"#{cid} «{name}» (اسم الشركة): شبيه "
                                + "، ".join(f"#{h.id} «{h.name}» فرع {h.branch_id}" for h in hits)
                                + " — مش خط بولي، مايتدمجش أوتوماتيك")
                        break
                continue
            base = cms.match_key(norm[len(cms.TECHNO_PREFIX):])
            other = [h for h in keyed.get(base, []) if h.branch_id != c.branch_id]
            if other:
                review.append(f"#{cid} «{name}» فرع {c.branch_id}: نفس الاسم في فرع تاني "
                              + "، ".join(f"#{h.id} «{h.name}» فرع {h.branch_id}" for h in other))
        print(f"\n[3] محتاج قرار (مااتلمسش): {len(review)}")
        for r in review:
            print("  • " + r)
        print(f"\n    «تكنو» شغّال من غير «فلان» في فرعه: {len(plan.techno_only)} "
              f"(منهم {company} باسم الشركة) — بيفضلوا زي ما هم، ده اسمهم عند a5.")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.\n")
            db.rollback()
            return 0

        actor_id = _actor(db, actor)
        before_total = _total(db)
        r1 = cms.apply(db, dry_run=False, actor_user_id=actor_id)
        r2 = cms.apply_leftovers(db, dry_run=False, actor_user_id=actor_id)
        after_total = _total(db)
        print(f"\nإجمالي أرصدة العملاء: قبل {before_total} · بعد {after_total}")
        if after_total != before_total:
            db.rollback()
            print("✗ الأرصدة اتغيّرت — اترفض واترجع كل حاجة زي ما كانت.")
            return 1
        left = db.execute(text(
            "SELECT count(*) FROM customer c WHERE c.name LIKE :m AND EXISTS "
            "(SELECT 1 FROM sales_invoice s WHERE s.customer_id = c.id)"),
            {"m": f"%{MERGED_MARK}%"}).scalar()
        db.commit()
        print(f"✓ اتدمج {r1.get('merged_now', 0)} زوج · مستندات اتنقلت: "
              f"{r1.get('documents_moved') or {}} · نوع اتحط: {r1.get('families_tagged') or {}}")
        print(f"✓ بواقي: {r2.get('leftovers', 0)} كارت · اتنقل: {r2.get('moved') or {}} · "
              f"نوع اتحط: {r2.get('families_tagged') or {}}")
        print(f"  كروت مدموجة لسه عليها فواتير بعد التنفيذ: {left}\n")
        return 0
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print(f"\n✗ وقف من غير ما ينفّذ حاجة: {exc}\n")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    who = args[args.index("--actor") + 1] if "--actor" in args else None
    sys.exit(run(execute="--yes" in args, actor=who))
