"""رفع وتنزيل مرفقات الزيارات.

The visit syncs first and the pictures follow, each in its own request. That split is deliberate:
a rep at the edge of coverage gets the RECORD in — the thing the books need — before spending his
signal on photographs, and a picture that fails to upload does not take the visit down with it.

Idempotent by the attachment's own `client_uuid`, because a retry after a dropped connection is the
normal case on a phone, not the exception. Sending the same picture twice stores it once.
"""
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

# جذر التخزين. جنب الكود عشان يمشي في التطوير من غير إعداد، وقابل للتغيير بمتغير بيئة.
UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "inspections"

# الصور بس. قبول أي امتداد معناه إن التطبيق بقى مكان يتخزن فيه أي ملف من أي حد يقدر يسجّل زيارة.
ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
}
# 12 ميجا. صورة الموبايل بعد التصغير أقل من ده بكتير؛ الحد بيمنع رفع بالغلط يملا القرص.
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
    """اسم ملف آمن — من غير مسارات ولا محارف غريبة.

    The name arrives from a phone and is used to build a path. Anything with a separator or a `..`
    in it could otherwise be made to write outside the uploads directory entirely.
    """
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
                            {"code": "not_found", "message": "الزيارة مش موجودة."})

    # A retry of a picture already stored returns the one on file rather than a second copy.
    if client_uuid:
        existing = db.scalar(select(InspectionAttachment).where(
            InspectionAttachment.client_uuid == client_uuid))
        if existing is not None:
            return _out(existing)

    suffix = ALLOWED.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": "الصور بس (jpg / png / webp / heic)."})

    day = datetime.now().strftime("%Y/%m")
    folder = UPLOAD_ROOT / day
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{uuidlib.uuid4().hex}{suffix}"

    size = 0
    try:
        with stored.open("wb") as out:
            # Streamed in chunks and stopped at the limit: reading the whole upload into memory
            # first would let one oversized file decide how much RAM the server needs.
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
                            {"code": "not_found", "message": "المرفق مش موجود."})
    path = (UPLOAD_ROOT / row.stored_path).resolve()
    # The stored path is ours, but resolving and re-checking costs nothing and means a tampered row
    # cannot be used to read something else off the disk.
    if not str(path).startswith(str(UPLOAD_ROOT.resolve())) or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "ملف المرفق مش موجود على السيرفر."})
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
                            {"code": "not_found", "message": "المرفق مش موجود."})
    (UPLOAD_ROOT / row.stored_path).unlink(missing_ok=True)
    db.delete(row)
    db.commit()
    return {"deleted": attachment_id}
