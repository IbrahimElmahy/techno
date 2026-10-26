from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.permission import UserCapability
from src.models.user import User
from src.services import audit_service


def run(*, username: str, capability: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            raise SystemExit(f"مافيش يوزر اسمه «{username}»")
        row = db.scalar(select(UserCapability).where(UserCapability.user_id == user.id,
                                                     UserCapability.capability == capability))
        print(f"{username} ← {capability}: {'موجودة' if row and row.granted else 'هتتضاف'}")
        if not execute or (row and row.granted):
            if not execute:
                print("عرض فقط — أضف --yes للتنفيذ")
            return
        if row is None:
            db.add(UserCapability(user_id=user.id, capability=capability, granted=True))
        else:
            row.granted = True
        audit_service.record(db, action="user.capability_grant", actor_user_id=None,
                             entity_type="user", entity_id=user.id,
                             after={"capability": capability, "granted": True})
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="منح صلاحية لمستخدم")
    ap.add_argument("--user", required=True)
    ap.add_argument("--capability", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(username=a.user, capability=a.capability, execute=a.yes)


if __name__ == "__main__":
    main()
