from __future__ import annotations

import json
import sys

from sqlalchemy import text

from src.core.db import SessionLocal


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    path = sys.argv[sys.argv.index("--file") + 1]
    docs = json.load(open(path, encoding="utf-8"))
    db = SessionLocal()
    try:
        found = db.execute(text(
            "select document_number, printed from inspection where document_number = any(:d)"),
            {"d": docs}).all()
        todo = [d for d, p in found if not p]
        print("in file:", len(docs), "found:", len(found), "already printed:",
              sum(1 for _, p in found if p), "to mark:", len(todo))
        if todo:
            db.execute(text("update inspection set printed = true where document_number = any(:d)"),
                       {"d": todo})
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
