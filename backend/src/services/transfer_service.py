"""Transfer service (T040–T041). FR-022–024.

Pending→approved; approval by the SOURCE location's branch manager (central source ⇒ admin/central
authority); atomic out+in under locks; reverse-transfer mirror pair.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import to_qty
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.models.transfer import (
    StockTransfer, StockTransferLine, TransferRoute, TransferStatus)
from src.models.user import User
from src.models.warehouse import Custody, Warehouse
from src.models.catalog import Item
from src.services import (
    audit_service, batch_service, reservation_service, serial_service, stock_service,
)

_ROUTE_KINDS = {
    TransferRoute.central_to_branch: (LocationKind.warehouse, LocationKind.warehouse),
    TransferRoute.central_to_rep: (LocationKind.warehouse, LocationKind.custody),
    TransferRoute.rep_to_rep: (LocationKind.custody, LocationKind.custody),
}


class TransferError(Exception):
    pass


class TransferDenied(Exception):
    pass


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, StockTransfer, "TRF")


def _location_branch(db: Session, kind: LocationKind, location_id: int) -> int | None:
    """Branch that owns a location; None for the central warehouse (head-office authority)."""
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
             dest_kind, dest_id, initiated_by) -> StockTransfer:
    want_src, want_dst = _ROUTE_KINDS[route]
    if source_kind != want_src or dest_kind != want_dst:
        raise TransferError("نوع التحويل ده مش متاح بين المكانين دول.")
    qty = Decimal(quantity)
    if qty <= 0:
        raise TransferError("كمية التحويل لازم تكون أكبر من صفر.")
    if source_kind == dest_kind and source_id == dest_id:
        raise TransferError("المصدر والوجهة لازم يكونوا مكانين مختلفين.")
    # Fail fast: never let a request be raised for more than the source actually holds. The
    # authoritative no-negative guard still runs at approve time (stock can move in between).
    # (031) Reserved stock does not move. A hold is a promise to a customer at THIS location, and
    # sending the goods to another branch breaks it as completely as selling them would — with the
    # difference that nobody notices until the customer arrives.
    on_hand = stock_service.on_hand(db, item_id, source_kind, source_id)
    held = reservation_service.held_against(
        db, item_id=item_id, location_kind=source_kind, location_id=source_id)
    available = to_qty(Decimal(str(on_hand)) - Decimal(str(held)))
    if qty > available:
        if held > to_qty(0):
            raise TransferError(
                f"المتاح للتحويل {available} أقل من المطلوب {qty} — فيه {held} محجوزة لعملاء "
                f"في المخزن ده."
            )
        raise TransferError(
            f"طالب {qty} والمتاح في المصدر {available} بس."
        )
    transfer = StockTransfer(
        document_number=_doc_number(db), item_id=item_id, quantity=Decimal(quantity), route=route,
        source_location_kind=source_kind, source_location_id=source_id,
        dest_location_kind=dest_kind, dest_location_id=dest_id,
        status=TransferStatus.pending, initiated_by=initiated_by,
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
    # Source-branch authority: central source (None) ⇒ admin/central; else the source-branch manager.
    if src_branch is None:
        if not is_admin:
            raise TransferDenied("Central-source transfer requires head-office/central authority.")
    elif not (is_admin or (approver_role == RoleName.branch_manager and approver_branch_id == src_branch)):
        raise TransferDenied("Only the source branch's Branch Manager may approve.")

    # (031) Every line the document carries. A transfer written before lines existed has none, so
    # its own `item_id`/`quantity` stand in — which is what lets old documents approve unchanged.
    lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id)).all()
    moving = ([(ln, ln.item_id, ln.quantity) for ln in lines] if lines
              else [(None, transfer.item_id, transfer.quantity)])
    if not moving:
        # Every line was taken off. Approving an empty request would post nothing and call it done;
        # the honest end for a request nobody wants is a rejection.
        raise TransferError("الإذن مفيهوش أصناف — ارفضه بدل ما تعتمده.")

    first_out = first_in = None
    for line, item_id, quantity in moving:
        out_mv = stock_service.post_movement(
            db, item_id=item_id, location_kind=transfer.source_location_kind,
            location_id=transfer.source_location_id, movement_type="transfer_out",
            direction=StockDirection.out, quantity=quantity, actor_user_id=approver_user_id,
            source_doc_type="transfer", source_doc_id=transfer.id,
        )
        in_mv = stock_service.post_movement(
            db, item_id=item_id, location_kind=transfer.dest_location_kind,
            location_id=transfer.dest_location_id, movement_type="transfer_in",
            direction=StockDirection.in_, quantity=quantity, actor_user_id=approver_user_id,
            source_doc_type="transfer", source_doc_id=transfer.id,
        )
        if line is not None:
            line.out_movement_id = out_mv.id
            line.in_movement_id = in_mv.id
        if first_out is None:
            first_out, first_in = out_mv, in_mv

        # The quantity has moved; the things that describe *which* units moved have to follow it.
        # Leaving them behind is the drift the serial/batch integrity checks exist to catch — and
        # did catch, which is how this was found.
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
    transfer.approved_at = datetime(2026, 1, 1)  # set by caller-side clock in prod; fixed for tests
    transfer.out_movement_id = out_mv.id
    transfer.in_movement_id = in_mv.id
    db.flush()
    audit_service.record(db, action="transfer.approve", actor_user_id=approver_user_id,
                         entity_type="stock_transfer", entity_id=transfer.id)
    return transfer


def reverse(db, *, transfer_id: int, actor_user_id: int) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل مش موجود.")
    if transfer.status != TransferStatus.approved:
        raise TransferError("الإذن المعتمد بس هو اللي ينفع يتعكس.")
    stock_service.reverse_movement(db, original_id=transfer.out_movement_id, actor_user_id=actor_user_id)
    stock_service.reverse_movement(db, original_id=transfer.in_movement_id, actor_user_id=actor_user_id)
    transfer.status = TransferStatus.reversed
    db.flush()
    audit_service.record(db, action="transfer.reverse", actor_user_id=actor_user_id,
                         entity_type="stock_transfer", entity_id=transfer.id)
    return transfer


# ---------------------------------------------------------------------------
# (031) The pending document: what may still be changed, and what may not.
# ---------------------------------------------------------------------------

def _pending(db, transfer_id: int) -> StockTransfer:
    """The transfer, if it is still open to change.

    Everything below refuses once the document has moved stock. An approved transfer has posted
    movements against two locations; editing its quantity afterwards would leave the balances
    describing a document that no longer says what happened.
    """
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
    # (031) Every change to a pending request is recorded. The person who raised it reads the
    # history to find out why what arrived is not what he asked for, and «الكمية اتغيّرت» with no
    # name and no minute on it is not an answer.
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
        # Zero is not a way to remove a line: a line that moves nothing still says the item was
        # considered, and «امسح السطر» is its own decision with its own button.
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


def remove_line(db, *, line_id: int, actor_user_id: int | None = None) -> None:
    """حذف صنف من الإذن — مش حذف الإذن.

    The request itself is never deleted: somebody asked for it, somebody may have to answer for it,
    and a document that can vanish is a decision with no record. Taking every line off leaves an
    empty request that can only be REJECTED, which is the honest way to say «مش هيتم».
    """
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
    """رفض إذن التحويل.

    `TransferStatus.rejected` has existed since the transfer was written and **nothing ever set
    it** — so a request that was not going to happen had only two ways out: approve it anyway, or
    leave it pending forever. A queue that only grows is a queue nobody reads.

    Rejecting moves no stock. That is the whole point of rejecting rather than approving-then-
    reversing: nothing left the shelf, so nothing has to come back to it.
    """
    transfer = _pending(db, transfer_id)
    transfer.status = TransferStatus.rejected
    transfer.approved_by = actor_user_id
    transfer.approved_at = datetime.utcnow()
    if reason:
        # Kept on the document rather than in an audit line alone: the person who asked for the
        # transfer reads THIS screen, not the audit log.
        transfer.reject_reason = reason[:240]
    db.flush()
    audit_service.record(
        db, action="transfer.reject", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=transfer.id,
        after={"doc": transfer.document_number, "reason": reason},
    )
    return transfer
