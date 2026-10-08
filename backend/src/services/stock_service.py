from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO_QTY, to_qty
from src.lib import stock_docs
from src.models.stock import (
    LocationKind,
    StockDirection,
    StockLocator,
    StockMovement,
)


class StockError(Exception):
    pass


def _lock_locator(db: Session, item_id: int, location_kind: LocationKind, location_id: int) -> None:
    loc = db.scalar(
        select(StockLocator)
        .where(
            StockLocator.item_id == item_id,
            StockLocator.location_kind == location_kind,
            StockLocator.location_id == location_id,
        )
        .with_for_update()
    )
    if loc is None:
        loc = StockLocator(item_id=item_id, location_kind=location_kind, location_id=location_id)
        db.add(loc)
        db.flush()
        db.scalar(
            select(StockLocator).where(StockLocator.id == loc.id).with_for_update()
        )



def _branch_of(db: Session, location_kind, location_id: int) -> int | None:
    kind = getattr(location_kind, "value", location_kind)
    if kind == "warehouse":
        from src.models.warehouse import Warehouse

        wh = db.get(Warehouse, location_id)
        return wh.branch_id if wh else None
    if kind == "rep":
        from src.models.user import User

        rep = db.get(User, location_id)
        return rep.branch_id if rep else None
    return None


def on_hand(db: Session, item_id: int, location_kind: LocationKind, location_id: int) -> Decimal:
    total = ZERO_QTY
    rows = db.scalars(
        select(StockMovement).where(
            StockMovement.item_id == item_id,
            StockMovement.location_kind == location_kind,
            StockMovement.location_id == location_id,
        )
    ).all()
    for mv in rows:
        q = to_qty(mv.quantity)
        total += q if mv.direction == StockDirection.in_ else -q
    return to_qty(total)


def _label(db, location_kind: LocationKind, location_id: int) -> str:
    from src.models.warehouse import Custody, Warehouse

    if location_kind == LocationKind.warehouse:
        wh = db.get(Warehouse, location_id)
        return wh.name if wh and wh.name else f"مخزن #{location_id}"
    cust = db.get(Custody, location_id)
    if cust is None:
        return f"عهدة #{location_id}"
    if cust.rep_id is not None:
        from src.models.user import User
        user = db.get(User, cust.rep_id)
        who = (user.full_name or user.username) if user else f"#{cust.rep_id}"
        return f"عهدة {who}"
    if cust.warehouse_id is not None:
        wh = db.get(Warehouse, cust.warehouse_id)
        return f"عهدة {wh.name}" if wh and wh.name else f"عهدة مخزن #{cust.warehouse_id}"
    return f"عهدة #{location_id}"


def not_enough_message(db, item_id: int, location_kind: LocationKind, location_id: int,
                available, wanted) -> str:
    from src.models.catalog import Item

    item = db.get(Item, item_id)
    name = item.name if item and item.name else f"صنف #{item_id}"
    where = _label(db, location_kind, location_id)
    short = to_qty(wanted) - to_qty(available)
    return (
        f"الرصيد مايكفيش: «{name}» في {where} المتاح منه {to_qty(available)} "
        f"والمطلوب صرفه {to_qty(wanted)} — ناقص {short}."
    )


def _normalize_names(movement_type: str, source_doc_type: str | None) -> tuple[str, str | None]:
    move = stock_docs.canonical(movement_type, kind="movement")
    if move is None:
        raise StockError(
            f"نوع حركة مش متسجّل: «{movement_type}» — ضيفه في `src/lib/stock_docs.py`."
        )
    doc = source_doc_type
    if doc is not None:
        doc = stock_docs.canonical(doc)
        if doc is None:
            raise StockError(
                f"نوع مستند مش متسجّل: «{source_doc_type}» — "
                "ضيفه في `src/lib/stock_docs.py`."
            )
    return move, doc


def post_movement(
    db: Session,
    *,
    item_id: int,
    location_kind: LocationKind,
    location_id: int,
    movement_type: str,
    direction: StockDirection,
    quantity: Decimal,
    actor_user_id: int,
    source_doc_type: str | None = None,
    source_doc_id: int | None = None,
    reverses_movement_id: int | None = None,
    allow_negative: bool = False,
    movement_date=None,
) -> StockMovement:
    q = to_qty(quantity)
    if q <= ZERO_QTY:
        raise StockError("كمية الحركة لازم تكون أكبر من صفر.")
    movement_type, source_doc_type = _normalize_names(movement_type, source_doc_type)
    _lock_locator(db, item_id, location_kind, location_id)
    if direction == StockDirection.out and not allow_negative:
        current = on_hand(db, item_id, location_kind, location_id)
        if current - q < ZERO_QTY:
            raise StockError(not_enough_message(db, item_id, location_kind, location_id, current, q))
    mv = StockMovement(
        item_id=item_id,
        location_kind=location_kind,
        location_id=location_id,
        movement_type=movement_type,
        direction=direction,
        quantity=q,
        source_doc_type=source_doc_type,
        source_doc_id=source_doc_id,
        reverses_movement_id=reverses_movement_id,
        actor_user_id=actor_user_id,
        movement_date=(movement_date
                       or stock_docs.date_of(db, source_doc_type, source_doc_id)
                       or date.today()),
        branch_id=_branch_of(db, location_kind, location_id),
    )
    db.add(mv)
    db.flush()
    return mv


def reverse_movement(
    db: Session, *, original_id: int, actor_user_id: int, movement_type: str | None = None
) -> StockMovement:
    original = db.get(StockMovement, original_id)
    if original is None:
        raise StockError("الحركة الأصلية مش موجودة.")
    if original.reverses_movement_id is not None:
        raise StockError("الحركة العكسية نفسها مايتعملهاش عكس.")
    existing = db.scalar(
        select(StockMovement).where(StockMovement.reverses_movement_id == original_id)
    )
    if existing is not None:
        raise StockError("الحركة دي اتعكست قبل كده.")
    mirror = (
        StockDirection.out if original.direction == StockDirection.in_ else StockDirection.in_
    )
    return post_movement(
        db,
        item_id=original.item_id,
        location_kind=original.location_kind,
        location_id=original.location_id,
        movement_type=movement_type or f"reverse_{original.movement_type}",
        direction=mirror,
        quantity=original.quantity,
        actor_user_id=actor_user_id,
        source_doc_type=original.source_doc_type,
        source_doc_id=original.source_doc_id,
        reverses_movement_id=original_id,
    )
