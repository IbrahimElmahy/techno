from __future__ import annotations

import importlib
import re
import uuid as uuidlib
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.auth.rbac import (
    CAP_COUPON_RECEIVE,
    CAP_INSPECTION_READ,
    CAP_MANUFACTURE_READ,
    CAP_SALES_READ,
    CAP_STOCK_READ,
    CAP_TRANSFER_INITIATE,
    CAP_VOUCHER_READ,
    role_has_capability,
)
from src.core.db import get_db
from src.lib import stock_docs
from src.lib.stock_docs import StockDoc
from src.models.document_attachment import DocumentAttachment

router = APIRouter(tags=["attachments"], prefix="/documents")

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "documents"

ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "application/pdf": ".pdf",
}
MAX_BYTES = 12 * 1024 * 1024


ATTACHABLE: dict[str, tuple[str, str, str]] = {
    StockDoc.SALE: ("src.models.sales", "SalesInvoice", CAP_SALES_READ),
    StockDoc.SALE_RETURN: ("src.models.sales", "SalesReturn", CAP_SALES_READ),
    StockDoc.PURCHASE: ("src.models.purchasing", "PurchaseInvoice", CAP_STOCK_READ),
    StockDoc.PURCHASE_RETURN: ("src.models.purchasing", "PurchaseReturn", CAP_STOCK_READ),
    StockDoc.TRANSFER: ("src.models.transfer", "StockTransfer", CAP_TRANSFER_INITIATE),
    StockDoc.PERMIT: ("src.models.stock_permit", "StockPermit", CAP_STOCK_READ),
    StockDoc.COUNT: ("src.models.stock_count", "StockCount", CAP_STOCK_READ),
    StockDoc.MANUFACTURING: ("src.models.manufacturing", "ManufacturingOrder",
                             CAP_MANUFACTURE_READ),
    StockDoc.INSPECTION: ("src.models.inspection", "Inspection", CAP_INSPECTION_READ),
    "voucher": ("src.models.voucher", "Voucher", CAP_VOUCHER_READ),
    "coupon_receipt": ("src.models.coupon_receipt", "CouponReceipt", CAP_COUPON_RECEIVE),
    "coupon_issue": ("src.models.coupon_issue", "CouponIssue", CAP_COUPON_RECEIVE),
    "trade_order": ("src.models.trade_order", "TradeOrder", CAP_SALES_READ),
}


class AttachmentOut(BaseModel):
    id: int
    doc_type: str
    doc_id: int
    filename: str
    content_type: str | None
    bytes: int | None
    uploaded_by: int | None
    created_at: str | None
    url: str


def _out(a: DocumentAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=a.id, doc_type=a.doc_type, doc_id=a.doc_id, filename=a.filename,
        content_type=a.content_type, bytes=a.bytes, uploaded_by=a.uploaded_by,
        created_at=str(a.created_at) if a.created_at else None,
        url=f"/api/v1/documents/attachments/{a.id}/file",
    )


def _safe_name(name: str) -> str:
    base = Path(name).name
    cleaned = re.sub(r"[^A-Za-z0-9._؀-ۿ -]", "_", base).strip() or "attachment"
    return cleaned[:120]


def _resolve(doc_type: str, doc_id: int, current: CurrentUser, db: Session) -> str:
    name = stock_docs.canonical(doc_type) or doc_type
    spec = ATTACHABLE.get(name)
    if spec is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": f"نوع مستند غير مسجّل للمرفقات: «{doc_type}»."})
    module_name, class_name, capability = spec

    if not current.can(capability):
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "forbidden", "message": "ليس لديك صلاحية على هذا المستند."})

    model = getattr(importlib.import_module(module_name), class_name)
    if db.get(model, doc_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {
            "code": "not_found", "message": "المستند غير موجود."})
    return name


@router.post("/{doc_type}/{doc_id}/attachments", response_model=AttachmentOut,
             status_code=status.HTTP_201_CREATED)
async def upload(
    doc_type: str,
    doc_id: int,
    file: UploadFile = File(...),
    client_uuid: str | None = Form(default=None),
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttachmentOut:
    name = _resolve(doc_type, doc_id, current, db)

    if client_uuid:
        existing = db.scalar(select(DocumentAttachment).where(
            DocumentAttachment.client_uuid == client_uuid))
        if existing is not None:
            return _out(existing)

    suffix = ALLOWED.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": "الصور فقط (jpg / png / webp / heic) أو PDF."})

    folder = UPLOAD_ROOT / name / datetime.now().strftime("%Y/%m")
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

    row = DocumentAttachment(
        doc_type=name,
        doc_id=doc_id,
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


@router.get("/{doc_type}/{doc_id}/attachments", response_model=list[AttachmentOut])
def list_for_document(
    doc_type: str,
    doc_id: int,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AttachmentOut]:
    name = _resolve(doc_type, doc_id, current, db)
    rows = db.scalars(select(DocumentAttachment).where(
        DocumentAttachment.doc_type == name,
        DocumentAttachment.doc_id == doc_id,
    ).order_by(DocumentAttachment.id)).all()
    return [_out(a) for a in rows]


@router.get("/attachments/{attachment_id}/file")
def download(
    attachment_id: int,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    row = db.get(DocumentAttachment, attachment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المرفق غير موجود."})
    _resolve(row.doc_type, row.doc_id, current, db)

    path = (UPLOAD_ROOT / row.stored_path).resolve()
    if not str(path).startswith(str(UPLOAD_ROOT.resolve())) or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "ملف المرفق غير موجود على الخادم."})
    return FileResponse(path, media_type=row.content_type or "application/octet-stream",
                        filename=row.filename)


@router.delete("/attachments/{attachment_id}", response_model=dict)
def remove(
    attachment_id: int,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(DocumentAttachment, attachment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المرفق غير موجود."})
    if not current.is_admin and row.uploaded_by != current.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "forbidden", "message": "هذا المرفق ليس لك — لا يحذفه إلا صاحبه أو المدير."})
    (UPLOAD_ROOT / row.stored_path).unlink(missing_ok=True)
    db.delete(row)
    db.commit()
    return {"deleted": attachment_id}
