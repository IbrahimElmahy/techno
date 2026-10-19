from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select, update

from src.core.db import SessionLocal
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.models.manufacturing import ManufacturingOrder, ProductionOrder
from src.models.org import Branch
from src.services import income_statement_service as svc
from src.services import ledger_service
from src.services.financial_reports_service import effective_nature

INVENTORY_WORDS = ("تكلفة المبيعات", "تقدير تكلفة انتاج", "تكاليف صناعية خامات", "فروق مخزون",
                   "بضاعة اول المدة", "بضاعة اخر المدة")
FACTORY_PARENTS = ("مصروف المشتريات",)
NEVER_MFG = ("ادار", "مكتبي", "ضيافه", "بوفي", "اتصالات", "محاسب", "صدقات", "دعاي", "اعلان",
             "عموميه", "تامينات", "اكراميات", "حوافز", "مكافا", "مكافئ", "ملاكي")
MFG_WORDS: list[tuple[tuple[str, ...], str]] = [
    (("غفر", "حراس", "حراسه"), "indirect_labor"),
    (("اجور", "مرتبات", "رواتب"), "direct_labor"),
    (("مهمات", "مستلزمات", "عدد و ادوات", "زيوت", "شحوم", "خامات", "عينات"), "indirect_materials"),
    (("كهرباء", "مياه", "مياة", "مصنع", "قطع غيار", "صيانه", "اصلاحات", "تشغيل", "تصنيع",
      "تحميل", "نقل", "مصنعيه"), "other_mfg"),
]


def _has(text: str, words) -> bool:
    n = svc.norm(text)
    return any(svc.norm(w) in n for w in words)


def mfg_role(name: str) -> str | None:
    if _has(name, NEVER_MFG):
        return None
    for words, role in MFG_WORDS:
        if _has(name, words):
            if role == "direct_labor" and not _has(name, ("مصنع", "تشغيل", "انتاج", "عمال",
                                                          "متغيره", "اجور")):
                return None
            return role
    return None


def classify(acc: Account, chain: list[str], factory_branches: set[int]) -> str:
    under_factory = any(_has(n, FACTORY_PARENTS) for n in chain)
    if under_factory:
        return mfg_role(acc.name or "") or "ga"
    role = svc.default_role(acc, chain)
    admin_parent = bool(chain) and _has(chain[0], NEVER_MFG)
    if role == "ga" and acc.branch_id in factory_branches and not admin_parent:
        return mfg_role(acc.name or "") or "ga"
    return role


def appears_in_of(role: str, acc: Account, chain: list[str]) -> str:
    if role in svc.DOC_ROLES or role in svc.MFG_ROLES:
        return "trading"
    if role == "excluded":
        return "trading" if any(_has(n, INVENTORY_WORDS) for n in [acc.name or "", *chain]) \
            else "none"
    return "profit_loss"


def _movement(db, since: date) -> dict[int, Decimal]:
    when = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    dc = case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
              else_=-LedgerLine.amount)
    return {a: Decimal(str(v or 0)) for a, v in db.execute(
        select(LedgerLine.account_id, func.sum(dc))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(ledger_service.is_posted_sql(), when >= since)
        .group_by(LedgerLine.account_id)).all()}


def plan(db) -> tuple[list[dict], dict[str, str]]:
    accounts = {a.id: a for a in db.scalars(select(Account)).all()}
    factory = {b for (b,) in db.execute(select(ProductionOrder.branch_id).distinct()) if b}
    factory |= {b for (b,) in db.execute(select(ManufacturingOrder.branch_id).distinct()) if b}
    out, roles = [], {}
    for acc in accounts.values():
        nature = effective_nature(acc)
        if nature is None or nature.value not in ("income", "expense"):
            continue
        chain = svc._chain(acc, accounts)
        role = classify(acc, chain, factory)
        where = appears_in_of(role, acc, chain)
        fallback, _ = svc.fallback_role(acc, where)
        if role != fallback:
            roles[str(acc.id)] = role
        out.append({"acc": acc, "chain": chain, "role": role, "appears_in": where,
                    "old_role": svc.default_role(acc, chain), "nature": nature.value})
    return out, roles


def run(*, execute: bool, since: date) -> None:
    db = SessionLocal()
    try:
        names = dict(db.execute(select(Branch.id, Branch.name)).all())
        rows, roles = plan(db)
        moved = _movement(db, since)
        summary: dict[tuple, list] = defaultdict(lambda: [0, Decimal(0)])
        for r in rows:
            k = (names.get(r["acc"].branch_id, "—"), r["nature"], r["appears_in"], r["role"])
            summary[k][0] += 1
            summary[k][1] += moved.get(r["acc"].id, Decimal(0))
        print(f"الحسابات من {since.isoformat()} (مدين − دائن):\n")
        print(f"{'الفرع':<10}{'الطبيعة':<9}{'يظهر في':<13}{'الدور':<22}{'حسابات':>8}{'الحركة':>16}")
        print("-" * 80)
        for k in sorted(summary):
            n, v = summary[k]
            print(f"{k[0]:<10}{k[1]:<9}{k[2]:<13}{svc.ROLES[k[3]]:<22}{n:>8,}{v:>16,.0f}")

        changed = [r for r in rows if r["role"] != r["old_role"]]
        print(f"\nحسابات اتغير دورها عن قواعد الأسامي القديمة: {len(changed)}")
        for r in sorted(changed, key=lambda r: (r["acc"].branch_id or 0, r["role"])):
            a = r["acc"]
            print(f"   {names.get(a.branch_id, '—'):<9}{a.code or '':<14}{(a.name or '')[:30]:<32}"
                  f"{svc.ROLES[r['old_role']]:<22} ← {svc.ROLES[r['role']]:<18}"
                  f"{moved.get(a.id, Decimal(0)):>14,.0f}   [{(r['chain'] or [''])[0]}]")

        current = Counter((r["acc"].appears_in or "—") for r in rows)
        updates = [r for r in rows if r["acc"].appears_in != r["appears_in"]]
        print(f"\n«يظهر في» الحالي: {dict(current)} — هيتحدّث {len(updates):,} حساب")
        print(f"أدوار صريحة هتتسجل في إعدادات قائمة الدخل للشركة: {len(roles):,}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return
        by_value: dict[str, list[int]] = defaultdict(list)
        for r in updates:
            by_value[r["appears_in"]].append(r["acc"].id)
        for value, ids in by_value.items():
            db.execute(update(Account).where(Account.id.in_(ids)).values(appears_in=value))
        own = svc._row(db, None)
        cfg = dict((own.config if own else None) or {})
        accounts_cfg = dict(cfg.get("accounts") or {})
        saved = {str(k): v for k, v in (accounts_cfg.get("roles") or {}).items()}
        kept = sum(1 for k in roles if k in saved)
        accounts_cfg["roles"] = {**roles, **saved}
        cfg["accounts"] = accounts_cfg
        admin = db.scalar(select(func.min(LedgerEntry.actor_user_id)))
        svc.save_config(db, None, cfg, actor_user_id=admin or 1)
        db.commit()
        print(f"\nتم: {len(updates):,} حساب «يظهر في» و{len(roles) - kept:,} دور صريح "
              f"(اتساب {kept:,} دور كان متسجل قبل كده).")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تصنيف حسابات قائمة الدخل مرة واحدة")
    ap.add_argument("--since", default="2026-01-01")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(execute=a.yes, since=date.fromisoformat(a.since))


if __name__ == "__main__":
    main()
