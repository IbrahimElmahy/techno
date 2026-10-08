from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class CouponCustody(Base):
    __tablename__ = "coupon_custody"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    rep_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)
    coupon_kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    serial_from: Mapped[str] = mapped_column(String(24), nullable=False)
    serial_to: Mapped[str] = mapped_column(String(24), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    doc_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class CouponCustodySerial(Base):
    __tablename__ = "coupon_custody_serial"
    __table_args__ = (
        UniqueConstraint("coupon_kind", "serial", name="uq_coupon_custody_kind_serial"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    coupon_kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    serial: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    rep_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    custody_id: Mapped[int] = mapped_column(ForeignKey("coupon_custody.id"), nullable=False,
                                            index=True)
    return_id: Mapped[int | None] = mapped_column(ForeignKey("coupon_custody.id"),
                                                  nullable=True, index=True)
    given_invoice_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    given_issue_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
