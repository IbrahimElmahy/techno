"""يعمل دور «المالك» ويوزره — الدور اللي بيشوف كروت الإحصائيات وحده.

    python -m src.scripts.create_owner_user                     # عرض فقط
    python -m src.scripts.create_owner_user --yes
    python -m src.scripts.create_owner_user --yes --username malek

**الباسورد مابيتكتبش هنا ولا في أي ملف.** السكربت بيولّد واحدة عشوائية ويطبعها مرة
واحدة في الترمنال، واللي بيشغّله ينقلها ويغيّرها من شاشة المستخدمين. باسورد ثابتة في
سكربت معناها إن أي حد فتح المستودع بقى عنده حساب المالك — وهو الحساب الوحيد اللي
بيشوف أرقام الشركة كلها.

اليوزر الموجود بنفس الاسم مابيتغيّرش باسورده — بيتنقل للدور بس لو كان على دور تاني.
"""
from __future__ import annotations

import secrets
import string
import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.org import Branch
from src.models.role import Role, RoleName
from src.models.user import User

DEFAULT_USERNAME = "owner"
DEFAULT_FULL_NAME = "المالك"

# حروف وأرقام بس — الباسورد دي بتتقري من الشاشة وتتكتب بالإيد مرة واحدة، والرموز
# اللي شكلها بيختلف بين الكيبوردات بتضيّع الوقت من غير ما تزوّد أمان يُذكر.
_ALPHABET = string.ascii_letters + string.digits


def _fresh_password(length: int = 14) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def run(*, execute: bool, username: str) -> None:
    db = SessionLocal()
    try:
        role = db.scalar(select(Role).where(Role.name == RoleName.owner))
        role_note = "موجود" if role else "هيتعمل"
        user = db.scalar(select(User).where(User.username == username))

        print(f"{'دور «المالك»':<28}{role_note}")
        if user is None:
            print(f"{'اليوزر':<28}هيتعمل — {username}")
        else:
            current = db.get(Role, user.role_id)
            same = current is not None and current.name == RoleName.owner
            print(f"{'اليوزر':<28}موجود — {username} "
                  f"({'على الدور الصح' if same else f'على دور {current.name.value if current else 0}، هينقل'})")
            print(f"{'الباسورد':<28}زي ما هي — السكربت مابيغيّرهاش ليوزر موجود")

        if not execute:
            print("\n[عرض فقط] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ.")
            return

        if role is None:
            role = Role(name=RoleName.owner)
            db.add(role)
            db.flush()

        password = None
        if user is None:
            # الفرع الرئيسي لو موجود — والمالك أصلاً بيشوف الفروع كلها، فده مجرد انتماء.
            head = db.scalar(select(Branch).where(Branch.is_head_office.is_(True)))
            password = _fresh_password()
            user = User(
                username=username,
                password_hash=hash_password(password),
                role_id=role.id,
                branch_id=head.id if head else None,
                full_name=DEFAULT_FULL_NAME,
                active=True,
            )
            db.add(user)
        else:
            user.role_id = role.id
            if not user.full_name:
                user.full_name = DEFAULT_FULL_NAME
            user.active = True

        db.commit()
        print("\n✔ اتحفظ.")
        print(f"   اسم المستخدم : {username}")
        if password:
            print(f"   الباسورد     : {password}")
            print("   ⚠ دي المرة الوحيدة اللي هتتعرض فيها — انقلها وغيّرها من شاشة المستخدمين.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    name = args[args.index("--username") + 1] if "--username" in args else DEFAULT_USERNAME
    run(execute="--yes" in args, username=name)
