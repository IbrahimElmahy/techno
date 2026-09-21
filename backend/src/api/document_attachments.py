"""رفع وعرض مرفقات أي مستند — صور وPDF على الفاتورة والإذن والسند.

نسخة معمّمة من `api/attachments.py` (اللي متسمّرة في المعاينة). **منسوخة مش معاد
استعمالها** عن قصد: راوتر المعاينات شغّال عند العميل دلوقتي وبيخدم التطبيق، وأي إعادة
تشكيل فيه عشان يخدم الاتنين كانت هتلمسه — والنسخ هنا أرخص من كسر مسار قايم. نفس
الحراسات بالظبط والسبب في كل واحدة فيهم مكتوب هناك وهنا: سقف الحجم، الأنواع المسموحة،
تنضيف اسم الملف، وفحص المسار قبل القراءة.

الشرح الكامل لقرار «جدول واحد بمفتاح (نوع، رقم)» في `src.models.document_attachment`.

---------------------------------------------------------------------------
**والصورة بتتقبل على المستند المرحّل.**

باقي النظام بيقفل الورقة بعد الترحيل — مافيش تعديل، بس عكس — لأن الرقم اللي اتقيّد
واتخصم من المخزن لازم يفضل زي ما هو. والمرفق **خارج القاعدة دي**: مابيغيّرش كمية ولا
قيد ولا رصيد، وأصلاً الورق بيتصوّر بعد ما يتوقّع ويترحّل مش قبله. قفله كان هيخلّي
الميزة مالهاش لازمة.
"""
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

# جذر التخزين. جنب الكود عشان يمشي في التطوير من غير إعداد، وجنب مجلد المعاينات بالظبط.
UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "documents"

# صور + PDF. قبول أي امتداد معناه إن النظام بقى مكان يتخزّن فيه أي ملف من أي حد عنده
# صلاحية يفتح فاتورة.
ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "application/pdf": ".pdf",
}
# 12 ميجا — نفس سقف المعاينات. صورة الموبايل بعد التصغير أقل من ده بكتير؛ الحد بيمنع
# رفع بالغلط يملا القرص.
MAX_BYTES = 12 * 1024 * 1024


#: **القايمة المقبولة — مكان واحد، وهو هنا.**
#:
#: المفتاح: اسم المستند الموحّد. أسماء أوراق المخزون مكتوبة بثوابت `StockDoc` مش بنصوص
#: حرّة — عشان `"stock_permt"` تقع في السطر اللي كاتبها مش في طلب المستخدم.
#: القيمة: (الموديول، الكلاس، صلاحية **قراءة نفس المستند** زي ما راوتره بيحرسها).
#:
#: **وليه القايمة هنا مش في `lib/stock_docs`؟** السجل ده بيمرّ عليه كل حركة مخزون في
#: النظام وهو شغّال على تلات فروع بيكتبوا فواتير دلوقتي، و`canonical()` هو حارس
#: `post_movement`: أي اسم بيتضاف هناك بيبقى `source_doc_type` مقبول على صف حركة.
#: سند القبض واستلام الكوبونات مابيحركوش بضاعة، فإضافتهم هناك كانت هتوسّع حارس حيّ
#: عشان ميزة مالهاش علاقة بيه. فالسجل بيتقرا منه (`canonical` للأسماء القديمة،
#: و`StockDoc` للثوابت) **ومابيتكتبش فيه**.
ATTACHABLE: dict[str, tuple[str, str, str]] = {
    StockDoc.SALE: ("src.models.sales", "SalesInvoice", CAP_SALES_READ),
    StockDoc.SALE_RETURN: ("src.models.sales", "SalesReturn", CAP_SALES_READ),
    StockDoc.PURCHASE: ("src.models.purchasing", "PurchaseInvoice", CAP_STOCK_READ),
    StockDoc.PURCHASE_RETURN: ("src.models.purchasing", "PurchaseReturn", CAP_STOCK_READ),
    # التحويل بيتقرا بـ`transfer.initiate` — مش `stock.read`. الحارس هنا بيتبع الراوتر
    # بتاعه مهما كان غريب، عشان المرفق مايفتحش باب المستند ما بيفتحوش.
    StockDoc.TRANSFER: ("src.models.transfer", "StockTransfer", CAP_TRANSFER_INITIATE),
    StockDoc.PERMIT: ("src.models.stock_permit", "StockPermit", CAP_STOCK_READ),
    StockDoc.COUNT: ("src.models.stock_count", "StockCount", CAP_STOCK_READ),
    StockDoc.MANUFACTURING: ("src.models.manufacturing", "ManufacturingOrder",
                             CAP_MANUFACTURE_READ),
    StockDoc.INSPECTION: ("src.models.inspection", "Inspection", CAP_INSPECTION_READ),
    # ورق مالي مالوش حركة مخزون، فمالوش ثابت في `StockDoc` — الأسماء دي بتتولد هنا
    # لأول مرة، وده المكان الوحيد اللي بيعرفها.
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
    """اسم ملف آمن — من غير مسارات ولا محارف غريبة.

    الاسم جاي من المتصفح وبيتحط في مسار. أي فاصل مسار أو `..` جوّاه كان ينفع يخلّي
    الرفعة تكتب برّه مجلد الرفع خالص.
    """
    base = Path(name).name
    cleaned = re.sub(r"[^A-Za-z0-9._؀-ۿ -]", "_", base).strip() or "attachment"
    return cleaned[:120]


def _resolve(doc_type: str, doc_id: int, current: CurrentUser, db: Session) -> str:
    """بيرجّع الاسم الموحّد للمستند بعد ما يتأكد إنه مسجّل وموجود وإن اللي طالبه يشوفه.

    تلات فحوص في دالة واحدة عن قصد: الأربع نقاط كلها محتاجاهم بنفس الترتيب، ونسيان
    واحد فيهم في نقطة واحدة هو بالظبط الثغرة اللي «جدول لكل نوع» كان بيوزّعها.
    """
    # الاسم القديم بيتوحّد الأول: الشاشة ممكن تبعت `sale` والداتا كلها على
    # `sales_invoice`، ومن غير التوحيد ده المرفق بيتكتب على اسم ومايتقراش بالتاني.
    name = stock_docs.canonical(doc_type) or doc_type
    spec = ATTACHABLE.get(name)
    if spec is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": f"نوع مستند مش متسجّل للمرفقات: «{doc_type}»."})
    module_name, class_name, capability = spec

    if not role_has_capability(current.role, capability):
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "forbidden", "message": "مالكش صلاحية على المستند ده."})

    # المستند لازم يكون موجود فعلاً — وإلا الجدول بيتملي صور معلّقة في الهوا على أرقام
    # محدش هيفتحها. الاستيراد متأخّر عشان الراوتر ما يجرّش تلتاشر موديل وقت الإقلاع.
    model = getattr(importlib.import_module(module_name), class_name)
    if db.get(model, doc_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {
            "code": "not_found", "message": "المستند مش موجود."})
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

    # إعادة رفع صورة اتخزّنت خلاص بترجّع اللي على الملف بدل نسخة تانية.
    if client_uuid:
        existing = db.scalar(select(DocumentAttachment).where(
            DocumentAttachment.client_uuid == client_uuid))
        if existing is not None:
            return _out(existing)

    suffix = ALLOWED.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": "صور بس (jpg / png / webp / heic) أو PDF."})

    folder = UPLOAD_ROOT / name / datetime.now().strftime("%Y/%m")
    folder.mkdir(parents=True, exist_ok=True)
    stored = folder / f"{uuidlib.uuid4().hex}{suffix}"

    size = 0
    try:
        with stored.open("wb") as out:
            # بيتقرا على دفعات وبيقف عند الحد: قراءة الرفعة كاملة في الذاكرة الأول
            # كانت هتخلّي ملف واحد كبير هو اللي بيقرر السيرفر محتاج كام رام.
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
                            {"code": "not_found", "message": "المرفق مش موجود."})
    # نفس حارس الصلاحية بتاع القايمة: الرابط ده بيتشاف في الـHTML، فلو مااتحرسش كان
    # أي حد مسجّل دخول يقدر يعدّ الأرقام ويشوف ورق مش بتاعه.
    _resolve(row.doc_type, row.doc_id, current, db)

    path = (UPLOAD_ROOT / row.stored_path).resolve()
    # المسار بتاعنا إحنا، بس الفحص مابيكلّفش حاجة ومعناه إن صف اتعبث فيه مايقدرش
    # يتقرا بيه ملف تاني من على القرص.
    if not str(path).startswith(str(UPLOAD_ROOT.resolve())) or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "ملف المرفق مش موجود على السيرفر."})
    return FileResponse(path, media_type=row.content_type or "application/octet-stream",
                        filename=row.filename)


@router.delete("/attachments/{attachment_id}", response_model=dict)
def remove(
    attachment_id: int,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """المسح لصاحب الصورة أو الأدمن — مش لكل حد بيشوف المستند.

    الرفع والقراءة لأي حد بيفتح الورقة، لأن الصورة جزء منها. المسح لأ: اللي حطّ الصورة
    يقدر يشيلها لو غلط فيها، وغير كده بيبقى قرار مسؤول — وإلا كان أي واحد بيمر على
    الفاتورة يقدر يمسح إثبات حد تاني.
    """
    row = db.get(DocumentAttachment, attachment_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المرفق مش موجود."})
    if not current.is_admin and row.uploaded_by != current.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "forbidden", "message": "المرفق ده مش بتاعك — صاحبه أو المدير بس اللي يمسحه."})
    (UPLOAD_ROOT / row.stored_path).unlink(missing_ok=True)
    db.delete(row)
    db.commit()
    return {"deleted": attachment_id}
