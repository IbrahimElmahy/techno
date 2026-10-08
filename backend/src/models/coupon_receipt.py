from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class CouponReceipt(Base):
    __tablename__ = "coupon_receipt"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    rep_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True,
                                                    index=True)
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    coupon_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    declared_kind: Mapped[str | None] = mapped_column(String(24), nullable=True)
    declared_value: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    customer_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    client_uuid: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True,
                                                    index=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    rejected_serials: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(8), nullable=True)

    lines: Mapped[list["CouponReceiptLine"]] = relationship(  # noqa: UP037
        back_populates="receipt", cascade="all, delete-orphan",
        order_by="CouponReceiptLine.id",
    )


def receipt_counted():
    return CouponReceipt.status.is_(None) | (CouponReceipt.status == "approved")


class CouponReceiptLine(Base):
    __tablename__ = "coupon_receipt_line"
    __table_args__ = (
        UniqueConstraint("coupon_kind", "serial", name="uq_coupon_receipt_kind_serial"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("coupon_receipt.id"), nullable=False,
                                            index=True)
    serial: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    coupon_kind: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    sales_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_invoice.id"), nullable=True
    )
    coupon_issue_id: Mapped[int | None] = mapped_column(
        ForeignKey("coupon_issue.id"), nullable=True, index=True
    )

    receipt: Mapped[CouponReceipt] = relationship(back_populates="lines")
