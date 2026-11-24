from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class EfficiencySetting(Base):
    __tablename__ = "efficiency_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    allowed_debt_pct: Mapped[object] = mapped_column(Numeric(5, 2), nullable=False, default=25)
    penalty_per_thousand: Mapped[object] = mapped_column(MONEY, nullable=False, default=20)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class RepCreditAllowance(Base):
    __tablename__ = "rep_credit_allowance"

    rep_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), primary_key=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)


class CustomerMonthlyCredit(Base):
    __tablename__ = "customer_monthly_credit"

    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), primary_key=True)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
