"""Audit service (T057). FR-031. Append-only; reads are never logged."""
from __future__ import annotations

from sqlalchemy.orm import Session

from src.models.audit import AuditLogEntry


def record(
    db: Session,
    *,
    action: str,
    actor_user_id: int | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> AuditLogEntry:
    entry = AuditLogEntry(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_json=before,
        after_json=after,
    )
    db.add(entry)
    db.flush()
    return entry
