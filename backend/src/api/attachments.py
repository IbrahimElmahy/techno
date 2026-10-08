from __future__ import annotations

import re
import shutil
import uuid as uuidlib
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_INSPECTION_READ, CAP_INSPECTION_WRITE
from src.core.db import get_db
from src.models.attachment import InspectionAttachment
from src.models.inspection import Inspection

router = APIRouter(tags=["attachments"], prefix="/inspections")

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "inspections"

ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
}
MAX_BYTES = 12 * 1024 * 1024


class AttachmentOut(BaseModel):
    id: int
    inspection_id: int
    filename: str
    content_type: str | None
    bytes: int | None
    url: str


def _out(a: InspectionAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=a.id, inspection_id=a.inspection_id, filename=a.filename,
        content_type=a.content_type, bytes=a.bytes,
        url=f"/api/v1/inspections/attachments/{a.id}/file",
    )


def _safe_name(name: str) -> str:
    base = Path(name).name
    cleaned = re.sub(r"[^A-Za-z0-9._؀-ۿ -]", "_", base).strip() or "attachment"
    return cleaned[:120]


@router.post("/{inspection_id}/attachments", response_model=AttachmentOut,
             status_code=status.HTTP_201_CREATED)
async def upload(
    inspection_id: int,
    file: UploadFile = File(...),
    client_uuid: str | None = Form(default=None),
    current: CurrentUser = Depends(require_capability(CAP_INSPECTION_WRITE)),
    db: Session = Depends(get_db),
) -> AttachmentOut:
    insp = db.get(Inspection, inspection_id)
    if insp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "الزيارة غير موجودة."})

    if client_uuid:
        existing = db.scalar(select(InspectionAttachment).where(
            InspectionAttachment.client_uuid == client_uuid))
        if existing is not None:
            return _out(existing)

    suffix = ALLOWED.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": "الصور فقط (jpg / png / webp / heic)."})

    day = datetime.now().strftime("%Y/%m")
    folder = UPLOAD_ROOT / day
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{uuidlib.uuid4().hex}{suffix}"

    size = 0
    try:
        with stored.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, {
                        "code": "too_large",
                        "message": f"الملف أكبر من {MAX_BYTES // (1024 * 1024)} ميجا."})
                out.write(chunk)
    except Exception:
        stored.unlink(missing_ok=True)
        raise

    row = InspectionAttachment(
        inspection_id=inspection_id,
        filename=_safe_name(file.filename or stored.name),
        stored_path=str(stored.relative_to(UPLOAD_ROOT)).replace("\\", "/"),
        content_type=file.content_type,
        bytes=size,
        client_uuid=client_uuid,
        uploaded_by=current.id,
    )
    db.add(row)
    db.commit()
    return _out(row)


@router.get("/{inspection_id}/attachments", response_model=list[AttachmentOut])
def list_for_inspection(
    inspection_id: int,
    _: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> list[AttachmentOut]:
    rows = db.scalars(select(InspectionAttachment).where(
        InspectionAttachment.inspection_id == inspection_id
    ).order_by(InspectionAttachment.id)).all()
    return [_out(a) for a in rows]


@router.get("/attachments/{attachment_id}/file")
def download(
    attachment_id: int,
    _: CurrentUser = Depends(require_capability(CAP_INSPECTION_READ)),
    db: Session = Depends(get_db),
) -> FileResponse:
    row = db.get(InspectionAttachment, attachment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المرفق غير موجود."})
    path = (UPLOAD_ROOT / row.stored_path).resolve()
    if not str(path).startswith(str(UPLOAD_ROOT.resolve())) or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "ملف المرفق غير موجود على الخادم."})
    return FileResponse(path, media_type=row.content_type or "application/octet-stream",
                        filename=row.filename)


@router.delete("/attachments/{attachment_id}", response_model=dict)
def remove(
    attachment_id: int,
    _: CurrentUser = Depends(require_capability(CAP_INSPECTION_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(InspectionAttachment, attachment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المرفق غير موجود."})
    (UPLOAD_ROOT / row.stored_path).unlink(missing_ok=True)
    db.delete(row)
    db.commit()
    return {"deleted": attachment_id}
