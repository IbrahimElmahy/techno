"""طلبات البيع والشراء — B9.

An order is what exists *before* the trade: a customer asks for goods, or the company asks a
supplier for them. Nothing has happened yet — no stock has moved, no money is owed, nothing is
reserved. That is the whole point of keeping it separate from the invoice: an order can be
written for stock that has not arrived, and quoted for a customer who may never confirm, without
any of it touching the balances.

The one thing it must not do is turn into two invoices. `converted_invoice_id` is what makes the
conversion a one-way door: once an order names its invoice, a second attempt is refused rather
than quietly doubling the sale.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class OrderKind(str, enum.Enum):
    sale = "sale"          # طلب بيع (عرض سعر / أمر عميل)
    purchase = "purchase"  # طلب شراء (أمر توريد)


class OrderStatus(str, enum.Enum):
    open = "open"            # مفتوح
    converted = "converted"  # اتحوّل لفاتورة
    cancelled = "cancelled"  # ملغي


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
    # When the customer expects it / when the supplier promised it.
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    total: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # The invoice this order became. Set once; a second conversion is refused.
    converted_invoice_id: Mapped[int | None] = mapped_column(nullable=True)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list["TradeOrderLine"]] = relationship(  # noqa: UP037 — SQLAlchemy forward ref
        back_populates="order", cascade="all, delete-orphan"
    )


class TradeOrderLine(Base):
    __tablename__ = "trade_order_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("trade_order.id"), nullable=False,
                                          index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(240), nullable=True)

    order: Mapped[TradeOrder] = relationship(back_populates="lines")
