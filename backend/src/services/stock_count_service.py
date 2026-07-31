"""جرد المخازن — 031-a5-restructure."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from src.core.money import to_qty
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection
from src.models.stock_count import StockCount, StockCountLine, StockCountStatus
from src.models.warehouse import Warehouse
from src.services import audit_service, stock_service

ZERO = to_qty(0)


class StockCountError(Exception):
    pass


def _doc_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(StockCount)) or 0
    return f"CNT-{n + 1:06d}"


def open_sheet(
    db: Session, *, warehouse_id: int | None, count_date: date | None,
    actor_user_id: int, item_ids: list[int] | None = None, notes: str | None = None,
) -> StockCount:
    """Open a sheet with a line per item that the warehouse holds.

    Items with **no** stock are included when named explicitly but not otherwise: a general sheet
    listing every item in the catalogue is a sheet nobody finishes, and an item that is not there
    and not expected is not something the count is about. Naming items covers the other case —
    checking whether something believed to be gone is actually gone.
    """
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
        notes=(notes or None), actor_user_id=actor_user_id,
    )
    db.add(sheet)
    db.flush()

    for wh in warehouses:
        for item in items:
            on_hand = stock_service.on_hand(db, item.id, LocationKind.warehouse, wh.id)
            if to_qty(on_hand) <= ZERO and not item_ids:
                continue
            sheet.lines.append(StockCountLine(
                item_id=item.id, warehouse_id=wh.id, book_quantity=to_qty(on_hand),
            ))

    if not sheet.lines:
        raise StockCountError("مفيش أرصدة في المخزن ده — مفيش حاجة تتجرد.")

    db.flush()
    audit_service.record(db, action="stock_count.open", actor_user_id=actor_user_id,
                         entity_type="stock_count", entity_id=sheet.id,
                         after={"doc": sheet.document_number, "lines": len(sheet.lines)})
    return sheet


def enter_counts(
    db: Session, *, count_id: int, counts: dict[int, Decimal | None], actor_user_id: int,
) -> StockCount:
    """Write what was found, keyed by LINE id. Only a draft sheet accepts numbers."""
    sheet = db.get(StockCount, count_id)
    if sheet is None:
        raise StockCountError("الجرد غير موجود.")
    if sheet.status != StockCountStatus.draft:
        raise StockCountError("الجرد ده مش مفتوح — القيم مابتتغيّرش بعد الترحيل.")

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
    """Settle every counted difference into stock, then close the sheet.

    The adjustment is computed against stock **as it stands now**, not against the snapshot on the
    line: goods that moved legitimately during the count already changed the balance, and adjusting
    by the old difference would apply that movement a second time. The result is that on-hand ends
    up equal to what was counted, which is the only thing a count is for.

    **Uncounted lines are left alone.** A blank is «nobody reached this shelf», and treating it as
    zero would write off stock that was never looked at.
    """
    sheet = db.get(StockCount, count_id)
    if sheet is None:
        raise StockCountError("الجرد غير موجود.")
    if sheet.status != StockCountStatus.draft:
        raise StockCountError("الجرد ده اترحّل أو اتلغى قبل كده.")
    if not any(ln.counted_quantity is not None for ln in sheet.lines):
        raise StockCountError("مفيش أي سطر متعدود — مفيش حاجة تترحّل.")

    # Serialized and perishable stock is reconciled by unit and by lot; a bare quantity adjustment
    # would move on-hand while leaving the serials and batches behind, which is exactly the drift
    # the integrity check exists to catch. Refused as a whole so nothing posts half-right.
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
    return list(db.scalars(stmt.order_by(StockCount.id.desc())).all())
