"""Inspection point-items (أصناف المعاينة) — 023.

The fitting types a rep records during a معاينة to compute loyalty points (from «حساب نقاط»),
distinct from the sellable products in the catalog. Points are stored at 4 decimals so the
fractional sixths (1/6, 1/3, …) total cleanly.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class InspectionItemType(Base):
    __tablename__ = "inspection_item_type"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    points: Mapped[object] = mapped_column(Numeric(18, 4), nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
