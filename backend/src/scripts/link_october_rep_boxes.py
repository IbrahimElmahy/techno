from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account
from src.models.treasury import Treasury, TreasuryKind
from src.models.user import User
from src.models.warehouse import Custody, HolderType
from src.services.customer_merge_service import FAMILY_POLY, FAMILY_WHITE

BOXES: dict[str, tuple[str, str]] = {
    "amr.ragab": ("A5S-110", "A5S-1171"),
    "fayoum":    ("A5S-251", "A5S-1173"),
    "herafyeen": ("A5S-580", "A5S-1172"),
    "giza2":     ("A5S-579", "A5S-1183"),
}

SAFES: tuple[str, ...] = ("A5S-1", "A5S-163")


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        made = linked = 0
        for username, codes in BOXES.items():
            rep = db.scalar(select(User).where(User.username == username))
            if rep is None or rep.branch_id is None:
                print(f"  ⚠ مافيش مندوب «{username}» — اتخطّى")
                continue
            for family, code in zip((FAMILY_WHITE, FAMILY_POLY), codes):
                acc = db.scalar(select(Account).where(Account.code == code))
                if acc is None or acc.branch_id != rep.branch_id:
                    print(f"  ⚠ {code} مش موجود في فرع المندوب — اتخطّى")
                    continue
                cust = db.scalar(select(Custody).where(
                    Custody.rep_id == rep.id, Custody.family == family))
                if cust is None and family == FAMILY_WHITE:
                    cust = db.scalar(select(Custody).where(
                        Custody.rep_id == rep.id, Custody.family.is_(None)))
                state = "موجودة"
                if cust is None:
                    cust = Custody(holder_type=HolderType.rep, rep_id=rep.id, family=family,
                                   warehouse_id=None, account_id=acc.id, active=True)
                    db.add(cust)
                    db.flush()
                    made += 1
                    state = "اتعملت"
                elif cust.account_id != acc.id or cust.family != family:
                    cust.family, cust.account_id = family, acc.id
                    linked += 1
                    state = "اتربطت"
                acc.owner_ref = cust.id
                print(f"  {rep.full_name:<20} {family:<5} ⇐ {code:<9} «{acc.name}»  ({state})")
        for code in SAFES:
            acc = db.scalar(select(Account).where(Account.code == code))
            if acc is None:
                print(f"  ⚠ {code} مش موجود — اتخطّى")
                continue
            t = db.scalar(select(Treasury).where(Treasury.account_id == acc.id))
            if t is None:
                db.add(Treasury(name=f"{acc.name} — أكتوبر", kind=TreasuryKind.cash, branch_id=acc.branch_id,
                                account_id=acc.id, is_default=False, active=True))
                db.flush()
                print(f"  خزنة جديدة «{acc.name}» على {code}")
            else:
                print(f"  الخزنة «{t.name}» موجودة")
        print(f"\nعهد اتعملت {made} · اتربطت {linked}")
        if not execute:
            db.rollback()
            print("عرض فقط — `--yes` للتنفيذ.")
            return 0
        db.commit()
        print("✔ اتحفظ.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
