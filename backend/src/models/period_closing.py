from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class PeriodClosingConfig(Base):
    __tablename__ = "period_closing_config"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), unique=True, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=True)


class ClosingProductLine(Base):
    __tablename__ = "closing_product_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    categories: Mapped[list | None] = mapped_column(JSON, nullable=True)
    name_prefixes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    basis: Mapped[str] = mapped_column(String(12), default="cost", nullable=False)
    factor_pct: Mapped[object] = mapped_column(Numeric(7, 3), default=100, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class PeriodClosing(Base):
    __tablename__ = "period_closing"
    __table_args__ = (
        UniqueConstraint("branch_id", "closing_date", name="uq_period_closing_branch_date"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    closing_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="draft", nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=True)
    finalized_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PeriodClosingLine(Base):
    __tablename__ = "period_closing_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    closing_id: Mapped[int] = mapped_column(ForeignKey("period_closing.id"), nullable=False,
                                            index=True)
    section: Mapped[str] = mapped_column(String(32), nullable=False)
    group_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    label: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    quantity: Mapped[object | None] = mapped_column(QTY, nullable=True)
    rate: Mapped[object | None] = mapped_column(Numeric(18, 4), nullable=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    sign: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
