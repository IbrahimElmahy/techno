from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class LookupOption(Base):
    __tablename__ = "lookup_option"
    __table_args__ = (
        UniqueConstraint("category", "value", name="uq_lookup_category_value"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parent_value: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hidden_in_price_sheet: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
