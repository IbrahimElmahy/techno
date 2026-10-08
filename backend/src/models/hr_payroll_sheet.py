from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class PayrollGroup(Base):
    __tablename__ = "payroll_group"
    __table_args__ = (
        UniqueConstraint("branch_id", "name", name="uq_payroll_group_branch_name"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    columns: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    absence_base: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    absence_divisor: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PayrollGroupMember(Base):
    __tablename__ = "payroll_group_member"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, unique=True
    )
    group_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_group.id"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class PayrollSheetGroup(Base):
    __tablename__ = "payroll_sheet_group"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("payroll_run.id"), nullable=False, index=True)
    group_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    columns: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    absence_base: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    absence_divisor: Mapped[int] = mapped_column(Integer, default=30, nullable=False)


class PayrollSheetRow(Base):
    __tablename__ = "payroll_sheet_row"
    __table_args__ = (
        UniqueConstraint("run_id", "employee_id", name="uq_payroll_sheet_row_employee"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("payroll_run.id"), nullable=False, index=True)
    sheet_group_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_sheet_group.id"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    absent_days: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    absent_days_override: Mapped[object | None] = mapped_column(QTY, nullable=True)
    earnings: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    deductions: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    net: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    no_salary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)


class PayrollSheetCell(Base):
    __tablename__ = "payroll_sheet_cell"
    __table_args__ = (
        UniqueConstraint("row_id", "col_key", name="uq_payroll_sheet_cell"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    row_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_sheet_row.id"), nullable=False, index=True
    )
    col_key: Mapped[str] = mapped_column(String(60), nullable=False)
    computed: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    override: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    source_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
