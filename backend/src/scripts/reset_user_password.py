"""يظبط باسورد يوزر موجود — للحساب اللي اتنسي باسورده ومافيش أدمن تاني يدخل يغيّرها.

    python -m src.scripts.reset_user_password admin            # عرض فقط
    python -m src.scripts.reset_user_password admin --yes

**الباسورد مش مكتوبة هنا ولا بتتاخد من سطر الأوامر.** السكربت بيولّد واحدة عشوائية
ويطبعها مرة واحدة، واللي بيشغّله ينقلها ويغيّرها من شاشة المستخدمين. باسورد ثابتة في
سكربت معناها إن أي حد فتح المستودع بقى عنده الحساب، وباسورد في سطر الأوامر بتفضل في
`~/.bash_history` على السيرفر.

والتغيير بيتسجّل في الـaudit زي أي تغيير على حساب — مين غيّرها وإمتى.
"""
from __future__ import annotations

import argparse
import secrets
import string
import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.role import Role
from src.models.user import User

# حروف وأرقام بس — بتتكتب بالإيد مرة واحدة، والرموز اللي شكلها بيختلف بين الكيبوردات
# بتضيّع الوقت من غير ما تزوّد أمان يُذكر.
_ALPHABET = string.ascii_letters + string.digits


def _fresh_password(length: int = 14) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def run(*, username: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            print(f"مافيش يوزر اسمه «{username}».")
            return 1

        role = db.get(Role, user.role_id)
        role_name = getattr(role.name, "value", role.name) if role else "—"
        print(f"{'اليوزر':<20}{user.username} (#{user.id})")
        print(f"{'الاسم':<20}{user.full_name or '—'}")
        print(f"{'الدور':<20}{role_name}")
        print(f"{'الحالة':<20}{'نشط' if user.active else 'موقوف'}")

        if not execute:
            print("\n[عرض فقط] الباسورد ما اتغيّرتش. ضيف --yes للتنفيذ.")
            return 0

        password = _fresh_password()
        user.password_hash = hash_password(password)

        from src.services import audit_service

        audit_service.record(
            db, action="user.password_reset", actor_user_id=None,
            entity_type="user", entity_id=user.id,
            after={"username": user.username, "by": "reset_user_password"},
        )
        db.commit()

        print(f"\nالباسورد الجديدة لـ«{username}»: {password}")
        print("انقلها دلوقتي — مش هتتطبع تاني — وغيّرها من شاشة المستخدمين.")
        return 0
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="يظبط باسورد يوزر موجود")
    ap.add_argument("username", help="اسم المستخدم")
    ap.add_argument("--yes", action="store_true", help="نفّذ فعلاً")
    args = ap.parse_args()
    sys.exit(run(username=args.username, execute=args.yes))


if __name__ == "__main__":
    main()
