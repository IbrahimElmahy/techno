"""Full-database backup and restore.

The whole ledger lives in one MySQL database with no dump mechanism anywhere — one bad
deploy and the books are gone. This service is the answer: every table serialized to one
gzipped JSON file (portable across SQLite dev / MySQL prod), and a restore that swaps the
contents back inside a single transaction.

Restore writes a safety snapshot of the CURRENT state to disk first (best-effort), so even
a restore-done-wrong has an undo.
"""
from __future__ import annotations

import gzip
import json
import logging
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.orm import Session

from src.core.db import Base

BACKUP_VERSION = 1

log = logging.getLogger("uvicorn.error")


def _json_default(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    return str(v)


def export_all(db: Session) -> dict:
    """Every table → {table: [row, …]} in dependency order (parents first)."""
    data: dict = {
        "_meta": {
            "app": "techno",
            "backup_version": BACKUP_VERSION,
            "exported_at": datetime.now().isoformat(timespec="seconds"),
        }
    }
    for table in Base.metadata.sorted_tables:
        rows = db.execute(sa.select(table)).mappings().all()
        data[table.name] = [dict(r) for r in rows]
    return data


def to_gzip(data: dict) -> bytes:
    return gzip.compress(json.dumps(data, default=_json_default, ensure_ascii=False).encode("utf-8"))


def from_gzip(raw: bytes) -> dict:
    data = json.loads(gzip.decompress(raw))
    meta = data.get("_meta") or {}
    if meta.get("app") != "techno" or "backup_version" not in meta:
        raise ValueError("الملف ده مش نسخة احتياطية من النظام.")
    if meta["backup_version"] > BACKUP_VERSION:
        raise ValueError("نسخة أحدث من النظام — حدّث التطبيق الأول.")
    return data


def restore_all(db: Session, data: dict) -> dict[str, int]:
    """Wipe every table (children first) then reload (parents first), one transaction.

    The caller owns commit/rollback; counts per table are returned for the summary.
    """
    known = {t.name for t in Base.metadata.sorted_tables}
    missing = [name for name in data if name != "_meta" and name not in known]
    if missing:
        raise ValueError(f"النسخة فيها جداول مش من النظام: {', '.join(missing[:5])}")

    counts: dict[str, int] = {}
    for table in reversed(Base.metadata.sorted_tables):
        if table.name in data:
            db.execute(table.delete())
    for table in Base.metadata.sorted_tables:
        rows = data.get(table.name) or []
        if not rows:
            continue
        cols = {c.name for c in table.columns}
        clean = [{k: v for k, v in row.items() if k in cols} for row in rows]
        db.execute(table.insert(), clean)
        counts[table.name] = len(clean)
    return counts


def save_safety_snapshot(data: dict) -> str | None:
    """Pre-restore copy of the CURRENT database, on disk. Best-effort — never blocks."""
    try:
        directory = Path(__file__).resolve().parents[2] / "uploads" / "backups"
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = directory / f"pre-restore-{stamp}.json.gz"
        path.write_bytes(to_gzip(data))
        return str(path)
    except Exception as exc:  # pragma: no cover — disk issues must not block a restore
        log.info("safety snapshot skipped: %s", exc)
        return None
