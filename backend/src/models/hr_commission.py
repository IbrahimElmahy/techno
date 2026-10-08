from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY

RATE = Numeric(9, 4)


class HrCommissionSetting(Base):
    __tablename__ = "hr_commission_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), unique=True, nullable=False)
    point_value: Mapped[object] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    points_per_coupon: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    factor_divisor: Mapped[object] = mapped_column(Numeric(9, 2), default=600, nullable=False)
    absence_divisor: Mapped[object] = mapped_column(Numeric(9, 2), default=30, nullable=False)
    penalty_sales_pct: Mapped[object] = mapped_column(RATE, default=25, nullable=False)
    penalty_per_thousand: Mapped[object] = mapped_column(RATE, default=20, nullable=False)
    attribute_by_customer_rep: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    pay_coupon_commission: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    apply_min_inspections: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class HrCommissionTeam(Base):
    __tablename__ = "hr_commission_team"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    rate_poly: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_white: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_other: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    split_equally: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    penalty_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    credit_limit: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class HrCommissionTeamUser(Base):
    __tablename__ = "hr_commission_team_user"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_hr_comm_team_user"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)


class HrCommissionTeamMember(Base):
    __tablename__ = "hr_commission_team_member"
    __table_args__ = (
        UniqueConstraint("team_id", "employee_id", name="uq_hr_comm_team_member"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), nullable=False)
    exempt_25: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class HrCommissionSupervisor(Base):
    __tablename__ = "hr_commission_supervisor"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), nullable=False)
    label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    rate_poly: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_white: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_other: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    penalty_rate: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    period_offset: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deduct_absence: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class HrCommissionSupervisorTeam(Base):
    __tablename__ = "hr_commission_supervisor_team"
    __table_args__ = (
        UniqueConstraint("supervisor_id", "team_id", name="uq_hr_comm_supervisor_team"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    supervisor_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_supervisor.id", ondelete="CASCADE"), nullable=False, index=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False)


class HrCommissionTechnician(Base):
    __tablename__ = "hr_commission_technician"
    __table_args__ = (
        UniqueConstraint("branch_id", "employee_id", name="uq_hr_comm_technician"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), nullable=False)
    factor: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    min_inspections: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inspection_rate: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    plumber_rate: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    scope: Mapped[str] = mapped_column(String(8), default="own", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)


class HrCommissionManualCollection(Base):
    __tablename__ = "hr_commission_manual_collection"
    __table_args__ = (
        UniqueConstraint("team_id", "year", "month", name="uq_hr_comm_manual_collection"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    poly: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    white: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    other: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
