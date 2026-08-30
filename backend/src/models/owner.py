"""المالك — صاحب البيت اللي اتعملت فيه المعاينة.

مش عميل. الشركة مابتبيعش له ومابتحاسبهوش ومابتاخدش منه كوبونات: هو الطرف اللي
الفني راح عنده. كان متسجّل في كشف العملاء لأن نظامهم القديم ماكانش عنده مكان تاني
يحطّه فيه — والنتيجة إن تلتين كشف العملاء بقوا مش عملاء.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class Owner(Base):
    """صاحب البيت في المعاينة (خدمات ما بعد البيع)."""

    __tablename__ = "owner"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(160), index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    national_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    governorate_id: Mapped[int | None] = mapped_column(ForeignKey("governorate.id"), nullable=True)
    markaz: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    floor_number: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)

    territory_id: Mapped[int | None] = mapped_column(
        ForeignKey("territory.id"), nullable=True, index=True
    )
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branch.id"), nullable=True, index=True
    )
    service_rep_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id"), nullable=True, index=True
    )  # مندوب خدمة العملاء

    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
