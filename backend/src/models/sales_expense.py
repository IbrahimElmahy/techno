from __future__ import annotations

import enum

from sqlalchemy import Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class ExpenseKind(str, enum.Enum):
    billed = "billed"
    operating = "operating"


class SalesInvoiceExpense(Base):
    __tablename__ = "sales_invoice_expense"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoice.id"), nullable=False,
                                            index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    kind: Mapped[ExpenseKind] = mapped_column(Enum(ExpenseKind), nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    description: Mapped[str | None] = mapped_column(String(240), nullable=True)

    invoice = relationship("SalesInvoice", back_populates="expenses")
