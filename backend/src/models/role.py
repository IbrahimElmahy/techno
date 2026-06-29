"""Role model (T024). The six constitution roles (FR-005)."""
from __future__ import annotations

import enum

from sqlalchemy import Enum
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class RoleName(str, enum.Enum):
    system_admin = "system_admin"
    branch_manager = "branch_manager"
    purchasing_manager = "purchasing_manager"
    sales_manager = "sales_manager"
    after_sales_staff = "after_sales_staff"
    sales_rep = "sales_rep"
    # General Ledger (005) — manages the chart, posts/reverses journals, reads the trial balance.
    accountant = "accountant"


class Role(Base):
    __tablename__ = "role"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[RoleName] = mapped_column(Enum(RoleName), unique=True, nullable=False)
