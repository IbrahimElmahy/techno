from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sqlalchemy.orm import selectinload

from src.lib.doc_order import newest_first
from src.services import numbering

from src.core.money import to_qty
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection
from src.models.stock_count import (
    StockCount, StockCountKind, StockCountLine, StockCountStatus)
from src.models.warehouse import Warehouse
from src.services import audit_service, stock_service

ZERO = to_qty(0)


class StockCountError(Exception):
    pass


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, StockCount, "CNT")


def _last_counted(db: Session) -> dict[tuple[int, int], date]:
    rows = db.execute(
        select(StockCountLine.item_id, StockCountLine.warehouse_id,
               func.max(StockCount.count_date))
        .join(StockCount, StockCount.id == StockCountLine.count_id)
        .where(StockCount.status == StockCountStatus.posted)
        .group_by(StockCountLine.item_id, StockCountLine.warehouse_id)
    ).all()
    return {(r[0], r[1]): r[2] for r in rows}


def open_sheet(
    db: Session, *, warehouse_id: int | None, count_date: date | None,
    actor_user_id: int, item_ids: list[int] | None = None, notes: str | None = None,
    kind: StockCountKind = StockCountKind.full, batch_size: int | None = None,
    statement1: str | None = None,
) -> StockCount:
    if kind == StockCountKind.spot and not item_ids:
        raise StockCountError("جرد العينة لازم تحدد فيه الأصناف.")
    if kind == StockCountKind.cycle and not batch_size:
        batch_size = 20
    warehouses = (
        [db.get(Warehouse, warehouse_id)] if warehouse_id is not None
        else list(db.scalars(select(Warehouse).where(Warehouse.active.is_(True))).all())
    )
    if any(w is None for w in warehouses):
        raise StockCountError("المخزن غير موجود.")
    if not warehouses:
        raise StockCountError("مفيش مخازن نشطة للجرد.")

    items = list(db.scalars(select(Item)).all())
    if item_ids:
        wanted = set(item_ids)
        items = [i for i in items if i.id in wanted]
        if not items:
            raise StockCountError("الأصناف المطلوبة غير موجودة.")

    sheet = StockCount(
        document_number=_doc_number(db), warehouse_id=warehouse_id,
        count_date=count_date or date.today(), status=StockCountStatus.draft,
        notes=(notes or None), actor_user_id=actor_user_id, kind=kind,
        statement1=((statement1 or "").strip() or None),
    )
    db.add(sheet)
    db.flush()

    candidates: list[tuple[Item, int, object]] = []
    for wh in warehouses:
        for item in items:
            on_hand = to_qty(stock_service.on_hand(db, item.id, LocationKind.warehouse, wh.id))
            if on_hand <= ZERO and kind != StockCountKind.spot:
                continue
            candidates.append((item, wh.id, on_hand))

    if kind == StockCountKind.cycle:
        seen = _last_counted(db)
        candidates.sort(key=lambda c: (seen.get((c[0].id, c[1]), date.min), c[0].id))
        candidates = candidates[:batch_size]

    for item, wh_id, on_hand in candidates:
        sheet.lines.append(StockCountLine(
            item_id=item.id, warehouse_id=wh_id, book_quantity=on_hand,
        ))

    if not sheet.lines:
        raise StockCountError("مفيش أرصدة في المخزن ده — مفيش حاجة تتجرد.")

    db.flush()
    audit_service.record(db, action="stock_count.open", actor_user_id=actor_user_id,
                         entity_type="stock_count", entity_id=sheet.id,
                         after={"doc": sheet.document_number, "lines": len(sheet.lines)})
    return sheet


_UNSET = object()


def enter_counts(
    db: Session, *, count_id: int, counts: dict[int, Decimal | None], actor_user_id: int,
    statement1=_UNSET,
) -> StockCount:
    sheet = db.get(StockCount, count_id)
    if sheet is None:
        raise StockCountError("الجرد غير موجود.")
    if sheet.status != StockCountStatus.draft:
        raise StockCountError("الجرد ده مش مفتوح — القيم مابتتغيّرش بعد الترحيل.")
    if statement1 is not _UNSET:
        sheet.statement1 = (statement1 or "").strip() or None

    by_id = {ln.id: ln for ln in sheet.lines}
    for line_id, value in counts.items():
        line = by_id.get(line_id)
        if line is None:
            raise StockCountError(f"السطر {line_id} مش في الجرد ده.")
        if value is None:
            line.counted_quantity = None
            continue
        qty = to_qty(value)
        if qty < ZERO:
            raise StockCountError("الكمية المعدودة ماتكونش بالسالب.")
        line.counted_quantity = qty
    db.flush()
    return sheet


def post(db: Session, *, count_id: int, actor_user_id: int) -> StockCount:
    sheet = db.get(StockCount, count_id)
    if sheet is None:
        raise StockCountError("الجرد غير موجود.")
    if sheet.status != StockCountStatus.draft:
        raise StockCountError("الجرد ده اترحّل أو اتلغى قبل كده.")
    if not any(ln.counted_quantity is not None for ln in sheet.lines):
        raise StockCountError("مفيش أي سطر متعدود — مفيش حاجة تترحّل.")

    blocked = []
    for line in sheet.lines:
        if line.counted_quantity is None:
            continue
        item = db.get(Item, line.item_id)
        if item is None:
            raise StockCountError(f"الصنف {line.item_id} غير موجود.")
        current = to_qty(stock_service.on_hand(
            db, line.item_id, LocationKind.warehouse, line.warehouse_id))
        if to_qty(line.counted_quantity) == current:
            continue
        if getattr(item, "is_serialized", False) or getattr(item, "is_perishable", False):
            blocked.append(item.name)
    if blocked:
        raise StockCountError(
            "الأصناف دي بسرايل أو بصلاحية وفرقها مايتسوّاش بكمية مجرّدة: "
            + "، ".join(sorted(set(blocked)))
            + ". تسويتها بتتم بالسيريال أو باللوط."
        )

    for line in sheet.lines:
        if line.counted_quantity is None:
            continue
        current = to_qty(stock_service.on_hand(
            db, line.item_id, LocationKind.warehouse, line.warehouse_id))
        counted = to_qty(line.counted_quantity)
        delta = to_qty(Decimal(str(counted)) - Decimal(str(current)))
        if delta == ZERO:
            continue
        mv = stock_service.post_movement(
            db, item_id=line.item_id, location_kind=LocationKind.warehouse,
            location_id=line.warehouse_id,
            movement_type="count_adjust_in" if delta > ZERO else "count_adjust_out",
            direction=StockDirection.in_ if delta > ZERO else StockDirection.out,
            quantity=abs(delta), actor_user_id=actor_user_id,
            source_doc_type="stock_count", source_doc_id=sheet.id,
        )
        line.stock_movement_id = mv.id

    sheet.status = StockCountStatus.posted
    sheet.posted_at = datetime.now()
    db.flush()
    audit_service.record(db, action="stock_count.post", actor_user_id=actor_user_id,
                         entity_type="stock_count", entity_id=sheet.id,
                         after={"doc": sheet.document_number})
    return sheet


def cancel(db: Session, *, count_id: int, actor_user_id: int) -> StockCount:
    sheet = db.get(StockCount, count_id)
    if sheet is None:
        raise StockCountError("الجرد غير موجود.")
    if sheet.status == StockCountStatus.posted:
        raise StockCountError("الجرد اترحّل — حركاته موجودة في المخزن وماتتلغيش بإلغاء الورقة.")
    sheet.status = StockCountStatus.cancelled
    db.flush()
    return sheet


def get(db: Session, count_id: int) -> StockCount | None:
    return db.scalar(
        select(StockCount).where(StockCount.id == count_id)
        .options(selectinload(StockCount.lines))
    )


def listing(db: Session, *, status: str | None = None) -> list[StockCount]:
    stmt = select(StockCount)
    if status:
        stmt = stmt.where(StockCount.status == status)
    return list(db.scalars(stmt.order_by(*newest_first(StockCount, StockCount.count_date))).all())
