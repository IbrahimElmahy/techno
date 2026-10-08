from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.cost_center import CostCenter


class CostCenterError(Exception):
    pass


def create(db: Session, *, code: str, name: str, parent_id: int | None = None) -> CostCenter:
    code = code.strip()
    if not code:
        raise CostCenterError("كود مركز التكلفة مطلوب.")
    if db.scalar(select(CostCenter).where(CostCenter.code == code)) is not None:
        raise CostCenterError(f"كود مركز التكلفة «{code}» مسجّل مسبقاً.")
    if parent_id is not None and db.get(CostCenter, parent_id) is None:
        raise CostCenterError("مركز التكلفة الرئيسي غير موجود.")
    cc = CostCenter(code=code, name=name, parent_id=parent_id)
    db.add(cc)
    db.flush()
    return cc


def update(
    db: Session, *, cost_center_id: int, name: str | None = None, active: bool | None = None
) -> CostCenter:
    cc = db.get(CostCenter, cost_center_id)
    if cc is None:
        raise CostCenterError("مركز التكلفة غير موجود.")
    if name is not None:
        cc.name = name
    if active is not None:
        if active is False:
            _assert_deactivatable(db, cc)
        cc.active = active
    db.flush()
    return cc


def deactivate(db: Session, *, cost_center_id: int) -> CostCenter:
    cc = db.get(CostCenter, cost_center_id)
    if cc is None:
        raise CostCenterError("مركز التكلفة غير موجود.")
    _assert_deactivatable(db, cc)
    cc.active = False
    db.flush()
    return cc


def _assert_deactivatable(db: Session, cc: CostCenter) -> None:
    has_active_child = db.scalar(
        select(CostCenter.id).where(CostCenter.parent_id == cc.id, CostCenter.active.is_(True))
    )
    if has_active_child is not None:
        raise CostCenterError("يتبع هذا المركز مراكز نشطة — أقفلها أولاً.")


def is_active(db: Session, cost_center_id: int) -> bool:
    cc = db.get(CostCenter, cost_center_id)
    return bool(cc and cc.active)
