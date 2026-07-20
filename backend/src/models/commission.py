"""Rep commission rules — 021-tax-commissions.

One row per rep, plus an optional company-wide default (`rep_user_id` NULL). Commission is
reported, never auto-posted: the manager pays it with an expense voucher after review.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.models.sales import PCT


class CommissionRule(Base):
    __tablename__ = "commission_rule"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # NULL = the default applied to every rep without a rule of his own.
    rep_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), unique=True,
                                                    nullable=True)
    rate_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    basis: Mapped[str] = mapped_column(String(12), nullable=False, default="collection")
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
