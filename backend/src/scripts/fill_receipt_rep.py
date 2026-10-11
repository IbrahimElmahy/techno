from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.coupon_receipt import CouponReceipt


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        rows = db.scalars(select(CouponReceipt).where(
            CouponReceipt.source == "app",
            CouponReceipt.rep_user_id.is_(None),
            CouponReceipt.actor_user_id.isnot(None))).all()
        if not rows:
            print("لا توجد استلامات من التطبيق بدون مندوب استلام.")
            return 0
        for r in rows[:20]:
            print(f"  {r.document_number}: مندوب الاستلام ← المستخدم #{r.actor_user_id}")
        if len(rows) > 20:
            print(f"  … و{len(rows) - 20} غيرها")
        print(f"العدد: {len(rows)}")
        if not execute:
            print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0
        for r in rows:
            r.rep_user_id = r.actor_user_id
        db.commit()
        print(f"\nتم ضبط مندوب الاستلام في {len(rows)} استلام.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
