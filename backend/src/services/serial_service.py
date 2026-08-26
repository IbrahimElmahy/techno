"""Serial number registry service (009).

Owns the in_stock ↔ sold transitions for serialized items. Every transition is paired with a 002
quantity movement (caller posts it) so the in-stock serial count at a location equals on-hand. Serials
are unique per item.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.catalog import (
    Item, ItemSerial, ItemSerialMovement, SerialMovementKind, SerialStatus,
)
from src.models.stock import LocationKind, StockDirection
from src.services import stock_service


class SerialError(Exception):
    """Invalid serial operation (not serialized, duplicate, not-in-stock, not-on-invoice, count)."""


def _get(db: Session, item_id: int, serial: str) -> ItemSerial | None:
    return db.scalar(
        select(ItemSerial).where(ItemSerial.item_id == item_id, ItemSerial.serial == serial)
    )


def _log(
    db: Session,
    row: ItemSerial,
    kind: SerialMovementKind,
    *,
    location_kind=None,
    location_id=None,
    document_type: str | None = None,
    document_id: int | None = None,
    actor_user_id: int | None = None,
) -> None:
    """Write where a serial ended up and on what document.

    Called at each of the four points a serial moves. Deriving this later from stock movements is
    not possible: those carry quantities, and a quantity does not name which unit moved.
    """
    db.add(ItemSerialMovement(
        serial_id=row.id, item_id=row.item_id, serial=row.serial, kind=kind,
        location_kind=location_kind, location_id=location_id,
        document_type=document_type, document_id=document_id, actor_user_id=actor_user_id,
    ))


def receive(
    db: Session,
    *,
    item: Item,
    location_kind: LocationKind,
    location_id: int,
    serials: list[str],
    actor_user_id: int,
) -> list[ItemSerial]:
    """Register N new serials in_stock at a location and post a +N stock-in (FR-003)."""
    if not item.is_serialized:
        raise SerialError("الصنف ده مش متتبّع بسيريال.")
    if not serials:
        raise SerialError("لازم سيريال واحد على الأقل.")
    if len(set(serials)) != len(serials):
        raise SerialError("فيه سيريال متكرر في الطلب.")
    rows: list[ItemSerial] = []
    for s in serials:
        if _get(db, item.id, s) is not None:
            raise SerialError(f"السيريال «{s}» متسجّل قبل كده للصنف ده.")
        row = ItemSerial(
            item_id=item.id, serial=s, status=SerialStatus.in_stock,
            location_kind=location_kind, location_id=location_id,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    for row in rows:
        _log(db, row, SerialMovementKind.received, location_kind=location_kind,
             location_id=location_id, document_type="serial_receive", document_id=item.id,
             actor_user_id=actor_user_id)
    stock_service.post_movement(
        db, item_id=item.id, location_kind=location_kind, location_id=location_id,
        movement_type="serial_receive_in", direction=StockDirection.in_,
        quantity=Decimal(len(serials)), actor_user_id=actor_user_id,
        source_doc_type="serial_receive", source_doc_id=item.id,
    )
    return rows


def assert_sale_serials(
    item: Item, *, quantity: Decimal, unit_factor: Decimal, serials: list[str] | None
) -> None:
    """Validate the count/base-unit/serialized↔serials consistency for a sale line (FR-004)."""
    has_serials = bool(serials)
    if not item.is_serialized:
        if has_serials:
            raise SerialError("اتبعت سيريالات لصنف مش متتبّع بسيريال.")
        return
    if not has_serials:
        raise SerialError("الصنف ده متتبّع بسيريال — لازم تكتب السيريالات.")
    if to_qty(unit_factor) != to_qty(Decimal(1)):
        raise SerialError("الأصناف اللي بسيريال بتتباع بالوحدة الأساسية بس.")
    if len(set(serials)) != len(serials):
        raise SerialError("فيه سيريال متكرر في السطر.")
    if Decimal(len(serials)) != to_qty(quantity):
        raise SerialError("عدد السيريالات لازم يساوي كمية السطر.")


def relocate(
    db: Session,
    *,
    item: Item,
    from_kind: LocationKind,
    from_id: int,
    to_kind: LocationKind,
    to_id: int,
    quantity: Decimal | int,
    transfer_id: int | None = None,
    actor_user_id: int | None = None,
) -> list[ItemSerial]:
    """Move N in-stock serials from one location to another, oldest first.

    A transfer moves the goods; the serials describe *which* goods, so they have to move with them.
    Without this the serials stay behind: the destination cannot sell what it physically holds
    (the serial is not there), and the source shows serials for units that have left.

    No stock movement is posted here — the transfer posts its own out/in pair, and posting again
    would double the quantity. The two sides move together, which is the invariant the integrity
    check for serials verifies.

    Oldest first is arbitrary but has to be *something* deterministic: two runs of the same transfer
    must move the same serials, or a reversal could not put them back where they came from.
    """
    if not item.is_serialized:
        return []
    count = int(Decimal(str(quantity)))
    if count <= 0:
        return []
    rows = db.scalars(
        select(ItemSerial).where(
            ItemSerial.item_id == item.id,
            ItemSerial.status == SerialStatus.in_stock,
            ItemSerial.location_kind == from_kind,
            ItemSerial.location_id == from_id,
        ).order_by(ItemSerial.id).limit(count)
    ).all()
    if len(rows) < count:
        raise SerialError(
            f"عدد الأرقام التسلسلية في المصدر ({len(rows)}) أقل من الكمية المنقولة ({count})."
        )
    for row in rows:
        row.location_kind = to_kind
        row.location_id = to_id
    db.flush()
    for row in rows:
        _log(db, row, SerialMovementKind.relocated, location_kind=to_kind, location_id=to_id,
             document_type="transfer", document_id=transfer_id, actor_user_id=actor_user_id)
    return list(rows)


def mark_sold(
    db: Session,
    *,
    item: Item,
    origin_kind: LocationKind,
    origin_id: int,
    serials: list[str],
    invoice_id: int,
    actor_user_id: int | None = None,
) -> None:
    """Each serial must be in_stock at the origin; set sold + link the invoice (FR-004)."""
    for s in serials:
        row = _get(db, item.id, s)
        if row is None or row.status != SerialStatus.in_stock:
            raise SerialError(f"السيريال «{s}» مش موجود في المخزن.")
        if row.location_kind != origin_kind or row.location_id != origin_id:
            raise SerialError(f"السيريال «{s}» مش في المخزن اللي بتبيع منه.")
        row.status = SerialStatus.sold
        row.location_kind = None
        row.location_id = None
        row.sold_invoice_id = invoice_id
        # No location: the unit left. Recording the origin here would keep sold units in a
        # store's list of what it holds.
        _log(db, row, SerialMovementKind.sold, document_type="sales_invoice",
             document_id=invoice_id, actor_user_id=actor_user_id)
    db.flush()


def restore_free(
    db: Session,
    *,
    item: Item,
    origin_kind: LocationKind,
    origin_id: int,
    serials: list[str],
    document_id: int | None = None,
    actor_user_id: int | None = None,
) -> None:
    """المرتجع الحر — السيريال بيرجع مخزن من أي بيعة، من غير ربط بفاتورة معينة.

    الحارس الوحيد: الرقم لازم يكون موجود ومبيع فعلاً — اللي مش موجود بيرفع خطأ واضح،
    والمرتجع كله بيفشل قبل ما يتحرك أي حاجة.
    """
    for s_no in serials:
        row = _get(db, item.id, s_no)
        if row is None or row.status != SerialStatus.sold:
            raise SerialError(f"السيريال «{s_no}» مش مبيع في النظام — اتأكد من الرقم.")
        row.status = SerialStatus.in_stock
        row.location_kind = origin_kind
        row.location_id = origin_id
        row.sold_invoice_id = None
        _log(db, row, SerialMovementKind.returned, location_kind=origin_kind,
             location_id=origin_id, document_type="sales_return",
             document_id=document_id, actor_user_id=actor_user_id)


def restore_for_return(
    db: Session,
    *,
    item: Item,
    invoice_id: int,
    origin_kind: LocationKind,
    origin_id: int,
    serials: list[str],
    actor_user_id: int | None = None,
) -> None:
    """Each serial must have been sold on this invoice; restore to in_stock@origin (FR-005)."""
    for s in serials:
        row = _get(db, item.id, s)
        if row is None or row.status != SerialStatus.sold or row.sold_invoice_id != invoice_id:
            raise SerialError(f"السيريال «{s}» مااتباعش على الفاتورة دي.")
        row.status = SerialStatus.in_stock
        row.location_kind = origin_kind
        row.location_id = origin_id
        row.sold_invoice_id = None
        _log(db, row, SerialMovementKind.returned, location_kind=origin_kind,
             location_id=origin_id, document_type="sales_invoice", document_id=invoice_id,
             actor_user_id=actor_user_id)
    db.flush()
