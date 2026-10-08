from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.stock import LocationKind
from src.models.warehouse import Custody


def rep_store(db: Session, rep_user_id: int) -> tuple[LocationKind, int] | None:
    emp = db.scalar(select(Employee).where(Employee.user_id == rep_user_id))
    if emp is not None and emp.warehouse_id is not None:
        return (LocationKind.warehouse, emp.warehouse_id)
    own = db.scalars(
        select(Custody)
        .where(Custody.rep_id == rep_user_id)
        .order_by(Custody.family.is_(None).desc(), Custody.active.desc(), Custody.id)
    ).first()
    if own is not None:
        return (LocationKind.custody, own.id)
    return None


def is_own_store(db: Session, rep_user_id: int, kind: LocationKind, location_id: int) -> bool:
    store = rep_store(db, rep_user_id)
    return store is not None and store == (kind, location_id)
