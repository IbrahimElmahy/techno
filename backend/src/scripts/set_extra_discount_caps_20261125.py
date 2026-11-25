from __future__ import annotations

import json
import sys
from decimal import Decimal

from sqlalchemy import text

from src.core.db import SessionLocal

CAPS = {
    "تكنو وايت 110": Decimal("8"),
    "تكنو وايت 114": Decimal("8"),
    "تكنو ثيرم": Decimal("15"),
    "تكنو ثيرم معزول": Decimal("15"),
}


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    out = sys.argv[sys.argv.index("--backup") + 1] if "--backup" in sys.argv else None
    db = SessionLocal()
    try:
        rows = db.execute(text(
            "select id, category, extra_discount_enabled, extra_discount_max_pct from item "
            "where category = any(:c)"), {"c": list(CAPS)}).all()
        before = [{"id": r.id, "enabled": r.extra_discount_enabled,
                   "cap": str(r.extra_discount_max_pct) if r.extra_discount_max_pct is not None else None}
                  for r in rows]
        for cat, cap in CAPS.items():
            n = db.execute(text(
                "update item set extra_discount_max_pct = :p where category = :c"),
                {"p": cap, "c": cat}).rowcount
            print(cat, cap, n)
        if execute:
            if out:
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(before, f)
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
