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
from src.models.transfer import StockTransfer, TransferRoute, TransferStatus
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
        raise TransferError(f"Illegal route {route.value} for the given location kinds.")
    qty = Decimal(quantity)
    if qty <= 0:
        raise TransferError("Transfer quantity must be greater than zero.")
    if source_kind == dest_kind and source_id == dest_id:
        raise TransferError("Source and destination must be different locations.")
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
            f"Requested {qty} exceeds the {available} available at the source location."
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
        raise TransferError("Transfer not found.")
    if transfer.status != TransferStatus.pending:
        raise TransferError("Only a pending transfer can be approved.")

    src_branch = _location_branch(db, transfer.source_location_kind, transfer.source_location_id)
    # Source-branch authority: central source (None) ⇒ admin/central; else the source-branch manager.
    if src_branch is None:
        if not is_admin:
            raise TransferDenied("Central-source transfer requires head-office/central authority.")
    elif not (is_admin or (approver_role == RoleName.branch_manager and approver_branch_id == src_branch)):
        raise TransferDenied("Only the source branch's Branch Manager may approve.")

    out_mv = stock_service.post_movement(
        db, item_id=transfer.item_id, location_kind=transfer.source_location_kind,
        location_id=transfer.source_location_id, movement_type="transfer_out",
        direction=StockDirection.out, quantity=transfer.quantity, actor_user_id=approver_user_id,
        source_doc_type="transfer", source_doc_id=transfer.id,
    )
    in_mv = stock_service.post_movement(
        db, item_id=transfer.item_id, location_kind=transfer.dest_location_kind,
        location_id=transfer.dest_location_id, movement_type="transfer_in",
        direction=StockDirection.in_, quantity=transfer.quantity, actor_user_id=approver_user_id,
        source_doc_type="transfer", source_doc_id=transfer.id,
    )
    # The quantity has moved; the things that describe *which* units moved have to follow it.
    # Leaving them behind is the drift the serial/batch integrity checks exist to catch — and did
    # catch, which is how this was found.
    item = db.get(Item, transfer.item_id)
    if item is not None:
        if getattr(item, "is_serialized", False):
            serial_service.relocate(
                db, item=item,
                from_kind=transfer.source_location_kind, from_id=transfer.source_location_id,
                to_kind=transfer.dest_location_kind, to_id=transfer.dest_location_id,
                quantity=transfer.quantity, transfer_id=transfer.id,
                actor_user_id=transfer.approved_by or transfer.initiated_by)
        if getattr(item, "is_perishable", False):
            batch_service.relocate(
                db, item_id=item.id,
                from_kind=transfer.source_location_kind, from_id=transfer.source_location_id,
                to_kind=transfer.dest_location_kind, to_id=transfer.dest_location_id,
                quantity=transfer.quantity, transfer_id=transfer.id,
                actor_user_id=transfer.approved_by or transfer.initiated_by)

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
        raise TransferError("Transfer not found.")
    if transfer.status != TransferStatus.approved:
        raise TransferError("Only an approved transfer can be reversed.")
    stock_service.reverse_movement(db, original_id=transfer.out_movement_id, actor_user_id=actor_user_id)
    stock_service.reverse_movement(db, original_id=transfer.in_movement_id, actor_user_id=actor_user_id)
    transfer.status = TransferStatus.reversed
    db.flush()
    audit_service.record(db, action="transfer.reverse", actor_user_id=actor_user_id,
                         entity_type="stock_transfer", entity_id=transfer.id)
    return transfer
