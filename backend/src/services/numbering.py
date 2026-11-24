from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.org import Branch

BRANCH_TAGS = {"أكتوبر": "OC", "العلياء": "AL", "السادات": "FC"}


def next_document_number(db: Session, model, prefix: str, *, where=None, column=None,
                         width: int = 6) -> str:
    column = column if column is not None else model.document_number
    stmt = select(column).where(column.like(f"{prefix}-%"))
    if where is not None:
        stmt = stmt.where(where)

    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    highest = 0
    for (value,) in db.execute(stmt):
        m = pattern.match(value or "")
        if m:
            highest = max(highest, int(m.group(1)))
    return f"{prefix}-{highest + 1:0{width}d}"


def next_branch_number(db: Session, model, prefix: str, branch_id: int | None) -> str:
    name = db.scalar(select(Branch.name).where(Branch.id == branch_id)) if branch_id else None
    tag = BRANCH_TAGS.get((name or "").replace("فرع", "").strip())
    return next_document_number(db, model, f"{tag}-{prefix}" if tag else prefix)
