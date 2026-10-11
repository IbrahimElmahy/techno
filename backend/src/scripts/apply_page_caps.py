from __future__ import annotations

import sys

from sqlalchemy import select

from src.api.permissions import with_page_caps
from src.core.db import SessionLocal
from src.models.permission import UserCapability
from src.models.role import Role
from src.models.user import User


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        users = db.scalars(select(User).where(User.active.is_(True))).all()
        total = 0
        for u in users:
            rows = db.execute(select(UserCapability.capability, UserCapability.granted)
                              .where(UserCapability.user_id == u.id)).all()
            grants = {c for c, g in rows if g}
            denies = {c for c, g in rows if not g}
            if not any(c.startswith("page:") for c in grants):
                continue
            role = db.get(Role, u.role_id).name
            new = with_page_caps(role, grants, denies, grants, None) - grants
            if not new:
                continue
            total += len(new)
            print(f"{u.username}: {', '.join(sorted(new))}")
            if execute:
                for c in sorted(new):
                    db.add(UserCapability(user_id=u.id, capability=c, granted=True,
                                          actor_user_id=None))
        if execute:
            db.commit()
            print(f"اتضاف {total} صلاحية.")
        else:
            print(f"هيتضاف {total} صلاحية — أضف --yes للتنفيذ.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv)
