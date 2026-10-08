from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Date, DateTime, Enum, ForeignKey, Index, String, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import QTY


class StockCountStatus(str, enum.Enum):
    draft = "draft"
    posted = "posted"
    cancelled = "cancelled"


class StockCountKind(str, enum.Enum):
    full = "full"
    cycle = "cycle"
    spot = "spot"


class StockCount(Base):
    __tablename__ = "stock_count"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    count_date: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[StockCountKind] = mapped_column(
        Enum(StockCountKind), default=StockCountKind.full, nullable=False)
    status: Mapped[StockCountStatus] = mapped_column(
        Enum(StockCountStatus), default=StockCountStatus.draft, nullable=False
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list["StockCountLine"]] = relationship(
        cascade="all, delete-orphan", order_by="StockCountLine.id")


class StockCountLine(Base):
    __tablename__ = "stock_count_line"
    __table_args__ = (
        Index("ix_stock_count_line_count", "count_id"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    count_id: Mapped[int] = mapped_column(ForeignKey("stock_count.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouse.id"), nullable=False)
    book_quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    counted_quantity: Mapped[object | None] = mapped_column(QTY, nullable=True)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
