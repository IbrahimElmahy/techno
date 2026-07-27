"""الأصول الثابتة والإهلاك — B6.

An asset is paid for once and consumed over years, so its cost belongs to the months that used
it, not to the month it was bought. This is the register that makes that spreading possible: what
it cost, what is expected to survive (salvage), over how long, by which method, and against which
three accounts.

`DepreciationRecord` is one row per asset per month, and its unique key is the reason a run can be
clicked twice safely — the second click finds the row and does nothing. Reversing a month DELETES
those rows rather than flagging them, so the constraint keeps meaning exactly "one live booking
per asset per month"; the history is not lost, because the ledger keeps both the original entry
and its reversal, immutably.
"""
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
    straight_line = "straight_line"          # القسط الثابت
    declining_balance = "declining_balance"  # القسط المتناقص


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
    # What the asset is expected to still be worth at the end — it is never depreciated away.
    salvage_value: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    useful_life_months: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[DepreciationMethod] = mapped_column(
        Enum(DepreciationMethod), nullable=False, default=DepreciationMethod.straight_line
    )
    status: Mapped[AssetStatus] = mapped_column(
        Enum(AssetStatus), nullable=False, default=AssetStatus.active, index=True
    )

    # The three accounts every depreciation entry touches. Resolved when the asset is registered
    # rather than at run time, so a run can never silently post somewhere unexpected.
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
    """One asset, one month, one amount — and the ledger entry that booked it."""

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
