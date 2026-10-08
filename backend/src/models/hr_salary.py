from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import PCT


class CommissionBasis(str, enum.Enum):
    sales = "sales"
    collections = "collections"


class EmployeeCommissionRule(Base):
    __tablename__ = "employee_commission_rule"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    basis: Mapped[CommissionBasis] = mapped_column(
        Enum(CommissionBasis, native_enum=False, length=16), nullable=False
    )
    pct: Mapped[object] = mapped_column(PCT, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
