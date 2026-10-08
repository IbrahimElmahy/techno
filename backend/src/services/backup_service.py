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
        raise ValueError("هذا الملف ليس نسخة احتياطية من النظام.")
    if meta["backup_version"] > BACKUP_VERSION:
        raise ValueError("نسخة من إصدار أحدث للنظام — حدّث التطبيق أولاً.")
    return data


def restore_all(db: Session, data: dict) -> dict[str, int]:
    known = {t.name for t in Base.metadata.sorted_tables}
    missing = [name for name in data if name != "_meta" and name not in known]
    if missing:
        raise ValueError(f"تحتوي النسخة على جداول ليست من النظام: {', '.join(missing[:5])}")

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
    try:
        directory = Path(__file__).resolve().parents[2] / "uploads" / "backups"
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = directory / f"pre-restore-{stamp}.json.gz"
        path.write_bytes(to_gzip(data))
        return str(path)
    except Exception as exc:  # pragma: no cover
        log.info("safety snapshot skipped: %s", exc)
        return None
