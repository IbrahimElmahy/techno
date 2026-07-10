"""Configurable dropdown option lists (lookups) — 013-settings-lookups.

Every admin-configurable dropdown reads its options from `lookup_option`, keyed by `category`.
Two kinds of category (see src/services/lookup_registry.py):
- **system** (enum-bound): options are seeded from a backend Enum; the admin may relabel, reorder,
  and hide them, but MUST NOT add arbitrary new `value`s (business logic switches on the enum) —
  enforced in the service. `is_system=True` on those rows.
- **custom** (free lists, e.g. units of measure): full add/edit/remove.
"""
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
    value: Mapped[str] = mapped_column(String(64), nullable=False)   # the code business logic uses
    label: Mapped[str] = mapped_column(String(160), nullable=False)  # Arabic display text
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # True for options seeded from a backend Enum — value is locked, row cannot be deleted.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
