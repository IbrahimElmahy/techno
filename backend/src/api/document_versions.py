from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_AUDIT_READ
from src.core.db import get_db
from src.models.document_version import DocumentVersion
from src.models.user import User

router = APIRouter(tags=["audit"], prefix="/document-versions")


class VersionRow(BaseModel):
    id: int
    version_no: int
    action: str
    actor_user_id: int | None
    actor_name: str | None
    created_at: datetime
    document_number: str | None


class VersionOut(VersionRow):
    entity_type: str
    entity_id: int
    snapshot: dict | list | None
    previous: dict | list | None


def _names(db: Session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return {u.id: (u.full_name or u.username) for u in db.scalars(select(User).where(User.id.in_(ids)))}


@router.get("", response_model=list[VersionRow])
def list_versions(
    entity_type: str,
    entity_id: int,
    current: CurrentUser = Depends(require_capability(CAP_AUDIT_READ)),
    db: Session = Depends(get_db),
) -> list[VersionRow]:
    rows = db.scalars(select(DocumentVersion).where(
        DocumentVersion.entity_type == entity_type, DocumentVersion.entity_id == entity_id)
        .order_by(DocumentVersion.version_no)).all()
    names = _names(db, {r.actor_user_id for r in rows if r.actor_user_id})
    return [VersionRow(id=r.id, version_no=r.version_no, action=r.action,
                       actor_user_id=r.actor_user_id, actor_name=names.get(r.actor_user_id),
                       created_at=r.created_at, document_number=r.document_number) for r in rows]


@router.get("/{version_id}", response_model=VersionOut)
def get_version(
    version_id: int,
    current: CurrentUser = Depends(require_capability(CAP_AUDIT_READ)),
    db: Session = Depends(get_db),
) -> VersionOut:
    r = db.get(DocumentVersion, version_id)
    if r is None:
        raise HTTPException(404, {"code": "not_found", "message": "النسخة مش موجودة"})
    prev = db.scalars(select(DocumentVersion).where(
        DocumentVersion.entity_type == r.entity_type, DocumentVersion.entity_id == r.entity_id,
        DocumentVersion.version_no < r.version_no).order_by(DocumentVersion.version_no.desc())).first()
    names = _names(db, {r.actor_user_id} if r.actor_user_id else set())
    return VersionOut(id=r.id, version_no=r.version_no, action=r.action,
                      actor_user_id=r.actor_user_id, actor_name=names.get(r.actor_user_id),
                      created_at=r.created_at, document_number=r.document_number,
                      entity_type=r.entity_type, entity_id=r.entity_id, snapshot=r.snapshot,
                      previous=prev.snapshot if prev else None)
