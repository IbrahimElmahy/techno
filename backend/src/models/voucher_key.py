from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class VoucherKey(Base):
    __tablename__ = "voucher_key"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    debit_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    credit_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    debit_group: Mapped[str | None] = mapped_column(String(40), nullable=True)
    credit_group: Mapped[str | None] = mapped_column(String(40), nullable=True)

    payment_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    family: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)
