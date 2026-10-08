from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class PermitKind(str, enum.Enum):
    receipt = "receipt"
    issue = "issue"
    opening = "opening"


class StockPermit(Base):
    __tablename__ = "stock_permit"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    kind: Mapped[PermitKind] = mapped_column(Enum(PermitKind), nullable=False, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouse.id"), nullable=False,
                                              index=True)
    permit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(
        String(40), nullable=True, index=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_permit.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list["StockPermitLine"]] = relationship(  # noqa: UP037
        back_populates="permit", cascade="all, delete-orphan",
        order_by="StockPermitLine.id",
    )


class StockPermitLine(Base):
    __tablename__ = "stock_permit_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("stock_permit.id"), nullable=False,
                                           index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    line_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    permit: Mapped[StockPermit] = relationship(back_populates="lines")
