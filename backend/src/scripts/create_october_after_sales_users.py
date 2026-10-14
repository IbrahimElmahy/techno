from __future__ import annotations

import secrets
import sys

from sqlalchemy import select

from src.core.security import hash_password
from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.org import Branch
from src.models.role import Role, RoleName
from src.models.user import User
from src.services import audit_service

BRANCH = "أكتوبر"
PEOPLE = [
    ("kamel.helal", "كامل هلال", "A5E-7"),
    ("abdelrahman.gomaa", "عبد الرحمن جمعة", "A5E-13"),
    ("mahmoud.marzouk", "محمود مرزوق", "A5E-33"),
    ("mohamed.mahmoud.oct", "محمد محمود", "A5E-31"),
    ("mohamed.gamil", "محمد جميل", None),
    ("mohamed.samy.oct", "محمد سامى", None),
]


def run(execute: bool) -> None:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == BRANCH))
        role = db.scalar(select(Role).where(Role.name == RoleName.after_sales_staff))
        admin = db.scalar(select(User.id).join(Role, Role.id == User.role_id)
                          .where(Role.name == RoleName.system_admin).order_by(User.id))
        for username, name, emp_code in PEOPLE:
            taken = db.scalar(select(User).where(User.username == username))
            emp = db.scalar(select(Employee).where(Employee.code == emp_code)) if emp_code else None
            if emp is not None and emp.user_id:
                print(username, "الموظف مرتبط بالفعل بمستخدم", emp.user_id)
                continue
            if taken is not None:
                print(username, "موجود بالفعل", taken.id)
                continue
            print(username, name, "موظف:", emp.code if emp else "-")
            if not execute:
                continue
            user = User(username=username, full_name=name, role_id=role.id,
                        branch_id=branch.id, active=True,
                        password_hash=hash_password(secrets.token_urlsafe(24)))
            db.add(user)
            db.flush()
            if emp is not None:
                emp.user_id = user.id
            audit_service.record(
                db, action="user.create", actor_user_id=admin, entity_type="user",
                entity_id=user.id,
                after={"username": username, "role": RoleName.after_sales_staff.value,
                       "branch_id": branch.id, "employee": emp_code})
            print("  →", user.id)
        if execute:
            db.commit()
        else:
            print("تجربة فقط — أضف --yes للتنفيذ")
    finally:
        db.close()


if __name__ == "__main__":
    run("--yes" in sys.argv[1:])
