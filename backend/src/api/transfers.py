"""Transfers router (T042). FR-022–024, FR-027."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_TRANSFER_APPROVE, CAP_TRANSFER_INITIATE
from src.core.db import get_db
from src.core.money import to_qty
from src.models.stock import LocationKind
from src.models.transfer import StockTransfer, StockTransferLine, TransferRoute
from src.services import transfer_service
from src.services.stock_service import StockError
from src.services.transfer_service import TransferDenied, TransferError

from src.auth.rbac import role_has_capability
from src.models.role import RoleName
from src.models.transfer import StockTransfer, TransferStatus
from src.auth import branch_scope
router = APIRouter(tags=["transfers"], prefix="/transfers")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class TransferCreate(BaseModel):
    item_id: int
    quantity: Decimal
    route: TransferRoute
    source: LocationIn
    dest: LocationIn
    # (036) اليوم اللي البضاعة اتحركت فيه. مابيتبعتش ⇒ المستند بيقرا بتاريخ تسجيله.
    transfer_date: date | None = None


class TransferOut(BaseModel):
    id: int
    document_number: str
    status: str
    route: str
    approved_by: int | None = None
    # What actually moved, so the list reads without a lookup per row.
    item_id: int | None = None
    quantity: Decimal | None = None
    source_location_kind: str | None = None
    source_location_id: int | None = None
    dest_location_kind: str | None = None
    dest_location_id: int | None = None
    transfer_date: str | None = None
    created_at: str | None = None
    # (031) ليه اترفض، والأصناف اللي عليه.
    reject_reason: str | None = None
    lines: list["TransferLineOut"] = []


class TransferLineOut(BaseModel):
    id: int
    item_id: int
    quantity: Decimal


class LineIn(BaseModel):
    item_id: int
    quantity: Decimal


class LineQtyIn(BaseModel):
    quantity: Decimal


class RejectIn(BaseModel):
    # Optional but asked for: «اترفض ليه» is the first question the person who requested it has.
    reason: str | None = None


def _out(t) -> TransferOut:
    # `item_id`/`quantity` on the row are what the document was CREATED with, back when a transfer
    # moved one thing. Once it carries lines, they are what actually moves — approval reads the
    # lines and ignores the header — so the summary has to be read off them too. Reporting the
    # stale header here is how a list ends up printing «٢» beside a document that says «١».
    lines = list(getattr(t, "lines", []))
    head_item = lines[0].item_id if len(lines) == 1 else (None if lines else t.item_id)
    head_qty = (sum((ln.quantity for ln in lines), to_qty(0)) if lines else t.quantity)
    return TransferOut(
        id=t.id, document_number=t.document_number, status=t.status.value,
        route=t.route.value, approved_by=t.approved_by,
        item_id=head_item, quantity=head_qty,
        source_location_kind=t.source_location_kind.value,
        source_location_id=t.source_location_id,
        dest_location_kind=t.dest_location_kind.value,
        dest_location_id=t.dest_location_id,
        created_at=str(t.created_at) if t.created_at else None,
        transfer_date=str(t.transfer_date) if getattr(t, "transfer_date", None) else None,
        reject_reason=getattr(t, "reject_reason", None),
        # The lines the approver acts on. An old document has none and keeps answering through
        # its own item/quantity above, so nothing already posted has to be migrated.
        lines=[TransferLineOut(id=ln.id, item_id=ln.item_id, quantity=ln.quantity)
               for ln in getattr(t, "lines", [])],
    )


@router.get("", response_model=list[TransferOut])
def list_transfers(
    status_filter: str | None = None,   # pending | approved | rejected | reversed
    item_id: int | None = None,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> list[TransferOut]:
    """Transfer documents, newest first, optionally narrowed by status or item."""
    stmt = branch_scope.scope(select(StockTransfer), StockTransfer, current)
    if status_filter:
        stmt = stmt.where(StockTransfer.status == status_filter)
    if item_id is not None:
        stmt = stmt.where(StockTransfer.item_id == item_id)
    return [_out(t) for t in db.scalars(stmt.order_by(StockTransfer.id.desc())).all()]


@router.post("", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
def create_transfer(
    body: TransferCreate,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        t = transfer_service.initiate(
            db, item_id=body.item_id, quantity=body.quantity, route=body.route,
            source_kind=body.source.location_kind, source_id=body.source.location_id,
            dest_kind=body.dest.location_kind, dest_id=body.dest.location_id,
            initiated_by=current.id, transfer_date=body.transfer_date)
    except TransferError as exc:
        # Covers an illegal route, a non-positive quantity, same source/destination, and asking
        # for more than the source holds.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "transfer_invalid", "message": str(exc)})
    db.commit()
    return _out(t)


def _may_approve_now(db: Session, current: CurrentUser, t) -> bool:
    """هل اللي كاتب الإذن هو نفسه اللي بيعتمده؟

    الإذن بيتكتب «معلّق» وبيستنى اعتماد، والاعتماد هو اللي بيحرّك البضاعة. ده صح لما
    الطالب حاجة والمعتمد حاجة تانية — أمين مخزن بيطلب ومدير بيوافق.

    وهو عبث لما يكونوا نفس الشخص. الأدمن بيكتب إذن تحويل بين مخزنين، الشاشة بتقول
    «اتسجّل طلب التحويل»، وهو بيروح يبص على المخزن يلاقي مافيش حاجة اتحركت — لأنه مستني
    موافقة نفسه على ورقة كتبها بنفسه. ده كان أكبر سبب إن «التحويل مش بيخصم ولا بيزود».
    """
    if not role_has_capability(current.role, CAP_TRANSFER_APPROVE):
        return False
    src_branch = transfer_service._location_branch(
        db, t.source_location_kind, t.source_location_id)
    if src_branch is None:
        return current.is_admin
    return current.is_admin or (current.role == RoleName.branch_manager
                                and current.branch_id == src_branch)


@router.post("/{transfer_id}/self-approve", response_model=TransferOut)
def self_approve(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    """بيعتمد الإذن لو اللي طلبه هو نفسه اللي بيقدر يعتمده — وإلا بيسيبه معلّق.

    مش نفس `/approve`: ده بيرجع الإذن زي ما هو من غير خطأ لو الشخص مالوش صلاحية، عشان
    الشاشة تقدر تناديه بعد الإنشاء على طول من غير ما تعرف مين واقف قدامها.
    """
    t = db.get(StockTransfer, transfer_id)
    if t is None:
        raise HTTPException(404, {"code": "not_found", "message": "إذن التحويل مش موجود"})
    if t.status != TransferStatus.pending or not _may_approve_now(db, current, t):
        return _out(t)
    try:
        t = transfer_service.approve(
            db, transfer_id=transfer_id, approver_role=current.role,
            approver_branch_id=current.branch_id, approver_user_id=current.id,
            is_admin=current.is_admin)
    except (TransferDenied, TransferError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


@router.post("/{transfer_id}/approve", response_model=TransferOut)
def approve_transfer(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        t = transfer_service.approve(
            db, transfer_id=transfer_id, approver_role=current.role,
            approver_branch_id=current.branch_id, approver_user_id=current.id,
            is_admin=current.is_admin)
    except TransferDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, {"code": "forbidden", "message": str(exc)})
    except (TransferError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


class CancelIn(BaseModel):
    reason: str | None = None


@router.post("/{transfer_id}/cancel", response_model=TransferOut)
def cancel_transfer(
    transfer_id: int,
    body: CancelIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    """إلغاء إذن معتمد — البضاعة ترجع لمصدرها والإذن يفضل في السجل «ملغي».

    كان `/reverse`: بيكتب حركتين مضادين لكل سطر ويسيب الإذن ومعاه عكسه. دلوقتي الحركة
    بتتشال والرصيد بيرجع لوحده، والإذن بيفضل مقروء ومكتوب عليه سبب الإلغاء.
    """
    try:
        t = transfer_service.cancel(
            db, transfer_id=transfer_id, actor_user_id=current.id, reason=body.reason)
    except (TransferError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer(
    transfer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> None:
    """حذف إذن التحويل — بيروح هو وحركته."""
    try:
        transfer_service.delete(db, transfer_id=transfer_id, actor_user_id=current.id)
    except (TransferError, StockError) as exc:
        code = 404 if "مش موجود" in str(exc) else status.HTTP_409_CONFLICT
        raise HTTPException(code, {"code": "transfer_conflict", "message": str(exc)})
    db.commit()


@router.post("/{transfer_id}/reject", response_model=TransferOut)
def reject_transfer(
    transfer_id: int,
    body: RejectIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    """رفض إذن التحويل — مافيش بضاعة بتتحرك.

    `rejected` has been a status since the transfer was written and nothing ever set it, so a
    request that was not going to happen had two ways out: approve it anyway, or leave it pending
    for good.
    """
    try:
        t = transfer_service.reject(
            db, transfer_id=transfer_id, actor_user_id=current.id, reason=body.reason)
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(t)


@router.post("/{transfer_id}/lines", response_model=TransferOut,
             status_code=status.HTTP_201_CREATED)
def add_transfer_line(
    transfer_id: int,
    body: LineIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_INITIATE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    try:
        transfer_service.add_line(
            db, transfer_id=transfer_id, item_id=body.item_id, quantity=body.quantity,
            actor_user_id=current.id)
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(db.get(StockTransfer, transfer_id))


@router.patch("/lines/{line_id}", response_model=TransferOut)
def set_transfer_line_quantity(
    line_id: int,
    body: LineQtyIn,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    """تعديل كمية صنف — والإذن لسه تحت الاعتماد."""
    try:
        line = transfer_service.set_line_quantity(
            db, line_id=line_id, quantity=body.quantity, actor_user_id=current.id)
        transfer_id = line.transfer_id
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(db.get(StockTransfer, transfer_id))


@router.delete("/lines/{line_id}", response_model=TransferOut)
def remove_transfer_line(
    line_id: int,
    current: CurrentUser = Depends(require_capability(CAP_TRANSFER_APPROVE)),
    db: Session = Depends(get_db),
) -> TransferOut:
    """حذف صنف من الإذن — **مش** حذف الإذن.

    There is deliberately no endpoint that deletes a transfer request. Somebody asked for it and
    somebody may have to answer for it; a document that can vanish is a decision with no record.
    Emptying it leaves a request that can only be rejected, which is how you say «مش هيتم».
    """
    line = db.get(StockTransferLine, line_id)
    transfer_id = line.transfer_id if line else None
    try:
        transfer_service.remove_line(db, line_id=line_id, actor_user_id=current.id)
    except TransferError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "transfer_conflict", "message": str(exc)})
    db.commit()
    return _out(db.get(StockTransfer, transfer_id))
