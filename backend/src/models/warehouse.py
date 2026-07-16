"""Warehouse & Custody models (T038–T039). FR-015, FR-016, FR-017, FR-025.

Warehouses reference the shared catalog only conceptually (no stock rows here).
Exactly one custody per holder (rep or warehouse); cash + goods tracked via the ledger.
"""
from __future__ import annotations

import enum

from sqlalchemy import Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK


class WarehouseType(str, enum.Enum):
    central = "central"
    branch = "branch"


class HolderType(str, enum.Enum):
    rep = "rep"
    warehouse = "warehouse"


class Warehouse(Base):
    __tablename__ = "warehouse"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    warehouse_type: Mapped[WarehouseType] = mapped_column(Enum(WarehouseType), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)


class Custody(Base):
    """Exactly one custody per holder (FR-025): UNIQUE on rep_id and on warehouse_id."""

    __tablename__ = "custody"
    __table_args__ = (
        UniqueConstraint("rep_id", name="uq_custody_rep"),
        UniqueConstraint("warehouse_id", name="uq_custody_warehouse"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    holder_type: Mapped[HolderType] = mapped_column(Enum(HolderType), nullable=False)
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    # The ledger account holding this custody's cash + goods positions (FR-026).
    account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    account: Mapped[object] = relationship("Account")
