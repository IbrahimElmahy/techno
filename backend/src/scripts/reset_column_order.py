from __future__ import annotations

import argparse
import json

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.user import User, UserPref


def run(*, table: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        plan = []
        for pref in db.scalars(select(UserPref).where(UserPref.key.like(f"cols:%{table}"))).all():
            try:
                data = json.loads(pref.value)
            except ValueError:
                continue
            if isinstance(data, dict) and data.get("order"):
                plan.append((pref, data))
                print(f"{db.get(User, pref.user_id).username:<20} {pref.key}")
        print(f"ترتيبات هترجع للافتراضي: {len(plan)} (الأعمدة المخفية زي ما هي)")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for pref, data in plan:
            data.pop("order", None)
            pref.value = json.dumps(data, ensure_ascii=False)
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="إرجاع ترتيب أعمدة جدول للترتيب الافتراضي لكل المستخدمين")
    ap.add_argument("--table", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(table=a.table, execute=a.yes)


if __name__ == "__main__":
    main()
