from __future__ import annotations

import sys

from sqlalchemy import text

from src.core.db import SessionLocal

FIXES = {"FC-P-01162": "تكنو ثيرم معزول", "FC-W-02138": "تكنو وايت 114"}


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    db = SessionLocal()
    try:
        for code, cat in FIXES.items():
            old = db.scalar(text("select category from item where code = :c"), {"c": code})
            db.execute(text("update item set category = :cat where code = :c"), {"cat": cat, "c": code})
            print(f"{code}: {old} ← {cat}")
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
