"""Admin utilities — demo data seeding, company-data import and the integrity check.

Admin-only because the integrity report names internal ids and would read as alarming to anyone who
does not know what the invariants are.
"""
from __future__ import annotations

import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.role import RoleName
from src.scripts.demo_seed import seed_demo
from src.scripts.import_company_data import import_workbook
from src.scripts.purge_demo import purge_demo as _purge_demo

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


@router.delete("/demo-seed")
def purge_demo_data(
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """Delete the demo dataset (and only it) so a production database is left with real data.

    Hard delete by design — the app is append-only everywhere else; this is the deliberate
    exception for clearing sample data before go-live.
    """
    try:
        return _purge_demo(db)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "purge_failed", "message": str(exc)}) from exc


@router.get("/integrity")
def integrity_check(
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """فحص سلامة البيانات — read-only.

    Their أدوات خاصة *repairs* recomputed balances. Ours has nothing to recompute: on-hand is always
    summed from the movements, never cached, so it cannot go stale. What this checks is the two
    things that genuinely are stored beside the movements — expiry lots and serial numbers — plus
    the two invariants everything else rests on: no negative stock anywhere, and every ledger entry
    balanced.

    It reports and repairs nothing, deliberately. A finding here means some code path wrote one side
    without the other, and quietly correcting the numbers would hide the defect that produced them —
    the next occurrence would be corrected just as quietly, and nobody would ever learn why the
    counts drifted.
    """
    from src.lib import integrity

    report = integrity.run_all(db)
    return {
        "clean": report.clean,
        "checked": report.checked,
        "findings": [
            {
                "check": f.check, "subject": f.subject, "expected": f.expected,
                "found": f.found, "detail": f.detail,
            }
            for f in report.findings
        ],
    }
