from __future__ import annotations

import argparse
import secrets

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.role import Role, RoleName
from src.models.user import User
from src.services import audit_service


def run(*, username: str, full_name: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        if db.scalar(select(User).where(User.username == username)) is not None:
            raise SystemExit(f"اليوزر «{username}» موجود بالفعل")
        role = db.scalar(select(Role).where(Role.name == RoleName.system_admin))
        print(f"هيتعمل: {username} — {full_name} — مدير النظام — كل الفروع")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        user = User(username=username, full_name=full_name, role_id=role.id, branch_id=None,
                    password_hash=hash_password(secrets.token_urlsafe(24)), active=True)
        db.add(user)
        db.flush()
        audit_service.record(db, action="user.create", actor_user_id=None, entity_type="user",
                             entity_id=user.id, after={"username": username,
                                                       "role": RoleName.system_admin.value})
        db.commit()
        print(f"تم: {user.id} — حدد كلمة المرور من شاشة المستخدمين")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="إنشاء مستخدم بصلاحيات مدير النظام")
    ap.add_argument("--username", required=True)
    ap.add_argument("--full-name", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(username=a.username, full_name=a.full_name, execute=a.yes)


if __name__ == "__main__":
    main()
