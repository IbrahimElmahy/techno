from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import FACTOR, MONEY, QTY


class OrderKind(str, enum.Enum):
    sale = "sale"
    purchase = "purchase"


class OrderStatus(str, enum.Enum):
    open = "open"
    converted = "converted"
    cancelled = "cancelled"


class TradeOrder(Base):
    __tablename__ = "trade_order"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    kind: Mapped[OrderKind] = mapped_column(Enum(OrderKind), nullable=False, index=True)
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus), nullable=False, default=OrderStatus.open, index=True
    )
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True,
                                                    index=True)
    order_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    gross: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    variable_discount_pct: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    total: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)

    converted_invoice_id: Mapped[int | None] = mapped_column(nullable=True)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list["TradeOrderLine"]] = relationship(  # noqa: UP037
        back_populates="order", cascade="all, delete-orphan",
        order_by="TradeOrderLine.id",
    )


class TradeOrderLine(Base):
    __tablename__ = "trade_order_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("trade_order.id"), nullable=False,
                                          index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object | None] = mapped_column(FACTOR, nullable=True)
    discount_pct: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(240), nullable=True)

    order: Mapped[TradeOrder] = relationship(back_populates="lines")
