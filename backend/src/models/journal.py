from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class JournalKind(str, enum.Enum):
    sale = "sale"
    purchase = "purchase"
    cash = "cash"
    bank = "bank"
    general = "general"


JOURNAL_KIND_LABEL: dict[str, str] = {
    "sale": "مبيعات",
    "purchase": "مشتريات",
    "cash": "نقدية",
    "bank": "بنك",
    "general": "عام",
}


class Journal(Base):
    __tablename__ = "journal"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=JournalKind.general.value)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    restrict_mode_hash: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class JournalSequence(Base):
    __tablename__ = "journal_sequence"
    __table_args__ = (
        UniqueConstraint("journal_id", "year", name="uq_journal_sequence_journal_year"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    journal_id: Mapped[int] = mapped_column(
        ForeignKey("journal.id"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    last_number: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
