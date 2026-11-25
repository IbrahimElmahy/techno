from __future__ import annotations

import json
import re
import sys
from collections import Counter
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.lib.coupon_lifecycle import split_serial
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine

_DIGITS = re.compile(r"(\d+)\s*$")


def _num(serial: str) -> str | None:
    m = _DIGITS.search(str(serial or ""))
    return str(int(m.group(1))) if m else None


def _key(kind, serial) -> tuple[str, str]:
    k, n, _ = split_serial(kind, serial)
    return k, n


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    path = sys.argv[sys.argv.index("--file") + 1]
    out = sys.argv[sys.argv.index("--backup") + 1] if "--backup" in sys.argv else None
    wanted: dict[str, list[list]] = json.load(open(path, encoding="utf-8"))
    db = SessionLocal()
    stats = Counter()
    backup = []
    try:
        receipts = {r.document_number: r for r in db.scalars(
            select(CouponReceipt).where(CouponReceipt.document_number.in_(list(wanted)))).all()}
        for doc, items in wanted.items():
            r = receipts.get(doc)
            if r is None:
                stats["receipt not found"] += 1
                continue
            lines = list(db.scalars(select(CouponReceiptLine)
                                    .where(CouponReceiptLine.receipt_id == r.id)).all())
            by_exact = {s: v for s, v in items}
            by_key = {}
            for s, v in items:
                by_key.setdefault(_key(None, s), set()).add(v)
            nums = Counter(_num(s) for s, _ in items)
            by_num = {}
            for s, v in items:
                by_num.setdefault(_num(s), set()).add(v)
            done = 0
            for ln in lines:
                v = by_exact.get(ln.serial)
                if v is None:
                    cand = by_key.get(_key(ln.coupon_kind, ln.serial))
                    if cand and len(cand) == 1:
                        v = next(iter(cand))
                if v is None:
                    n = _num(ln.serial)
                    cand = by_num.get(n)
                    if cand and len(cand) == 1 and nums.get(n) == 1:
                        v = next(iter(cand))
                if v is None:
                    stats["line unmatched"] += 1
                    continue
                backup.append({"line_id": ln.id, "old": str(ln.value) if ln.value is not None else None,
                               "receipt": doc, "declared": str(r.declared_value)
                               if r.declared_value is not None else None})
                ln.value = Decimal(v)
                done += 1
            stats["lines set"] += done
            if done:
                stats["receipts touched"] += 1
                if r.declared_value is not None:
                    stats["declared cleared"] += 1
                r.declared_value = None
        db.flush()
        for k, v in sorted(stats.items()):
            print(f"{k}: {v}")
        if execute:
            if out:
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(backup, f, ensure_ascii=False)
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
