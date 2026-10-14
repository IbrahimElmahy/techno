from __future__ import annotations

import sys
from collections import Counter, defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.coupon_receipt import CouponReceipt
from src.models.customer import Customer
from src.models.org import Branch
from src.services import audit_service
from src.services.coupon_receipt_service import receiver_side_of

SIDE_LABEL = {"plumber": "سباك", "merchant": "تاجر", None: "فارغ"}


def _label(kind: str | None) -> str:
    return SIDE_LABEL.get(receiver_side_of(None, kind), kind or "فارغ")


def _bucket(old: str | None, new: str | None) -> str:
    if not old:
        return "بلا نوع"
    if receiver_side_of(None, old) == new:
        return "توحيد التسمية"
    return "نوع مخالف للحساب"


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}
        rows = db.execute(
            select(CouponReceipt, Customer.name, Customer.customer_type)
            .join(Customer, Customer.id == CouponReceipt.customer_id)
            .order_by(CouponReceipt.id)).all()
        changes = []
        for receipt, name, ctype in rows:
            want = receiver_side_of(ctype, receipt.customer_type)
            if want != receipt.customer_type:
                changes.append((receipt, name, ctype, want))

        counts: dict[str, Counter] = defaultdict(Counter)
        examples: dict[str, list] = defaultdict(list)
        for receipt, name, ctype, want in changes:
            branch = branches.get(receipt.branch_id, "-")
            bucket = _bucket(receipt.customer_type, want)
            counts[branch][bucket] += 1
            if len(examples[bucket]) < 10:
                examples[bucket].append(
                    f"  {receipt.document_number} [{branch}] {name} ({ctype}): "
                    f"{receipt.customer_type or '-'} ← {want} "
                    f"({_label(receipt.customer_type)} ← {_label(want)})")

        print(f"استلامات لها حساب مستلم: {len(rows)}")
        print(f"تحتاج تصحيح: {len(changes)}")
        for branch in sorted(counts):
            parts = " · ".join(f"{k}: {v}" for k, v in counts[branch].most_common())
            print(f"  {branch}: {sum(counts[branch].values())} ({parts})")
        for bucket, lines in examples.items():
            print(f"\n{bucket}:")
            print("\n".join(lines))
        if not changes:
            return 0
        if not execute:
            print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0
        for receipt, _name, _ctype, want in changes:
            before = receipt.customer_type
            receipt.customer_type = want
            audit_service.record(
                db, action="coupon_receipt.fix_kind", actor_user_id=None,
                entity_type="coupon_receipt", entity_id=receipt.id,
                before={"customer_type": before}, after={"customer_type": want})
        db.commit()
        print(f"\nتم تصحيح نوع المستلم في {len(changes)} استلام.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
