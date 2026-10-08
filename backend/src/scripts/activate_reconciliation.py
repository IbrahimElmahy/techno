from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.money import ZERO, to_money
from src.core.db import SessionLocal
from src.models.ledger import Account, LedgerEntry, LedgerLine
from src.services import ledger_service, reconcile_service


def _party_account_ids(db) -> set[int]:
    ids: set[int] = set()
    from src.models.customer import CustomerAccount

    ids |= {row for (row,) in db.execute(select(CustomerAccount.account_id)).all() if row}
    try:
        from src.models.supplier import SupplierAccount

        ids |= {row for (row,) in db.execute(select(SupplierAccount.account_id)).all() if row}
    except Exception:  # noqa: BLE001
        pass
    return ids


def _signed_total(lines: list[LedgerLine]) -> Decimal:
    return to_money(sum((reconcile_service.signed_amount(ln) for ln in lines), ZERO))


def _residual_total(lines: list[LedgerLine]) -> Decimal:
    return to_money(sum((reconcile_service.residual_of(ln) for ln in lines), ZERO))


def run(*, execute: bool, only_account: int | None = None) -> None:
    db = SessionLocal()
    try:
        wanted = _party_account_ids(db)
        if only_account is not None:
            wanted &= {only_account}
        if not wanted:
            print("مافيش حسابات أطراف.")
            return
        accounts = {a.id: a for a in db.scalars(
            select(Account).where(Account.id.in_(wanted))).all()}
        print(f"حسابات الأطراف: {len(accounts)}")

        flagged = sum(1 for a in accounts.values() if not a.reconcilable)
        for account in accounts.values():
            account.reconcilable = True

        rows = db.scalars(
            select(LedgerLine)
            .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
            .where(LedgerLine.account_id.in_(wanted), ledger_service.is_posted_sql())
        ).all()
        by_account: dict[int, list[LedgerLine]] = {}
        for line in rows:
            by_account.setdefault(line.account_id, []).append(line)
        print(f"سطور مرحّلة عليها: {len(rows)}")

        stamped = 0
        for line in rows:
            if line.amount_residual is None:
                line.amount_residual = reconcile_service.signed_amount(line)
                stamped += 1
        db.flush()

        before = {aid: _signed_total(lines) for aid, lines in by_account.items()}

        matched = ZERO
        closed = 0
        for aid, lines in by_account.items():
            ids = [ln.id for ln in lines if reconcile_service.is_open(ln)]
            if len(ids) < 2:
                continue
            live = [ln for ln in lines if ln.id in set(ids)]
            if not any(reconcile_service.residual_of(ln) > ZERO for ln in live):
                continue
            if not any(reconcile_service.residual_of(ln) < ZERO for ln in live):
                continue
            result = reconcile_service.reconcile(db, line_ids=ids)
            matched = to_money(matched + result["matched"])
            closed += 1

        db.flush()
        after = {aid: _residual_total(lines) for aid, lines in by_account.items()}
        broken = {aid: (before[aid], after[aid])
                  for aid in before if before[aid] != after[aid]}

        still_open = sum(1 for line in rows if reconcile_service.is_open(line))
        print("-" * 52)
        print(f"{'حسابات اتعلّمت قابلة للتسوية':<34}{flagged:>8}")
        print(f"{'سطور خدت متبقّي':<34}{stamped:>8}")
        print(f"{'حسابات اتقفل فيها':<34}{closed:>8}")
        print(f"{'المبلغ اللي اتقفل':<34}{matched:>14,.2f}")
        print(f"{'سطور لسه مفتوحة':<34}{still_open:>8}")

        if broken:
            db.rollback()
            print(f"\n✗ المتبقّي خالف مجموع السطور في {len(broken)} حساب — اترجع كل حاجة.")
            for aid, (was, now) in list(broken.items())[:15]:
                print(f"   حساب {aid}: السطور {was} · المتبقّي {now}")
            return
        print("\n✔ مجموع المتبقّي = مجموع السطور في كل حساب — مافيش رصيد اتغيّر.")

        if not execute:
            db.rollback()
            print("[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print("✔ اتحفظت المطابقة.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    account = int(args[args.index("--account") + 1]) if "--account" in args else None
    run(execute="--yes" in args, only_account=account)
