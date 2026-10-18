from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class ExpenseBill(Base):
    __tablename__ = "expense_bill"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    bill_date: Mapped[date] = mapped_column(Date, nullable=False)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True,
                                                    index=True)
    creditor_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    total: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    treasury_id: Mapped[int | None] = mapped_column(ForeignKey("treasury.id"), nullable=True)
    cash_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                        nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 nullable=False)

    lines: Mapped[list["ExpenseBillLine"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan", order_by="ExpenseBillLine.id")


class ExpenseBillLine(Base):
    __tablename__ = "expense_bill_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("expense_bill.id"), nullable=False,
                                         index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    description: Mapped[str | None] = mapped_column(String(240), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_center.id"),
                                                       nullable=True)

    bill: Mapped[ExpenseBill] = relationship(back_populates="lines")
