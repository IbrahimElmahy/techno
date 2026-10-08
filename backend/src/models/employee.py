from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, PCT


class JobTitle(Base):
    __tablename__ = "job_title"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(240), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class Employee(Base):
    __tablename__ = "employee"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    job_title_id: Mapped[int | None] = mapped_column(ForeignKey("job_title.id"), nullable=True,
                                                     index=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("department.id"), nullable=True, index=True
    )
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    national_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    hire_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    salary: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    address: Mapped[str | None] = mapped_column(String(240), nullable=True)
    work_start: Mapped[str | None] = mapped_column(String(20), nullable=True)
    work_end: Mapped[str | None] = mapped_column(String(20), nullable=True)
    collection_commission_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True, unique=True)
    receivable_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("account.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
