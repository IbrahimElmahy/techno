from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class Department(Base):
    __tablename__ = "department"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("department.id"), nullable=True, index=True
    )
    manager_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee.id"), nullable=True
    )
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True
    )
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branch.id"), nullable=True, index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    parent: Mapped[Department | None] = relationship(remote_side=[id], backref="children")


class TerminationKind(str, enum.Enum):
    resignation = "resignation"
    dismissal = "dismissal"
    contract_end = "contract_end"
    retirement = "retirement"
    death = "death"


class EmployeeTermination(Base):
    __tablename__ = "employee_termination"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), unique=True, nullable=False, index=True
    )
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    last_working_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    kind: Mapped[TerminationKind] = mapped_column(
        Enum(TerminationKind, native_enum=False, length=16), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    settlement_amount: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
