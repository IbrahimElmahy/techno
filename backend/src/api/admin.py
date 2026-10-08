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
    try:
        return seed_demo(db)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "seed_failed", "message": str(exc)}) from exc


@router.post("/import-company-data")
async def import_company_data(
    file: UploadFile = File(...),
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
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


@router.post("/merge-customers")
def merge_customers(
    apply: bool = False,
    limit: int | None = None,
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    from decimal import Decimal

    from sqlalchemy import select

    from src.models.customer import CustomerAccount
    from src.services import customer_merge_service, ledger_service

    def total_receivable() -> Decimal:
        return ledger_service.total_balance_of(
            db, db.scalars(select(CustomerAccount.account_id)).all())

    before = total_receivable()
    result = customer_merge_service.apply(db, dry_run=not apply, limit=limit)
    result["balance_before"] = str(before)

    if not apply:
        db.rollback()
        result["balance_after"] = str(before)
        return result

    after = total_receivable()
    result["balance_after"] = str(after)
    if after != before:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, {
            "code": "merge_changed_balances",
            "message": (f"الدمج اترفض: أرصدة العملاء اتغيّرت من {before} لـ {after}. "
                        "مفيش حاجة اتحفظت."),
        })

    db.commit()
    return result


@router.get("/backup")
def backup_database(
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    import io
    from datetime import datetime as dt

    from fastapi.responses import StreamingResponse

    from src.services import backup_service

    try:
        payload = backup_service.to_gzip(backup_service.export_all(db))
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "backup_failed", "message": str(exc)})
    stamp = dt.now().strftime("%Y%m%d-%H%M")
    return StreamingResponse(
        io.BytesIO(payload),
        media_type="application/gzip",
        headers={"Content-Disposition": f"attachment; filename=techno-backup-{stamp}.json.gz"},
    )


@router.post("/restore")
async def restore_database(
    file: UploadFile = File(...),
    current: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    from src.services import backup_service

    raw = await file.read()
    if len(raw) > 512 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            {"code": "too_large", "message": "الملف أكبر من الحد المسموح."})
    try:
        data = backup_service.from_gzip(raw)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            {"code": "bad_backup", "message": str(exc)})
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            {"code": "bad_backup",
                             "message": "الملف مش مقروء — اتأكد إنه نسخة .json.gz من النظام."})

    current = backup_service.export_all(db)
    snapshot = backup_service.save_safety_snapshot(current)

    try:
        counts = backup_service.restore_all(db, data)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "restore_failed",
                             "message": f"الاستعادة فشلت ومفيش حاجة اتبدلت: {exc}"})
    return {
        "restored_tables": len(counts),
        "restored_rows": sum(counts.values()),
        "safety_snapshot": snapshot,
        "backup_exported_at": (data.get("_meta") or {}).get("exported_at"),
    }
