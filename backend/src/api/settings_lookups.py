"""Settings → configurable dropdown lists (lookups) router — 013-settings-lookups.

Reads are open to any authenticated user (dropdowns everywhere need them); writes require
`settings.write` (System Admin / Branch Manager).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user, require_capability
from src.auth.rbac import CAP_SETTINGS_WRITE
from src.core.db import get_db
from src.services import lookup_service
from src.services.lookup_service import LookupError

router = APIRouter(tags=["settings"], prefix="/settings/lookups")


class OptionOut(BaseModel):
    id: int
    category: str
    value: str
    label: str
    sort_order: int
    active: bool
    is_system: bool


class OptionCreate(BaseModel):
    category: str
    value: str
    label: str
    sort_order: int | None = None


class OptionUpdate(BaseModel):
    label: str | None = None
    sort_order: int | None = None
    active: bool | None = None


def _out(o) -> OptionOut:
    return OptionOut(id=o.id, category=o.category, value=o.value, label=o.label,
                     sort_order=o.sort_order, active=o.active, is_system=o.is_system)


@router.get("/categories")
def list_categories(
    _: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return lookup_service.categories()


@router.get("", response_model=list[OptionOut])
def list_options(
    category: str,
    active_only: bool = False,
    _: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OptionOut]:
    opts = lookup_service.list_options(db, category, active_only=active_only)
    db.commit()  # persist any lazy-seeded defaults
    return [_out(o) for o in opts]


@router.post("", response_model=OptionOut, status_code=status.HTTP_201_CREATED)
def create_option(
    body: OptionCreate,
    _: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> OptionOut:
    try:
        opt = lookup_service.create_option(
            db, category=body.category, value=body.value, label=body.label,
            sort_order=body.sort_order)
    except LookupError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "lookup_invalid", "message": str(exc)})
    db.commit()
    return _out(opt)


@router.patch("/{option_id}", response_model=OptionOut)
def update_option(
    option_id: int,
    body: OptionUpdate,
    _: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> OptionOut:
    try:
        opt = lookup_service.update_option(
            db, option_id=option_id, label=body.label, sort_order=body.sort_order,
            active=body.active)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": str(exc)})
    db.commit()
    return _out(opt)


@router.delete("/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_option(
    option_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        lookup_service.delete_option(db, option_id=option_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "lookup_invalid", "message": str(exc)})
    db.commit()
