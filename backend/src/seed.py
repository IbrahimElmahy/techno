"""Seed script (T061): Egyptian governorates + first System Admin.

Idempotent: safe to re-run. Run after `alembic upgrade head`.
Usage: python -m src.seed
"""
from __future__ import annotations

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.org import Governorate
from src.models.role import Role, RoleName
from src.models.user import User

# A representative subset; extend as needed.
GOVERNORATES = [
    "Cairo", "Giza", "Alexandria", "Qalyubia", "Sharqia", "Dakahlia",
    "Beheira", "Gharbia", "Monufia", "Kafr El Sheikh", "Damietta", "Port Said",
    "Ismailia", "Suez", "Faiyum", "Beni Suef", "Minya", "Asyut", "Sohag",
    "Qena", "Luxor", "Aswan", "Red Sea", "New Valley", "Matrouh", "North Sinai",
    "South Sinai",
]

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "password123"  # change immediately after first login


def seed() -> None:
    db = SessionLocal()
    try:
        for name in GOVERNORATES:
            if db.scalar(select(Governorate).where(Governorate.name == name)) is None:
                db.add(Governorate(name=name))

        admin_role = db.scalar(select(Role).where(Role.name == RoleName.system_admin))
        if admin_role is None:
            admin_role = Role(name=RoleName.system_admin)
            db.add(admin_role)
            db.flush()

        if db.scalar(select(User).where(User.username == ADMIN_USERNAME)) is None:
            db.add(
                User(
                    username=ADMIN_USERNAME,
                    password_hash=hash_password(ADMIN_PASSWORD),
                    role_id=admin_role.id,
                    full_name="System Administrator",
                )
            )
        db.commit()
        print("Seed complete: governorates + system admin ensured.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
