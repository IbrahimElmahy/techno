"""مفاتيح السندات — ربط بين حسابين رئيسيين، عشان السند يتعمل بضغطة.

Writing the same voucher forty times a week is forty times choosing the same safe out of a list,
the same account out of the chart, the same payment method. None of that is a decision — it is the
same answer retyped, and every retyping is a chance to pick the wrong one.

A key records the pair once: من أنهي حساب رئيسي لأنهي حساب رئيسي. Pressing it asks only what
actually changes — which customer, how much — and posts through the voucher the pair describes.

**It is a shortcut, not a second mechanism.** The key stores no posting logic: the screen reads it,
fills in what it fixes, and calls the same voucher endpoint anybody would have called by hand. So
the safe's balance guard, the أبيض/بولي split and the rep's custody rules all apply exactly as they
do on the long route — because it IS the long route, with the repeated answers already filled in.

Configured once by whoever owns the chart and shared by everybody: unlike a column preference,
which safe «تحصيل نقدي» hits is a fact about the business, not about the person looking.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class VoucherKey(Base):
    __tablename__ = "voucher_key"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # What the button says. The whole point is that somebody recognises it without reading the
    # accounts underneath, so it is the company's words — «تحصيل نقدي», «إيجار المقر».
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    # الطرفان. Each side is EITHER one account («إيجار المقر») OR a whole group («العملاء»), and
    # exactly one of the two columns carries it.
    #
    # A group has to be expressible because in this chart it is not a row. «العملاء» is 233 loose
    # accounts sharing an account_type and no parent between them — the heading the screens show is
    # derived, not stored. A key limited to real rows could therefore never express «تحصيل نقدي»,
    # which is the single most common voucher there is, and that is the whole feature.
    debit_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    credit_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    # An `AccountType` value — «العملاء» is `customer_receivable`, «الموردين» is `supplier_payable`.
    debit_group: Mapped[str | None] = mapped_column(String(40), nullable=True)
    credit_group: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # What else the key answers in advance. All optional: a key that fixes none of them simply
    # asks for them, which is still faster than finding the screen.
    payment_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    family: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True)
    # Pre-written and still editable at the door — a default, not a lock.
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Keys are arranged by the person who set them up, because the order that helps is the order of
    # the day's work and no rule derives that.
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Retired rather than deleted: a key that stops being used is switched off, and the vouchers it
    # already posted keep pointing at an account pair that still reads.
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)
