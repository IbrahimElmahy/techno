from __future__ import annotations

from sqlalchemy import and_, not_, or_, select
from sqlalchemy.orm import Session

from src.models.catalog import Item
from src.models.org import Branch
from src.models.stock import StockMovement

BRANCH_PREFIXES = {"السادات": "FC-", "العلياء": "AL-"}
SHARED_PREFIX = "PR-"


def prefix_of(db: Session, branch_id: int) -> str | None:
    name = db.scalar(select(Branch.name).where(Branch.id == branch_id))
    return BRANCH_PREFIXES.get(name or "")


def belongs_to(db: Session, branch_id: int):
    prefix = prefix_of(db, branch_id)
    if prefix:
        own = Item.code.like(f"{prefix}%")
    else:
        own = and_(*(not_(Item.code.like(f"{p}%"))
                     for p in (*BRANCH_PREFIXES.values(), SHARED_PREFIX)))
    moved_here = select(StockMovement.item_id).where(
        StockMovement.branch_id == branch_id).distinct()
    never_moved = Item.id.not_in(select(StockMovement.item_id).distinct())
    return or_(own, Item.id.in_(moved_here),
               and_(Item.code.like(f"{SHARED_PREFIX}%"), never_moved))
