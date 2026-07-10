"""Standalone wastage / scrap document (014-production-reporting).

Records material (or product) written off outside a manufacturing order — damage, expiry, spoilage.
Posts one `waste_out` stock movement (quantity-only, no ledger); reversible once, like other docs.
Costed from the item's purchase price for the wastage report.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class WastageDocument(Base):
    __tablename__ = "wastage_document"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouse.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False)   # purchase_price snapshot
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # quantity × unit_cost
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    stock_movement_id: Mapped[int] = mapped_column(ForeignKey("stock_movement.id"), nullable=False)
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("wastage_document.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
