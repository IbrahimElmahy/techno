from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, AccountType
from src.models.org import Branch
from src.models.treasury import Treasury, TreasuryKind
from src.services import account_routing_service

PLAN = {
    "العلياء": ("AL-A5S-1", "خزينة المركز الرئيسى"),
    "أكتوبر": ("A5S-663", "الخزنة فرع اكتوبر"),
    "السادات": ("FC-A5S-1", "خزينة السادات"),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        branches = {b.name: b for b in db.scalars(select(Branch)).all()}
        for bname, (code, tname) in PLAN.items():
            branch = branches.get(bname)
            acc = db.scalar(select(Account).where(Account.code == code))
            if branch is None or acc is None:
                raise SystemExit(f"مش لاقي الفرع «{bname}» أو الحساب {code} — مافيش حاجة اتعملت.")
            if acc.branch_id != branch.id:
                raise SystemExit(f"الحساب {code} فرعه #{acc.branch_id} مش «{bname}» — وقفت.")
            if not acc.active or not acc.is_postable:
                raise SystemExit(f"الحساب {code} موقوف أو مجموعة — وقفت.")

            if acc.account_type != AccountType.treasury:
                print(f"[{bname}] نوع الحساب {code} «{acc.name}»: {acc.account_type.value} ⇒ treasury")
                acc.account_type = AccountType.treasury

            t = db.scalar(select(Treasury).where(Treasury.account_id == acc.id))
            if t is None:
                print(f"[{bname}] صف خزنة جديد «{tname}» على {code}")
                t = Treasury(name=tname, kind=TreasuryKind.cash, branch_id=branch.id,
                             account_id=acc.id, is_default=False, active=True)
                db.add(t)
                db.flush()
            elif t.branch_id != branch.id or not t.active:
                print(f"[{bname}] صف الخزنة #{t.id} «{t.name}»: فرع {t.branch_id} ⇒ {branch.id}، نشط")
                t.branch_id, t.active = branch.id, True
            else:
                print(f"[{bname}] صف الخزنة #{t.id} «{t.name}» موجود")

            cur = account_routing_service.routed_account(db, "treasury", branch_id=branch.id)
            if cur is None or cur.id != acc.id:
                print(f"[{bname}] الخزنة الافتراضية: «{cur.name if cur else '—'}» "
                      f"({cur.code if cur else '—'}) ⇒ «{acc.name}» ({code})")
                account_routing_service.set_routing(db, "treasury", account_id=acc.id,
                                                    branch_id=branch.id)
            else:
                print(f"[{bname}] الخزنة الافتراضية {code} صح")

        if args.yes:
            db.commit()
            print("اتنفّذ.")
        else:
            db.rollback()
            print("عرض بس — `--yes` للتنفيذ.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
