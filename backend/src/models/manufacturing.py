"""Manufacturing — two independent ops (T027). FR-013–016. No linkage, no BOM, no money."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import QTY
from src.models.stock import LocationKind


class ManufactureOpType(str, enum.Enum):
    consume = "consume"
    produce = "produce"


class ManufacturingOp(Base):
    __tablename__ = "manufacturing_op"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    op_type: Mapped[ManufactureOpType] = mapped_column(Enum(ManufactureOpType), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    stock_movement_id: Mapped[int] = mapped_column(ForeignKey("stock_movement.id"), nullable=False)
    # Set when this op is itself a reversal of another op (reverse-once at op level).
    reverses_op_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturing_op.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
