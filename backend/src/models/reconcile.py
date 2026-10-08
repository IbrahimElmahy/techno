from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY

NUMBER_WIDTH = 5
NUMBER_PREFIX = "A"


def format_number(seq: int) -> str:
    return f"{NUMBER_PREFIX}{seq:0{NUMBER_WIDTH}d}"


class FullReconcile(Base):
    __tablename__ = "full_reconcile"
    __table_args__ = (UniqueConstraint("number", name="uq_full_reconcile_number"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    number: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)


class PartialReconcile(Base):
    __tablename__ = "partial_reconcile"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    debit_line_id: Mapped[int] = mapped_column(
        ForeignKey("ledger_line.id"), nullable=False, index=True
    )
    credit_line_id: Mapped[int] = mapped_column(
        ForeignKey("ledger_line.id"), nullable=False, index=True
    )
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    full_reconcile_id: Mapped[int | None] = mapped_column(
        ForeignKey("full_reconcile.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
