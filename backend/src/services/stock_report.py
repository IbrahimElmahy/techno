"""Stock planning reports (011).

reorder(): items whose total on-hand (across all locations) is below their min_stock or above their
max_stock. Advisory only — derived from the 002 stock movements; never blocks anything.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO_QTY, to_qty
from src.models.catalog import Item
from src.models.stock import StockDirection, StockMovement


@dataclass
class ReorderRow:
    item_id: int
    code: str
    name: str
    on_hand: Decimal
    min_stock: Decimal | None
    max_stock: Decimal | None
    flag: str  # below_min | above_max


def _total_on_hand(db: Session, item_id: int) -> Decimal:
    rows = db.execute(
        select(StockMovement.direction, func.coalesce(func.sum(StockMovement.quantity), 0))
        .where(StockMovement.item_id == item_id)
        .group_by(StockMovement.direction)
    ).all()
    total = ZERO_QTY
    for direction, qty in rows:
        q = to_qty(qty)
        total += q if direction == StockDirection.in_ else -q
    return to_qty(total)


def reorder(db: Session) -> list[ReorderRow]:
    """Items below min_stock (below_min) or above max_stock (above_max)."""
    items = db.scalars(
        select(Item).where((Item.min_stock.is_not(None)) | (Item.max_stock.is_not(None)))
    ).all()
    out: list[ReorderRow] = []
    for it in items:
        on_hand = _total_on_hand(db, it.id)
        mn = to_qty(it.min_stock) if it.min_stock is not None else None
        mx = to_qty(it.max_stock) if it.max_stock is not None else None
        flag = None
        if mn is not None and on_hand < mn:
            flag = "below_min"
        elif mx is not None and on_hand > mx:
            flag = "above_max"
        if flag:
            out.append(ReorderRow(item_id=it.id, code=it.code, name=it.name, on_hand=on_hand,
                                  min_stock=mn, max_stock=mx, flag=flag))
    return out
