from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.lib import discounts
from src.models.catalog import Item


def item_fixed(db: Session, lines, column=None) -> dict:
    col = column if column is not None else Item.default_discount_pct
    ids = {ln.item_id for ln in lines if ln.fixed_discount_pct is None
           and ln.variable_discount_pct is None and ln.discount_pct}
    if not ids:
        return {}
    return dict(db.execute(select(Item.id, col).where(Item.id.in_(ids))).all())


def split_of(ln, fixed_by_item: dict) -> dict:
    f, v = discounts.split(ln.discount_pct, ln.fixed_discount_pct, ln.variable_discount_pct,
                           fixed_by_item.get(ln.item_id))
    return {"fixed_discount_pct": f, "variable_discount_pct": v}
