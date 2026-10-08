from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import to_qty
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection, StockDoc
from src.models.transfer import (
    StockTransfer, StockTransferLine, TransferRoute, TransferStatus)
from src.models.user import User
from src.models.warehouse import Custody, Warehouse
from src.models.catalog import Item
from src.auth.branch_scope import branch_for
from src.services import (
    audit_service, batch_service, serial_service, stock_service,
)

MOVEMENT_DOC = StockDoc.TRANSFER

_ROUTE_KINDS = {
    TransferRoute.central_to_branch: (LocationKind.warehouse, LocationKind.warehouse),
    TransferRoute.central_to_rep: (LocationKind.warehouse, LocationKind.custody),
    TransferRoute.rep_to_rep: (LocationKind.custody, LocationKind.custody),
    TransferRoute.rep_to_central: (LocationKind.custody, LocationKind.warehouse),
}


class TransferError(Exception):
    pass


class TransferDenied(Exception):
    pass


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, StockTransfer, "TRF")


def _location_branch(db: Session, kind: LocationKind, location_id: int) -> int | None:
    if kind == LocationKind.warehouse:
        wh = db.get(Warehouse, location_id)
        return wh.branch_id if wh else None
    custody = db.get(Custody, location_id)
    if custody and custody.rep_id:
        rep = db.get(User, custody.rep_id)
        return rep.branch_id if rep else None
    if custody and custody.warehouse_id:
        wh = db.get(Warehouse, custody.warehouse_id)
        return wh.branch_id if wh else None
    return None


def initiate(db, *, item_id, quantity, route: TransferRoute, source_kind, source_id,
             dest_kind, dest_id, initiated_by, transfer_date=None,
             client_uuid: str | None = None,
             statement1: str | None = None, notes: str | None = None,
             external_document_number: str | None = None) -> StockTransfer:
    want_src, want_dst = _ROUTE_KINDS[route]
    if source_kind != want_src or dest_kind != want_dst:
        raise TransferError("نوع التحويل ده مش متاح بين المكانين دول.")
    qty = Decimal(quantity)
    if qty <= 0:
        raise TransferError("كمية التحويل لازم تكون أكبر من صفر.")
    if source_kind == dest_kind and source_id == dest_id:
        raise TransferError("المصدر والوجهة لازم يكونوا مكانين مختلفين.")
    transfer = StockTransfer(
        document_number=_doc_number(db), item_id=item_id, quantity=Decimal(quantity), route=route,
        source_location_kind=source_kind, source_location_id=source_id,
        dest_location_kind=dest_kind, dest_location_id=dest_id,
        status=TransferStatus.pending, initiated_by=initiated_by,
        transfer_date=transfer_date, client_uuid=client_uuid,
        statement1=statement1, notes=notes, external_document_number=external_document_number,
        branch_id=branch_for(db, actor_user_id=initiated_by,
                             location_kind=source_kind, location_id=source_id),
    )
    db.add(transfer)
    db.flush()
    return transfer


def approve(db, *, transfer_id: int, approver_role: RoleName, approver_branch_id: int | None,
            approver_user_id: int, is_admin: bool) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل مش موجود.")
    if transfer.status != TransferStatus.pending:
        raise TransferError("الإذن اللي اتعتمد أو اترفض مايتعتمدش تاني.")

    src_branch = _location_branch(db, transfer.source_location_kind, transfer.source_location_id)
    if src_branch is None:
        if not is_admin:
            raise TransferDenied("التحويل من مخزن مركزي محتاج صلاحية الإدارة.")
    elif not (is_admin or (approver_role == RoleName.branch_manager and approver_branch_id == src_branch)):
        raise TransferDenied("الاعتماد لمدير فرع المصدر بس.")

    lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id)).all()
    moving = ([(ln, ln.item_id, ln.quantity) for ln in lines] if lines
              else [(None, transfer.item_id, transfer.quantity)])
    if not moving:
        raise TransferError("الإذن مفيهوش أصناف — ارفضه بدل ما تعتمده.")

    first_out = first_in = None
    for line, item_id, quantity in moving:
        out_mv = stock_service.post_movement(
            db, item_id=item_id, location_kind=transfer.source_location_kind,
            location_id=transfer.source_location_id, movement_type="transfer_out",
            direction=StockDirection.out, quantity=quantity, actor_user_id=approver_user_id,
            source_doc_type=MOVEMENT_DOC, source_doc_id=transfer.id,
        )
        in_mv = stock_service.post_movement(
            db, item_id=item_id, location_kind=transfer.dest_location_kind,
            location_id=transfer.dest_location_id, movement_type="transfer_in",
            direction=StockDirection.in_, quantity=quantity, actor_user_id=approver_user_id,
            source_doc_type=MOVEMENT_DOC, source_doc_id=transfer.id,
        )
        if line is not None:
            line.out_movement_id = out_mv.id
            line.in_movement_id = in_mv.id
        if first_out is None:
            first_out, first_in = out_mv, in_mv

        item = db.get(Item, item_id)
        if item is not None:
            if getattr(item, "is_serialized", False):
                serial_service.relocate(
                    db, item=item,
                    from_kind=transfer.source_location_kind, from_id=transfer.source_location_id,
                    to_kind=transfer.dest_location_kind, to_id=transfer.dest_location_id,
                    quantity=quantity, transfer_id=transfer.id,
                    actor_user_id=transfer.approved_by or transfer.initiated_by)
            if getattr(item, "is_perishable", False):
                batch_service.relocate(
                    db, item_id=item.id,
                    from_kind=transfer.source_location_kind, from_id=transfer.source_location_id,
                    to_kind=transfer.dest_location_kind, to_id=transfer.dest_location_id,
                    quantity=quantity, transfer_id=transfer.id,
                    actor_user_id=transfer.approved_by or transfer.initiated_by)

    out_mv, in_mv = first_out, first_in

    transfer.status = TransferStatus.approved
    transfer.approved_by = approver_user_id
    transfer.approved_at = datetime.utcnow()
    transfer.out_movement_id = out_mv.id
    transfer.in_movement_id = in_mv.id
    db.flush()
    audit_service.record(db, action="transfer.approve", actor_user_id=approver_user_id,
                         entity_type="stock_transfer", entity_id=transfer.id)
    return transfer


def _drop_movements(db, transfer, lines) -> None:
    from src.models.stock import StockMovement

    for ln in lines:
        ln.out_movement_id = None
        ln.in_movement_id = None
    transfer.out_movement_id = None
    transfer.in_movement_id = None
    db.flush()

    db.execute(sa_delete(StockMovement).where(
        StockMovement.source_doc_type == MOVEMENT_DOC,
        StockMovement.source_doc_id == transfer.id))


def delete(db, *, transfer_id: int, actor_user_id: int) -> None:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل مش موجود.")

    lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id)).all()

    if transfer.status == TransferStatus.approved:
        for ln in lines:
            item = db.get(Item, ln.item_id)
            if item is None:
                continue
            if getattr(item, "is_serialized", False):
                serial_service.relocate(
                    db, item=item,
                    from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                    to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                    quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)
            if getattr(item, "is_perishable", False):
                batch_service.relocate(
                    db, item_id=item.id,
                    from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                    to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                    quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)

        _drop_movements(db, transfer, lines)

    doc = transfer.document_number
    db.execute(sa_delete(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id))
    db.delete(transfer)
    db.flush()
    audit_service.record(db, action="transfer.delete", actor_user_id=actor_user_id,
                         entity_type="stock_transfer", entity_id=transfer_id,
                         before={"doc": doc})


def _refuse_if_dest_goes_negative(db, transfer, lines) -> None:
    from src.models.stock import LocationKind as _LK

    if transfer.dest_location_kind != _LK.warehouse:
        return
    short = []
    for ln in lines:
        on_hand = Decimal(str(stock_service.on_hand(
            db, ln.item_id, transfer.dest_location_kind, transfer.dest_location_id)))
        after = on_hand - Decimal(str(ln.quantity))
        if after < 0:
            item = db.get(Item, ln.item_id)
            short.append(f"«{item.name if item else ln.item_id}» هينزل لـ{after}")
    if short:
        raise TransferError(
            "الإلغاء هيخلّي الوجهة برصيد سالب — يعني البضاعة وصلت واتباعت، فمش ممكن "
            "نقول إنها ماوصلتش: " + "، ".join(short[:5])
            + (f" وكمان {len(short) - 5}" if len(short) > 5 else "")
            + ". اعمل إذن رجوع بالكمية اللي لسه موجودة، أو اظبط الجردة الأول.")


def cancel(db, *, transfer_id: int, actor_user_id: int,
           reason: str | None = None) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل مش موجود.")
    if transfer.status != TransferStatus.approved:
        raise TransferError("الإذن المعتمد بس هو اللي ينفع يتلغي — اللي لسه معلّق يترفض.")

    lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id)).all()
    _refuse_if_dest_goes_negative(db, transfer, lines)
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None:
            continue
        if getattr(item, "is_serialized", False):
            serial_service.relocate(
                db, item=item,
                from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)
        if getattr(item, "is_perishable", False):
            batch_service.relocate(
                db, item_id=item.id,
                from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)

    _drop_movements(db, transfer, lines)

    transfer.status = TransferStatus.reversed
    transfer.reject_reason = (reason or "اتلغى بعد الاعتماد")[:240]
    db.flush()
    audit_service.record(db, action="transfer.cancel", actor_user_id=actor_user_id,
                         entity_type="stock_transfer", entity_id=transfer.id,
                         after={"reason": reason})
    return transfer


def _pending(db, transfer_id: int) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل غير موجود.")
    if transfer.status != TransferStatus.pending:
        raise TransferError("الإذن ده مش تحت الاعتماد — مايتعدلش.")
    return transfer


def add_line(db, *, transfer_id: int, item_id: int, quantity,
             actor_user_id: int | None = None) -> StockTransferLine:
    transfer = _pending(db, transfer_id)
    qty = to_qty(quantity)
    if qty <= 0:
        raise TransferError("الكمية لازم تكون أكبر من صفر.")
    line = StockTransferLine(transfer_id=transfer.id, item_id=item_id, quantity=qty)
    db.add(line)
    db.flush()
    audit_service.record(
        db, action="transfer.line_add", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=transfer.id,
        after={"item_id": item_id, "quantity": str(qty)})
    return line


def set_line_quantity(db, *, line_id: int, quantity,
                      actor_user_id: int | None = None) -> StockTransferLine:
    line = db.get(StockTransferLine, line_id)
    if line is None:
        raise TransferError("السطر غير موجود.")
    _pending(db, line.transfer_id)
    qty = to_qty(quantity)
    if qty <= 0:
        raise TransferError("الكمية لازم تكون أكبر من صفر — لو مش عايزه، امسح السطر.")
    was = str(line.quantity)
    line.quantity = qty
    db.flush()
    audit_service.record(
        db, action="transfer.line_qty", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=line.transfer_id,
        before={"item_id": line.item_id, "quantity": was},
        after={"item_id": line.item_id, "quantity": str(qty)})
    return line


_TEXT_FIELDS = ("statement1", "external_document_number", "notes")


def set_texts(db, *, transfer_id: int, values: dict,
              actor_user_id: int | None = None) -> StockTransfer:
    transfer = _pending(db, transfer_id)
    before, after = {}, {}
    for field in _TEXT_FIELDS:
        if field not in values:
            continue
        new = (values[field] or "").strip() or None
        old = getattr(transfer, field, None)
        if new == old:
            continue
        before[field], after[field] = old, new
        setattr(transfer, field, new)
    if after:
        db.flush()
        audit_service.record(
            db, action="transfer.texts", actor_user_id=actor_user_id,
            entity_type="stock_transfer", entity_id=transfer.id,
            before=before, after=after)
    return transfer


def remove_line(db, *, line_id: int, actor_user_id: int | None = None) -> None:
    line = db.get(StockTransferLine, line_id)
    if line is None:
        raise TransferError("السطر غير موجود.")
    _pending(db, line.transfer_id)
    audit_service.record(
        db, action="transfer.line_remove", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=line.transfer_id,
        before={"item_id": line.item_id, "quantity": str(line.quantity)})
    db.delete(line)
    db.flush()


def reject(db, *, transfer_id: int, actor_user_id: int, reason: str | None = None) -> StockTransfer:
    transfer = _pending(db, transfer_id)
    transfer.status = TransferStatus.rejected
    transfer.approved_by = actor_user_id
    transfer.approved_at = datetime.utcnow()
    if reason:
        transfer.reject_reason = reason[:240]
    db.flush()
    audit_service.record(
        db, action="transfer.reject", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=transfer.id,
        after={"doc": transfer.document_number, "reason": reason},
    )
    return transfer
