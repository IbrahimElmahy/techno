from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class A5ItemLink(Base):
    __tablename__ = "a5_item_link"
    __table_args__ = (
        UniqueConstraint("prefix", "a5_code", "a5_name", name="uq_a5_item_link"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    prefix: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    a5_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    a5_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    a5_item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
