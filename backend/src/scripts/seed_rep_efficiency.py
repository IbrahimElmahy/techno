from __future__ import annotations

import re
import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.rep_efficiency import CustomerMonthlyCredit, RepCreditAllowance
from src.services import rep_efficiency_service

REPS = {
    17: (200000, {
        "شعبان هنداوى": 50000, "احمد حماد": 15000, "احمد قاسم": 20000, "حامد غازى": 40000,
        "عيسوى غباشه": 40000, "محمد حبيب": 15000, "حمدى فرج": 60000, "مصطفى فوزى": 20000,
    }),
    15: (200000, {
        "اسماعيل غازى": 20000, "عماد شلتوت": 15000, "مروان ايوب": 10000, "عبد العزيز عرفات": 6000,
        "طارق عقبه": 6000, "احمد جمعه": 5000, "علاء رجب": 10000, "احمد صبرى": 6000,
        "سعيد ابو حى": 5000, "حمدى يوسف": 10000, "جمال الرفاعى": 5000, "محمود الباروجى": 10000,
        "حمدى الصعيدى": 5000, "عبده ابو غازى": 7000, "احمد صلاح": 4000, "عبد الحميد قطمه": 6000,
        "على ونس": 6000, "احمد الفحل": 10000, "محمود حرب": 4000, "على البنا": 5000,
    }),
    18: (220000, {"محمود حلاوه": 70000, "كريم هنطش": 70000, "ابراهيم رزق": 15000}),
    16: (200000, {}),
    19: (100000, {}),
}


def norm(s: str) -> str:
    s = re.sub(r"[إأآ]", "ا", s or "")
    s = s.replace("ة", "ه").replace("ي", "ى").replace("ـ", "")
    return " ".join(s.split())


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    db = SessionLocal()
    try:
        cfg = rep_efficiency_service.settings(db)
        cfg.allowed_debt_pct = Decimal("25")
        cfg.penalty_per_thousand = Decimal("20")
        missing = []
        for rep_id, (allowance, customers) in REPS.items():
            row = db.get(RepCreditAllowance, rep_id)
            if row is None:
                db.add(RepCreditAllowance(rep_user_id=rep_id, amount=Decimal(allowance)))
            else:
                row.amount = Decimal(allowance)
            pool = db.execute(select(Customer.id, Customer.name).where(
                Customer.rep_id == rep_id, Customer.active.is_(True))).all()
            index: dict[str, list[int]] = {}
            for cid, name in pool:
                index.setdefault(norm(name), []).append(cid)
            for name, amount in customers.items():
                ids = index.get(norm(name), [])
                if len(ids) != 1:
                    missing.append((rep_id, name, len(ids)))
                    continue
                cur = db.get(CustomerMonthlyCredit, ids[0])
                if cur is None:
                    db.add(CustomerMonthlyCredit(customer_id=ids[0], amount=Decimal(amount)))
                else:
                    cur.amount = Decimal(amount)
                print(f"{rep_id} | {name} → #{ids[0]} = {amount}")
        db.flush()
        for m in missing:
            print("NOT MATCHED", m)
        if execute:
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
