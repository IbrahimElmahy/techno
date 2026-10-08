from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.catalog import (
    Item, ItemSerial, ItemSerialMovement, SerialMovementKind, SerialStatus,
)
from src.models.stock import LocationKind, StockDirection, StockDoc
from src.services import stock_service


class SerialError(Exception):
    pass


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
    if not item.is_serialized:
        raise SerialError("هذا الصنف غير متتبَّع بالسيريال.")
    if not serials:
        raise SerialError("يجب إدخال سيريال واحد على الأقل.")
    if len(set(serials)) != len(serials):
        raise SerialError("يوجد سيريال مكرر في الطلب.")
    rows: list[ItemSerial] = []
    for s in serials:
        if _get(db, item.id, s) is not None:
            raise SerialError(f"السيريال «{s}» مسجّل مسبقاً لهذا الصنف.")
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
    has_serials = bool(serials)
    if not item.is_serialized:
        if has_serials:
            raise SerialError("أُرسلت سيريالات لصنف غير متتبَّع بالسيريال.")
        return
    if not has_serials:
        raise SerialError("هذا الصنف متتبَّع بالسيريال — أدخل السيريالات.")
    if to_qty(unit_factor) != to_qty(Decimal(1)):
        raise SerialError("تُباع الأصناف ذات السيريال بالوحدة الأساسية فقط.")
    if len(set(serials)) != len(serials):
        raise SerialError("يوجد سيريال مكرر في السطر.")
    if Decimal(len(serials)) != to_qty(quantity):
        raise SerialError("يجب أن يساوي عدد السيريالات كمية السطر.")


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
             document_type=StockDoc.TRANSFER, document_id=transfer_id, actor_user_id=actor_user_id)
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
    for s in serials:
        row = _get(db, item.id, s)
        if row is None or row.status != SerialStatus.in_stock:
            raise SerialError(f"السيريال «{s}» غير موجود في المخزن.")
        if row.location_kind != origin_kind or row.location_id != origin_id:
            raise SerialError(f"السيريال «{s}» ليس في المخزن الذي تبيع منه.")
        row.status = SerialStatus.sold
        row.location_kind = None
        row.location_id = None
        row.sold_invoice_id = invoice_id
        _log(db, row, SerialMovementKind.sold, document_type=StockDoc.SALE,
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
    for s_no in serials:
        row = _get(db, item.id, s_no)
        if row is None or row.status != SerialStatus.sold:
            raise SerialError(f"السيريال «{s_no}» غير مبيع في النظام — تأكد من الرقم.")
        row.status = SerialStatus.in_stock
        row.location_kind = origin_kind
        row.location_id = origin_id
        row.sold_invoice_id = None
        _log(db, row, SerialMovementKind.returned, location_kind=origin_kind,
             location_id=origin_id, document_type=StockDoc.SALE_RETURN,
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
    for s in serials:
        row = _get(db, item.id, s)
        if row is None or row.status != SerialStatus.sold or row.sold_invoice_id != invoice_id:
            raise SerialError(f"السيريال «{s}» لم يُبع على هذه الفاتورة.")
        row.status = SerialStatus.in_stock
        row.location_kind = origin_kind
        row.location_id = origin_id
        row.sold_invoice_id = None
        _log(db, row, SerialMovementKind.returned, location_kind=origin_kind,
             location_id=origin_id, document_type=StockDoc.SALE, document_id=invoice_id,
             actor_user_id=actor_user_id)
    db.flush()
