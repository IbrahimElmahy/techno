from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK


class CouponIssue(Base):
    __tablename__ = "coupon_issue"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"),
                                                    nullable=True, index=True)
    coupon_kind: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    unit_value: Mapped[object | None] = mapped_column(String(24), nullable=True)
    rep_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list["CouponIssueLine"]] = relationship(  # noqa: UP037
        back_populates="issue", cascade="all, delete-orphan",
        order_by="CouponIssueLine.id",
    )


class CouponIssueLine(Base):
    __tablename__ = "coupon_issue_line"
    __table_args__ = (
        UniqueConstraint("coupon_kind", "serial", name="uq_coupon_issue_kind_serial"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("coupon_issue.id"), nullable=False,
                                          index=True)
    serial: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    coupon_kind: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)

    issue: Mapped[CouponIssue] = relationship(back_populates="lines")
