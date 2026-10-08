from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class DepreciationMethod(str, enum.Enum):
    straight_line = "straight_line"
    declining_balance = "declining_balance"


class AssetStatus(str, enum.Enum):
    active = "active"
    disposed = "disposed"


class FixedAsset(Base):
    __tablename__ = "fixed_asset"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    acquisition_date: Mapped[date] = mapped_column(Date, nullable=False)
    cost: Mapped[object] = mapped_column(MONEY, nullable=False)
    salvage_value: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    useful_life_months: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[DepreciationMethod] = mapped_column(
        Enum(DepreciationMethod), nullable=False, default=DepreciationMethod.straight_line
    )
    status: Mapped[AssetStatus] = mapped_column(
        Enum(AssetStatus), nullable=False, default=AssetStatus.active, index=True
    )

    asset_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    accumulated_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    expense_account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_center.id"), nullable=True)

    disposal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    disposal_proceeds: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    disposal_gain_loss: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    disposal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )

    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class DepreciationRecord(Base):
    __tablename__ = "depreciation_record"
    __table_args__ = (
        UniqueConstraint("asset_id", "year", "month", name="uq_depreciation_asset_period"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("fixed_asset.id"), nullable=False,
                                          index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
