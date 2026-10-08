from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.coupon_receipt import CouponReceipt
from src.services import audit_service, coupon_receipt_service


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    db = SessionLocal()
    receipts = db.scalars(select(CouponReceipt).where(CouponReceipt.customer_id.is_(None))
                          .order_by(CouponReceipt.id)).all()
    linked, no_name, unmatched = 0, 0, []
    for r in receipts:
        name = coupon_receipt_service.receiver_note(r)
        if not name:
            no_name += 1
            continue
        hit = coupon_receipt_service.suggest_receiver(db, name)
        if hit is None:
            unmatched.append((r.document_number, name))
            continue
        before = {"customer_id": None, "customer_type": r.customer_type, "notes": r.notes}
        r.customer_id = hit["id"]
        r.customer_type = hit["customer_type"]
        r.notes = coupon_receipt_service.strip_receiver_note(r.notes)
        audit_service.record(db, action="coupon_receipt.link_receiver", actor_user_id=None,
                             entity_type="coupon_receipt", entity_id=r.id, before=before,
                             after={"customer_id": r.customer_id,
                                    "customer_type": r.customer_type, "notes": r.notes})
        linked += 1

    print(f"receipts without receiver: {len(receipts)}")
    print(f"linked: {linked}")
    print(f"no name in notes: {no_name}")
    print(f"unmatched: {len(unmatched)}")
    for doc, name in unmatched:
        print(f"  {doc} | {name}")
    if args.apply:
        db.commit()
        print("APPLIED")
    else:
        db.rollback()
        print("DRY RUN")


if __name__ == "__main__":
    main()
