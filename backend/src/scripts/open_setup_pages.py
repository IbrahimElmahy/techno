from __future__ import annotations

import argparse

from sqlalchemy import select

from src.api.permissions import with_page_caps
from src.core.db import SessionLocal
from src.models.permission import UserCapability
from src.models.role import Role
from src.models.user import User
from src.services import audit_service

SETUP_PAGES = [
    "/categories", "/catalog", "/customers", "/suppliers", "/party-links", "/warehouses",
    "/governorates", "/branches", "/territories", "/reps", "/treasuries", "/main-accounts",
    "/sub-accounts", "/fixed-assets", "/cost-centers", "/loyalty",
]


def run(*, username: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.username == username))
        if user is None:
            raise SystemExit(f"مافيش يوزر اسمه «{username}»")
        rows = db.execute(select(UserCapability.capability, UserCapability.granted)
                          .where(UserCapability.user_id == user.id)).all()
        before_grants = {c for c, g in rows if g}
        denies = {c for c, g in rows if not g} - {f"page:{p}" for p in SETUP_PAGES}
        grants = before_grants | {f"page:{p}" for p in SETUP_PAGES}
        grants = with_page_caps(db.get(Role, user.role_id).name, grants, denies, before_grants, None)
        old_denies = {c for c, g in rows if not g}
        print("منح:", ", ".join(sorted(grants - before_grants)) or "-")
        print("رفع المنع:", ", ".join(sorted(old_denies - denies)) or "-")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for c in sorted(old_denies - denies):
            db.query(UserCapability).filter(UserCapability.user_id == user.id,
                                            UserCapability.capability == c).delete()
        for c in sorted(grants - before_grants):
            db.add(UserCapability(user_id=user.id, capability=c, granted=True))
        audit_service.record(db, action="permissions.user.update", actor_user_id=None,
                             entity_type="user", entity_id=user.id,
                             before={"grants": sorted(before_grants), "denies": sorted(old_denies)},
                             after={"grants": sorted(grants), "denies": sorted(denies)})
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="فتح شاشات الانشاءات لمستخدم")
    ap.add_argument("--user", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(username=a.user, execute=a.yes)


if __name__ == "__main__":
    main()
