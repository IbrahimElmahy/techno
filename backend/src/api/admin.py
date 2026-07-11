"""Admin utilities — demo data seeding for testing (system admin only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.role import RoleName
from src.scripts.demo_seed import seed_demo

router = APIRouter(tags=["admin"], prefix="/admin")


def _require_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.role != RoleName.system_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "System admin only."})
    return current


@router.post("/demo-seed")
def demo_seed(
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Populate a full demo dataset (idempotent) for testing every module."""
    try:
        return seed_demo(db)
    except Exception as exc:  # surface a clean error instead of a 500 with no CORS
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "seed_failed", "message": str(exc)}) from exc
