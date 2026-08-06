"""جرد المخازن — the counting cycle: sheet, counted, difference, adjustment (031).

`/stocktake` already answered «what do the books say the stock was on this day». That is not a
stocktake — it is one half of one. The other half is the part the warehouse actually does: print a
sheet, walk the shelves, write what is there, and settle the difference.

The two numbers on a line are kept apart on purpose. `book_quantity` is a snapshot from the moment
the sheet was opened, so the counter is compared against what they were told; the adjustment at
posting is computed against CURRENT stock instead, so a sale that happened during the count is not
counted twice. Merging them into one «difference» column would make one of those two wrong.
"""
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
    draft = "draft"        # sheet open, being counted
    posted = "posted"      # differences settled into stock
    cancelled = "cancelled"


class StockCountKind(str, enum.Enum):
    """نوع الجرد — واللي بيفرق بينهم حاجة واحدة: مين اللي بيدخل ورقة العد.

    Three kinds, one document. After the sheet is generated they behave identically — count,
    difference, post — which is the point: three near-identical screens would each drift, and an
    improvement to one would have to be made three times.

    * `full` — كل صنف ليه رصيد في المخزن. The annual count, where the shelves are closed.
    * `cycle` — دفعة بالتناوب, oldest-counted first. The one most businesses actually live on,
      because it never stops the shop.
    * `spot` — أصناف بعينها, named by whoever is suspicious of them.
    """

    full = "full"
    cycle = "cycle"
    spot = "spot"


class StockCount(Base):
    """One counting session over one warehouse, or over all of them (جرد عام)."""

    __tablename__ = "stock_count"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    # NULL means every warehouse — «جرد عام المخازن», which is their own menu entry and the same
    # document with a wider net rather than a second kind of count.
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    count_date: Mapped[date] = mapped_column(Date, nullable=False)
    # (031) Which of the three generated this sheet. Recorded rather than inferred: «ليه الصنف ده
    # مش في الجردة؟» is answerable from the kind, and a cycle count that looks like a failed full
    # count is how people stop trusting the numbers.
    kind: Mapped[StockCountKind] = mapped_column(
        Enum(StockCountKind), default=StockCountKind.full, nullable=False)
    status: Mapped[StockCountStatus] = mapped_column(
        Enum(StockCountStatus), default=StockCountStatus.draft, nullable=False
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lines: Mapped[list["StockCountLine"]] = relationship(cascade="all, delete-orphan")


class StockCountLine(Base):
    """One item at one warehouse: what the books said, and what was found."""

    __tablename__ = "stock_count_line"
    __table_args__ = (
        Index("ix_stock_count_line_count", "count_id"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    count_id: Mapped[int] = mapped_column(ForeignKey("stock_count.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouse.id"), nullable=False)
    # What the books said when the sheet was opened — the figure the counter is checked against.
    book_quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # NULL until somebody writes a number. Zero is a real count («the shelf is empty») and must not
    # be confused with «nobody got to this line», which is why this is nullable rather than 0.
    counted_quantity: Mapped[object | None] = mapped_column(QTY, nullable=True)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
