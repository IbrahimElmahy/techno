"""إذن إضافة / إذن صرف — stock in and out without a trade (B5).

Not every movement of goods is a purchase or a sale. Stock is found in a count, comes back from a
workshop, goes out as a sample or a workshop issue. Recording those as invoices would put movements
that were never traded into the sales figures and the profit; a permit is the honest document for
them: quantity and a cost for the stock reports, nothing on the sales ledger.

Multi-line on purpose — a storekeeper issues a list, not one item at a time — and reversed rather
than edited, once, like every other posted document.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class PermitKind(str, enum.Enum):
    receipt = "receipt"  # إذن إضافة — stock in
    issue = "issue"      # إذن صرف — stock out
    # بضاعة أول المدة — the stock the company already had on the day it started using the system.
    # Mechanically a receipt: same direction, same typed cost. It is a kind of its own because the
    # label is the whole point — «إمتى بدأنا؟» has to be answerable, a stock-as-of-date report for a
    # day before go-live must not show goods the system was not yet keeping, and opening stock must
    # never be read as a movement that happened.
    opening = "opening"


class StockPermit(Base):
    __tablename__ = "stock_permit"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    kind: Mapped[PermitKind] = mapped_column(Enum(PermitKind), nullable=False, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouse.id"), nullable=False,
                                              index=True)
    # The day it happened, which is not always the day it was typed.
    permit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_permit.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list["StockPermitLine"]] = relationship(  # noqa: UP037 (SQLAlchemy needs the forward ref)
        back_populates="permit", cascade="all, delete-orphan"
    )


class StockPermitLine(Base):
    __tablename__ = "stock_permit_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    permit_id: Mapped[int] = mapped_column(ForeignKey("stock_permit.id"), nullable=False,
                                           index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # Typed on a receipt (only the person adding the stock knows what it cost); derived from the
    # costing method on an issue, because nobody invents a cost for stock going out.
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    line_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
    # (011) الدفعة اللي السطر ده حطّ فيها أو خد منها — للأصناف اللي ليها صلاحية بس.
    #
    # A permit moved stock and left the expiry lots untouched, which breaks the invariant the
    # whole perishable feature rests on: Σ(batch quantity) == derived on-hand at every location.
    # Recording the lot here is what lets the REVERSAL undo the same lot instead of guessing a
    # date — the same reason a sale writes down which lots FEFO drew from.
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    permit: Mapped[StockPermit] = relationship(back_populates="lines")
