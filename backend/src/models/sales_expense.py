"""مصروفات الفاتورة — an expense carried on a sales invoice.

Two kinds, and the difference is the whole reason this is not one field:

* **billed** (مصروفات) — charged TO the customer. Freight he pays for, loading, delivery. It adds
  to what he owes, so it belongs inside the invoice total and the customer's receivable.
* **operating** (مصروفات تشغيل) — borne BY us on this sale. It does not change what the customer
  pays; it reduces the profit the sale earned.

Folding them into one number would make either the customer's balance or the profit wrong, and
which one is wrong would depend on who typed the invoice.

The account comes from the chart, so a company can post freight, commission and loading to
whichever accounts its accountant already uses rather than to one bucket we invented.
"""
from __future__ import annotations

import enum

from sqlalchemy import Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class ExpenseKind(str, enum.Enum):
    billed = "billed"        # مصروفات — على العميل، بتزيد الصافي
    operating = "operating"  # مصروفات تشغيل — على الشركة، بتقلّل الربح


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
