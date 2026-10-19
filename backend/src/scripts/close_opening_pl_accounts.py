from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.ledger import Account, Direction, LedgerEntry
from src.models.org import Branch
from src.services import ledger_service, lock_date_service
from src.services.financial_reports_service import effective_nature
from src.services.income_statement_service import norm
from src.services.ledger_service import LineInput

REF = "opening-pl-close-{}"
RETAINED_WORDS = ("ارباح الفترة السابقة", "ارباح وخسائر مرحلة", "ارباح مرحلة", "ارباح محتجزة")


def _retained(db, branch_id: int | None) -> list[Account]:
    found = []
    for acc in db.scalars(select(Account).where(Account.is_postable.is_(True),
                                                Account.branch_id == branch_id)).all():
        nature = effective_nature(acc)
        if nature is not None and nature.value == "equity" \
                and any(norm(w) in norm(acc.name) for w in RETAINED_WORDS):
            found.append(acc)
    return found


def run(*, execute: bool, equity: dict[int, int]) -> None:
    db = SessionLocal()
    try:
        names = dict(db.execute(select(Branch.id, Branch.name)).all())
        openings = db.scalars(select(LedgerEntry).where(
            LedgerEntry.entry_type == "opening_balance", ledger_service.is_posted_sql())
            .order_by(LedgerEntry.id)).all()
        admin = db.scalar(select(func.min(LedgerEntry.actor_user_id))) or 1
        todo = 0
        for entry in openings:
            ref = REF.format(entry.id)
            done = db.scalar(select(LedgerEntry.id).where(LedgerEntry.external_ref == ref))
            per_account: dict[int, Decimal] = defaultdict(Decimal)
            accounts: dict[int, Account] = {}
            for ln in entry.lines:
                acc = db.get(Account, ln.account_id)
                nature = effective_nature(acc) if acc else None
                if nature is None or nature.value not in ("income", "expense"):
                    continue
                accounts[acc.id] = acc
                per_account[acc.id] += Decimal(str(ln.amount)) * (
                    1 if ln.direction == Direction.debit else -1)
            per_account = {k: to_money(v) for k, v in per_account.items() if to_money(v)}
            branch = names.get(entry.branch_id, "—")
            print(f"قيد {entry.number or entry.id} ({entry.entry_date}) — فرع {branch}: "
                  f"{len(per_account)} حساب أرباح وخسائر")
            if not per_account:
                continue
            if done:
                print(f"   اتعمل له قيد تصحيح قبل كده (#{done}) — هيتخطى.\n")
                continue
            net = sum(per_account.values(), Decimal(0))
            for acc_id, v in sorted(per_account.items(), key=lambda kv: -abs(kv[1])):
                a = accounts[acc_id]
                side = "دائن" if v > 0 else "مدين"
                print(f"   {side:<5}{a.code or '':<12}{(a.name or '')[:34]:<36}{abs(v):>16,}")
            candidates = _retained(db, entry.branch_id)
            target_id = equity.get(entry.branch_id) or (candidates[0].id if candidates else None)
            target = db.get(Account, target_id) if target_id else None
            side = "مدين" if net > 0 else "دائن"
            print(f"   {side:<5}{(target.code or '') if target else '':<12}"
                  f"{(target.name if target else '؟ مافيش حساب أرباح مرحلة'):<36}{abs(net):>16,}")
            if len(candidates) > 1:
                print("   حسابات أرباح مرحلة تانية ممكن تتختار بـ--equity "
                      + "، ".join(f"{entry.branch_id}={c.id} «{c.name}»" for c in candidates[1:]))
            try:
                lock_date_service.assert_open(db, entry.entry_date, actor_user_id=admin)
                print("   الفترة مفتوحة.\n")
            except Exception as exc:  # noqa: BLE001
                print(f"   ⚠ الفترة مقفولة: {exc}\n")
            if target is None:
                continue
            todo += 1
            if not execute:
                continue
            lines = [LineInput(acc_id, Direction.credit if v > 0 else Direction.debit, abs(v),
                               statement="إقفال رصيد افتتاحي لحساب أرباح وخسائر")
                     for acc_id, v in per_account.items()]
            lines.append(LineInput(target.id, Direction.debit if net > 0 else Direction.credit,
                                   abs(net), statement="صافي أرباح وخسائر الفترة السابقة"))
            made = ledger_service.post_entry(
                db, entry_type="journal", actor_user_id=admin, lines=lines,
                description=("إقفال حسابات الأرباح والخسائر من القيد الافتتاحي "
                             f"{entry.number or entry.id}"),
                branch_id=entry.branch_id, entry_date=entry.entry_date)
            made.external_ref = ref
            db.flush()
            print(f"   ✓ اتعمل القيد {made.number}\n")
        if execute:
            db.commit()
        else:
            print(f"عرض فقط — {todo} قيد تصحيح هيتعمل. أضف --yes للتنفيذ.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="إقفال حسابات الأرباح والخسائر في القيود الافتتاحية")
    ap.add_argument("--equity", action="append", default=[],
                    help="BRANCH_ID=ACCOUNT_ID لحساب الأرباح المرحلة")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    equity = {int(k): int(v) for k, v in (x.split("=", 1) for x in a.equity)}
    run(execute=a.yes, equity=equity)


if __name__ == "__main__":
    main()
