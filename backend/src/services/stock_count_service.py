"""جرد المخازن — 031-a5-restructure."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sqlalchemy.orm import selectinload

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
    """آخر مرة اتعدّ فيها كل (صنف، مخزن) — من الأوراق المرحّلة بس.

    A draft sheet is a count in progress, not a count that happened; letting it count would push an
    item to the back of the rotation because somebody opened a sheet and walked away.
    """
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
) -> StockCount:
    """Open a sheet with a line per item to be counted.

    **The three kinds differ in exactly one thing: which items land on the sheet.** After that they
    are the same document — count, difference, post — which is why they are one code path and not
    three screens that would each drift.

    * `full` — everything the warehouse holds. The shelves are closed and the whole store is done.
    * `cycle` — a batch, oldest-counted first, so the rotation covers everything over time without
      ever stopping the shop. An item never counted sorts first: it has waited longest by
      definition.
    * `spot` — exactly the items named, whether or not they are believed to be there. That is the
      whole point of a spot check: «هو ده فعلاً خلص؟» is a question about an item the books say is
      gone.

    Items with **no** stock are skipped except on a spot check, for the same reason a general sheet
    listing the whole catalogue is a sheet nobody finishes.
    """
    if kind == StockCountKind.spot and not item_ids:
        raise StockCountError("جرد العينة لازم تحدد فيه الأصناف.")
    if kind == StockCountKind.cycle and not batch_size:
        # Defaulted rather than refused: «دفعة» without a size is a reasonable thing to ask for,
        # and twenty lines is a batch one person finishes in a morning.
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
    )
    db.add(sheet)
    db.flush()

    # Every (item, warehouse) this sheet could cover, with the book quantity frozen NOW. Frozen at
    # opening rather than read at posting: a sale during the count is not a counting error, and
    # comparing the counter against a number that moved under him is how a good count produces a
    # false difference.
    candidates: list[tuple[Item, int, object]] = []
    for wh in warehouses:
        for item in items:
            on_hand = to_qty(stock_service.on_hand(db, item.id, LocationKind.warehouse, wh.id))
            if on_hand <= ZERO and kind != StockCountKind.spot:
                continue
            candidates.append((item, wh.id, on_hand))

    if kind == StockCountKind.cycle:
        # Oldest first, never-counted before that. `date.min` is not a real date on any line — it
        # is «has waited since before records», which is exactly the rotation's answer for an item
        # nobody has ever reached.
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
