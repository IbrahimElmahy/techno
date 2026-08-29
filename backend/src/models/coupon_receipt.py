"""استلام الكوبونات من العملاء — B-coupons.

A coupon handed back at the door is a piece of paper with a number on it. On its own that number
proves nothing: anyone can write one. What makes it real is that it falls inside the serial range
issued on an actual sales invoice, to an actual customer — which is why the invoice stores that
range, and why receiving one is a lookup rather than a data-entry field.

The receipt is a document, not a flag on the coupon, because a rep collects a handful at once and
the company needs to know who took them in and when. And a serial can only be on one receipt: the
unique constraint is what stops the same coupon being handed in twice at two branches.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class CouponReceipt(Base):
    __tablename__ = "coupon_receipt"

    # (037) الفرع اللي المستند ده بتاعه — عزل بيانات الفروع.
    #
    # بيتاخد من مخزن السطر لو المستند بيحرّك بضاعة، وإلا من فرع اللي كتبه. NULL = مستند
    # اتكتب قبل العزل، وبيتشاف من كل الفروع لحد ما يتعبّى.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    # The rep who physically took the coupons; the actor is whoever posted the document.
    rep_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True,
                                                    index=True)
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    coupon_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # نوع الكوبون وقيمته زي ما المندوب قالهم على الجهاز.
    #
    # The true kind is derivable from each serial's issued range, and the receipt's lines carry the
    # invoice that proves it. This is what the REP declared, kept because he declares it with no
    # signal and the customer is handed a total on the spot — a later reconciliation that disagrees
    # is a finding, and it can only be a finding if what he said was written down.
    declared_kind: Mapped[str | None] = mapped_column(String(24), nullable=True)
    declared_value: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    customer_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Idempotency key from the mobile app: the same queued receipt retried after a dropped
    # connection must land once, not twice.
    client_uuid: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True,
                                                    index=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list["CouponReceiptLine"]] = relationship(  # noqa: UP037 — SQLAlchemy ref
        back_populates="receipt", cascade="all, delete-orphan"
    )


class CouponReceiptLine(Base):
    """One coupon serial, and the invoice whose range it came from."""

    __tablename__ = "coupon_receipt_line"
    __table_args__ = (
        # A coupon is a bearer document — it can be handed in exactly once.
        UniqueConstraint("serial", name="uq_coupon_receipt_serial"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    receipt_id: Mapped[int] = mapped_column(ForeignKey("coupon_receipt.id"), nullable=False,
                                            index=True)
    serial: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    sales_invoice_id: Mapped[int] = mapped_column(ForeignKey("sales_invoice.id"), nullable=False)

    receipt: Mapped[CouponReceipt] = relationship(back_populates="lines")
