# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.role import RoleName

router = APIRouter(tags=["a5-sync"], prefix="/a5-sync")


def _require_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.role != RoleName.system_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "لمدير النظام وحده."})
    return current

def _factory_folder() -> str:
    return str(Path(__file__).resolve().parents[2].parent / "a5factory")


BRANCHES: dict[str, tuple[str, str]] = {
    "factory": (_factory_folder(), "FC-"),
}

BRANCH_NAME: dict[str, str] = {"factory": "السادات"}

ALLOWED_FILES = {
    "a5_lines.tsv", "a5_hdr.tsv", "a5_items.tsv", "a5_cats.tsv",
    "a5_misc.tsv", "a5_cust.tsv", "a5_bal.tsv", "a5_bal_store.tsv",
    "a5_open.tsv", "a5_acc.tsv", "a5_emp.tsv",
}

MAX_BYTES = 60 * 1024 * 1024


@router.post("/{branch_tag}/upload")
async def upload_export(
    branch_tag: str,
    file: UploadFile = File(...),
    filename: str = Form(...),
    _: CurrentUser = Depends(_require_admin),
) -> dict:
    if branch_tag not in BRANCHES:
        raise HTTPException(422, {"code": "validation", "message": "فرع مش معروف."})
    if filename not in ALLOWED_FILES:
        raise HTTPException(422, {"code": "validation",
                                  "message": f"الملف «{filename}» مش في القايمة المسموحة."})
    folder = Path(BRANCHES[branch_tag][0])
    if not folder.is_dir():
        raise HTTPException(500, {"code": "no_folder", "message": f"مجلد {folder} مش موجود."})

    size = 0
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(dir=folder, delete=False, suffix=".part") as tmp:
            tmp_path = tmp.name
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, {
                        "code": "too_large",
                        "message": f"الملف أكبر من {MAX_BYTES // (1024 * 1024)} ميجا."})
                tmp.write(chunk)
        os.replace(tmp_path, folder / filename)
        tmp_path = None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
    return {"file": filename, "bytes": size, "folder": str(folder)}


@router.post("/{branch_tag}/import")
def run_import(
    branch_tag: str,
    _: CurrentUser = Depends(_require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if branch_tag not in BRANCHES:
        raise HTTPException(422, {"code": "validation", "message": "فرع مش معروف."})
    folder, prefix = BRANCHES[branch_tag]
    name = BRANCH_NAME[branch_tag]

    from src.scripts import import_a5_docs

    from sqlalchemy import func, select

    from src.models.transfer import StockTransfer

    def count() -> int:
        return db.scalar(select(func.count()).select_from(StockTransfer)
                         .where(StockTransfer.document_number.like(f"{prefix}T%"))) or 0

    before = count()
    try:
        import_a5_docs.run(folder, execute=True, branch_name=name, prefix=prefix)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "import_failed", "message": str(exc)}) from exc
    db.expire_all()
    return {"branch": name, "transfers_before": before, "transfers_after": count()}


@router.get("/{branch_tag}/status")
def sync_status(
    branch_tag: str,
    _: CurrentUser = Depends(_require_admin),
) -> dict:
    if branch_tag not in BRANCHES:
        raise HTTPException(422, {"code": "validation", "message": "فرع مش معروف."})
    folder = Path(BRANCHES[branch_tag][0])
    out = {}
    for f in sorted(ALLOWED_FILES):
        p = folder / f
        out[f] = ({"bytes": p.stat().st_size, "at": int(p.stat().st_mtime)}
                  if p.exists() else None)
    return {"folder": str(folder), "files": out}
