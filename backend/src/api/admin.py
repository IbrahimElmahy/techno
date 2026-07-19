"""Admin utilities — demo data seeding and company-data import (system admin only)."""
from __future__ import annotations

import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.role import RoleName
from src.scripts.demo_seed import seed_demo
from src.scripts.import_company_data import import_workbook

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


@router.post("/import-company-data")
async def import_company_data(
    file: UploadFile = File(...),
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Import the company's master data from the client's Excel workbook.

    Idempotent: items/warehouses/customers already present (matched by name) are skipped, so
    re-uploading the same file only adds what is missing.
    """
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(422, {"code": "validation", "message": "Upload an .xlsx workbook."})
    data = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        return import_workbook(db, tmp_path)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "import_failed", "message": str(exc)}) from exc
