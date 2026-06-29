"""Stock transfers with source-branch approval (T040). FR-022–024."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import QTY
from src.models.stock import LocationKind


class TransferRoute(str, enum.Enum):
    central_to_branch = "central_to_branch"
    central_to_rep = "central_to_rep"
    rep_to_rep = "rep_to_rep"


class TransferStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    reversed = "reversed"


class StockTransfer(Base):
    __tablename__ = "stock_transfer"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    route: Mapped[TransferRoute] = mapped_column(Enum(TransferRoute), nullable=False)
    source_location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    source_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    dest_location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    dest_location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[TransferStatus] = mapped_column(
        Enum(TransferStatus), default=TransferStatus.pending, nullable=False
    )
    initiated_by: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    out_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
    in_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
