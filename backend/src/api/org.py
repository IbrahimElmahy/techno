"""Organization router (T035): governorates, branches, territories. FR-012, FR-014."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, ensure_branch_access, require_capability
from src.auth.rbac import (
    CAP_BRANCH_READ,
    CAP_BRANCH_WRITE,
    CAP_GOVERNORATE_READ,
    CAP_TERRITORY_READ,
    CAP_TERRITORY_WRITE,
)
from src.core.db import get_db
from src.models.org import Branch, Governorate, Territory
from src.services import audit_service

router = APIRouter(tags=["org"])


class GovernorateOut(BaseModel):
    id: int
    name: str


class BranchCreate(BaseModel):
    name: str
    governorate_id: int
    is_head_office: bool = False


class BranchOut(BaseModel):
    id: int
    name: str
    governorate_id: int
    is_head_office: bool
    active: bool


class TerritoryCreate(BaseModel):
    name: str
    branch_id: int


class TerritoryOut(BaseModel):
    id: int
    name: str
    branch_id: int
    active: bool


@router.get("/governorates", response_model=list[GovernorateOut])
def list_governorates(
    _: CurrentUser = Depends(require_capability(CAP_GOVERNORATE_READ)),
    db: Session = Depends(get_db),
) -> list[GovernorateOut]:
    return [GovernorateOut(id=g.id, name=g.name) for g in db.scalars(select(Governorate)).all()]


@router.get("/branches", response_model=list[BranchOut])
def list_branches(
    current: CurrentUser = Depends(require_capability(CAP_BRANCH_READ)),
    db: Session = Depends(get_db),
) -> list[BranchOut]:
    stmt = select(Branch)
    if not current.is_admin:
        stmt = stmt.where(Branch.id == current.branch_id)
    return [
        BranchOut(
            id=b.id,
            name=b.name,
            governorate_id=b.governorate_id,
            is_head_office=b.is_head_office,
            active=b.active,
        )
        for b in db.scalars(stmt).all()
    ]


@router.post("/branches", response_model=BranchOut, status_code=status.HTTP_201_CREATED)
def create_branch(
    body: BranchCreate,
    current: CurrentUser = Depends(require_capability(CAP_BRANCH_WRITE)),
    db: Session = Depends(get_db),
) -> BranchOut:
    branch = Branch(
        name=body.name, governorate_id=body.governorate_id, is_head_office=body.is_head_office
    )
    db.add(branch)
    db.flush()
    audit_service.record(
        db, action="branch.create", actor_user_id=current.id, entity_type="branch",
        entity_id=branch.id, after={"name": branch.name},
    )
    db.commit()
    return BranchOut(
        id=branch.id, name=branch.name, governorate_id=branch.governorate_id,
        is_head_office=branch.is_head_office, active=branch.active,
    )


@router.get("/territories", response_model=list[TerritoryOut])
def list_territories(
    branch_id: int | None = None,
    current: CurrentUser = Depends(require_capability(CAP_TERRITORY_READ)),
    db: Session = Depends(get_db),
) -> list[TerritoryOut]:
    stmt = select(Territory)
    if not current.is_admin:
        stmt = stmt.where(Territory.branch_id == current.branch_id)
    elif branch_id is not None:
        stmt = stmt.where(Territory.branch_id == branch_id)
    return [
        TerritoryOut(id=t.id, name=t.name, branch_id=t.branch_id, active=t.active)
        for t in db.scalars(stmt).all()
    ]


@router.post("/territories", response_model=TerritoryOut, status_code=status.HTTP_201_CREATED)
def create_territory(
    body: TerritoryCreate,
    current: CurrentUser = Depends(require_capability(CAP_TERRITORY_WRITE)),
    db: Session = Depends(get_db),
) -> TerritoryOut:
    if not current.is_admin:
        ensure_branch_access(current, body.branch_id)
    if db.get(Branch, body.branch_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "Branch not found"})
    territory = Territory(name=body.name, branch_id=body.branch_id)
    db.add(territory)
    db.flush()
    db.commit()
    return TerritoryOut(
        id=territory.id, name=territory.name, branch_id=territory.branch_id, active=territory.active
    )
