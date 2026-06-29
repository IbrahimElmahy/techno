"""Database engine, session, and declarative Base (T005)."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import BigInteger, Integer, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.core.config import settings

# BIGINT in production (MySQL/MariaDB); INTEGER on SQLite so autoincrement works in tests.
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


class Base(DeclarativeBase):
    """Declarative base — the single source of truth for the schema."""


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        # Needed for SQLite when shared across threads (tests, single-process dev).
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True}


engine = create_engine(settings.database_url, **_engine_kwargs(settings.database_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
