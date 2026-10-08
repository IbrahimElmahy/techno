from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class AccountingSetting(Base):
    __tablename__ = "accounting_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    fiscalyear_lock_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_lock_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_terms_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0,
                                                    server_default="0")
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=True
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id"), nullable=True
    )
