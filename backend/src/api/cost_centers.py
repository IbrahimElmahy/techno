"""Cost Centers router (006).

CRUD for the analytical-dimension master. Reuses the 005 `accounting.chart.*` capabilities
(Accountant + System Admin) — a cost center is chart-adjacent master data, no new role.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_ACCOUNTING_CHART_READ, CAP_ACCOUNTING_CHART_WRITE
from src.core.db import get_db
from src.models.cost_center import CostCenter
from src.services import cost_center_service
from src.services.cost_center_service import CostCenterError

router = APIRouter(tags=["cost-centers"])


class CostCenterOut(BaseModel):
    id: int
    code: str
    name: str
    parent_id: int | None
    active: bool
    children: list[CostCenterOut] | None = None


class CostCenterCreate(BaseModel):
    code: str
    name: str
    parent_id: int | None = None


class CostCenterUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None


def _out(db: Session, cc: CostCenter, *, with_children: bool = False) -> CostCenterOut:
    children = None
    if with_children:
        kids = db.scalars(
            select(CostCenter).where(CostCenter.parent_id == cc.id).order_by(CostCenter.code)
        ).all()
        children = [_out(db, k, with_children=True) for k in kids]
    return CostCenterOut(
        id=cc.id, code=cc.code, name=cc.name, parent_id=cc.parent_id, active=cc.active,
        children=children,
    )


@router.get("/cost-centers", response_model=list[CostCenterOut])
def list_cost_centers(
    tree: bool = False,
    active: bool | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[CostCenterOut]:
    stmt = select(CostCenter)
    if tree:
        stmt = stmt.where(CostCenter.parent_id.is_(None))
    if active is not None:
        stmt = stmt.where(CostCenter.active.is_(active))
    rows = db.scalars(stmt.order_by(CostCenter.code)).all()
    return [_out(db, c, with_children=tree) for c in rows]


@router.post("/cost-centers", response_model=CostCenterOut, status_code=status.HTTP_201_CREATED)
def create_cost_center(
    body: CostCenterCreate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> CostCenterOut:
    try:
        cc = cost_center_service.create(db, code=body.code, name=body.name, parent_id=body.parent_id)
    except CostCenterError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "cost_center_conflict", "message": str(exc)})
    db.commit()
    return _out(db, cc)


@router.get("/cost-centers/{cost_center_id}", response_model=CostCenterOut)
def get_cost_center(
    cost_center_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> CostCenterOut:
    cc = db.get(CostCenter, cost_center_id)
    if cc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": "Cost center not found"})
    return _out(db, cc)


@router.patch("/cost-centers/{cost_center_id}", response_model=CostCenterOut)
def update_cost_center(
    cost_center_id: int,
    body: CostCenterUpdate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> CostCenterOut:
    try:
        cc = cost_center_service.update(
            db, cost_center_id=cost_center_id, name=body.name, active=body.active
        )
    except CostCenterError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "cost_center_conflict", "message": str(exc)})
    db.commit()
    return _out(db, cc)


@router.delete("/cost-centers/{cost_center_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_cost_center(
    cost_center_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        cost_center_service.deactivate(db, cost_center_id=cost_center_id)
    except CostCenterError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "cost_center_conflict", "message": str(exc)})
    db.commit()
