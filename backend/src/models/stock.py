from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import QTY


class LocationKind(str, enum.Enum):
    warehouse = "warehouse"
    custody = "custody"


class StockDirection(str, enum.Enum):
    in_ = "in"
    out = "out"


from src.lib.stock_docs import StockDoc  # noqa: E402,F401


class StockMovement(Base):
    __tablename__ = "stock_movement"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_stock_movement_qty_positive"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[StockDirection] = mapped_column(Enum(StockDirection), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    source_doc_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    source_doc_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reverses_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    movement_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)


class StockLocator(Base):
    __tablename__ = "stock_locator"
    __table_args__ = (
        UniqueConstraint("item_id", "location_kind", "location_id", name="uq_stock_locator"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class CostingMethod(str, enum.Enum):
    average = "average"
    last_purchase = "last_purchase"


class StockSetting(Base):
    __tablename__ = "stock_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    costing_method: Mapped[CostingMethod] = mapped_column(
        Enum(CostingMethod), default=CostingMethod.average, nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class StockImmutableError(Exception):
    pass


def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise StockImmutableError(
        "stock_movement is immutable; post a reversal movement instead (FR-007/025)."
    )


_ = _block_mutation
