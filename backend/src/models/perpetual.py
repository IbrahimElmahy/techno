from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK

ROLES = ("raw", "wip", "finished", "cogs", "adjust", "opening")


class InventoryAccount(Base):
    __tablename__ = "inventory_account"
    __table_args__ = (UniqueConstraint("branch_id", "role", name="uq_inventory_account_role"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)


class InventoryPosting(Base):
    __tablename__ = "inventory_posting"
    __table_args__ = (UniqueConstraint("doc_type", "doc_id", name="uq_inventory_posting_doc"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    doc_type: Mapped[str] = mapped_column(String(32), nullable=False)
    doc_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"),
                                                        nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 nullable=False)
