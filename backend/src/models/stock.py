"""Stock as an append-only movement model (T013–T014).

On-hand per (item × location) is DERIVED from immutable movements (no stored balance, SC-002).
Movements are quantity-only (no monetary value — Q4 boundary, FR-008a) and reversible (FR-007/025).
`StockLocator` is a lock anchor for the No-Negative-Stock write check (research R3).
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
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


class StockMovement(Base):
    """Immutable quantity change for an (item × location). On-hand = Σ(in − out)."""

    __tablename__ = "stock_movement"
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_stock_movement_qty_positive"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[StockDirection] = mapped_column(Enum(StockDirection), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # quantity-only, no money
    source_doc_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    source_doc_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reverses_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class StockLocator(Base):
    """Lock anchor per (item × location) for No-Negative-Stock serialization. Stores no quantity."""

    __tablename__ = "stock_locator"
    __table_args__ = (
        UniqueConstraint("item_id", "location_kind", "location_id", name="uq_stock_locator"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class CostingMethod(str, enum.Enum):
    """How a unit of stock is valued (نوع التكلفة، B5).

    `average` is the shipped default and what every existing cost on a document was computed
    with — changing the setting must never rewrite those, only how new valuations are derived.
    FIFO is deliberately absent: it needs per-receipt cost layers, which is a data change, not a
    setting.
    """

    average = "average"              # المتوسط المرجح
    last_purchase = "last_purchase"  # آخر سعر شراء


class StockSetting(Base):
    """Singleton stock settings — currently just the costing method."""

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
    """Raised when code attempts to mutate or delete a posted stock movement."""


def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise StockImmutableError(
        "stock_movement is immutable; post a reversal movement instead (FR-007/025)."
    )


# ORM-level immutability guard (DB-agnostic; MySQL trigger enforces the same in production).
# اتشال — نفس سبب قيد الدفتر: تعديل المستند بيشيل حركته القديمة ويكتب واحدة جديدة.
_ = _block_mutation
