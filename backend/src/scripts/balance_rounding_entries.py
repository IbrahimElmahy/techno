# -*- coding: utf-8 -*-
"""قيود فرقها قرش — بيتقفلوا بسطر على حساب «فروق تقريب».

بعد ما قيود الافتتاح اتوازنت (`balance_opening_entries`) فضل ١٧ قيد فرق كل واحد فيهم
**قرش واحد** (`±0.01`) على فواتير بيع منقولة من a5. مثال:

    #2928  مدين ٤٬٩٢٢٫٤٤ + ٢٥٩٫٠٨ = ٥٬١٨١٫٥٢   ·   دائن ٥٬١٨١٫٥١

ده تقريب في أرقام a5 نفسها — الذمم والخصم مجموعهم مش قد الإيراد بقرش. المبلغ تافه
والأثر مش تافه: الميزان مابيقفلش، وفحص النظام بيعدّهم «قيود غير متوازنة» بدرجة عالية،
فالشاشة بتفضل حمرا على حاجة محدش هيتصرّف فيها.

## الحارس هو أهم حاجة هنا

**بيرفض أي قيد فرقه أكبر من `MAX_GAP`.** السكريبت ده غرضه يقفل كسور، ولو اتسمحله
يقفل أي فرق يبقى بقى مكنة بتخبّي أخطاء حقيقية: أول قيد ناقصه سطر بمية ألف هيتقفل في
صمت على حساب اسمه «فروق تقريب» ومحدش هيسأل.

وبيتخطى قيود الافتتاح — ليها سكربتها، وفرقها مش تقريب.

## الحساب

حساب واحد اسمه «فروق تقريب» بيتعمل أول مرة. اسمه بيقول إيه اللي جوّاه، فاللي بيراجع
الشجرة بعد سنة يعرف الرقم ده جه منين من غير ما يسأل حد.

    python -m src.scripts.balance_rounding_entries            # عرض بس
    python -m src.scripts.balance_rounding_entries --apply    # بيكتب
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.ledger import (
    Account, AccountNature, AccountType, Direction, LedgerEntry, LedgerLine,
)

# أكبر فرق يعتبر «كسر». أكبر من كده مش تقريب — ده سطر ناقص، والسكريبت بيسيبه ويقول عليه.
MAX_GAP = Decimal("0.05")
ACCOUNT_NAME = "فروق تقريب"


def _rounding_account(db: Session) -> Account:
    acc = db.scalar(select(Account).where(Account.name == ACCOUNT_NAME))
    if acc is not None:
        return acc
    acc = Account(
        account_type=AccountType.user_defined,
        normal_side=Direction.debit,
        nature=AccountNature.expense,
        name=ACCOUNT_NAME,
        is_postable=True,
        is_system=False,
        active=True,
    )
    db.add(acc)
    db.flush()
    return acc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        signed = func.sum(case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
                               else_=-LedgerLine.amount))
        rows = db.execute(
            select(LedgerEntry.id, LedgerEntry.description, signed)
            .join(LedgerLine, LedgerLine.entry_id == LedgerEntry.id)
            .group_by(LedgerEntry.id, LedgerEntry.description)
            .having(signed != 0)
            .order_by(func.abs(signed).desc())
        ).all()

        small, big = [], []
        for eid, desc, gap in rows:
            gap = to_money(gap)
            (small if abs(gap) <= MAX_GAP else big).append((eid, desc, gap))

        print(f"قيود مش متوازنة: {len(rows)}  ·  كسور: {len(small)}  ·  أكبر من ذلك: {len(big)}")
        print()
        for eid, desc, gap in small[:20]:
            print(f"  #{eid:<7} {gap!s:>8}   {(desc or '')[:62]}")
        if big:
            print()
            print(f"⚠ {len(big)} قيد فرقهم أكبر من {MAX_GAP} — **مش بيتقفلوا هنا**، دول محتاجين مراجعة:")
            for eid, desc, gap in big[:10]:
                print(f"   #{eid} {gap:,.2f}  {(desc or '')[:56]}")
        if not small:
            print("مافيش كسور تتقفل.")
            return
        total = sum((g for _e, _d, g in small), Decimal("0"))
        print()
        print(f"هيتقفل: {len(small)} قيد · صافي الفرق {total}")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        acc = _rounding_account(db)
        for eid, _desc, gap in small:
            # الفرق موجب ⇒ المدين أكبر ⇒ السطر المكمّل دائن، والعكس.
            db.add(LedgerLine(
                entry_id=eid, account_id=acc.id,
                direction=Direction.credit if gap > 0 else Direction.debit,
                amount=abs(gap),
            ))
        db.commit()
        print()
        print(f"اتكتب: {len(small)} سطر على «{ACCOUNT_NAME}» (#{acc.id})")

        left = db.execute(
            select(func.count()).select_from(
                select(LedgerEntry.id).join(LedgerLine, LedgerLine.entry_id == LedgerEntry.id)
                .group_by(LedgerEntry.id).having(signed != 0).subquery())
        ).scalar()
        d, c = db.execute(select(
            func.sum(case((LedgerLine.direction == Direction.debit, LedgerLine.amount), else_=0)),
            func.sum(case((LedgerLine.direction == Direction.credit, LedgerLine.amount), else_=0)),
        )).first()
        print(f"قيود لسه مش متوازنة: {left}")
        print(f"الدفتر: مدين {d:,.2f} · دائن {c:,.2f} · الفرق {to_money(d - c)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
