"""Customer & CustomerAccount models (T045–T046).

FR-018/018a/019/020/020a/021/023. Stable system-generated `code` identity; phone captured
but not unique. Owned by exactly one rep + one territory at a time (reassignable). No loyalty
column/table — loyalty is owned by the After-Sales spec (FR-022, constitution v1.1.2).
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import PCT
from src.models.catalog import PriceTier


class CustomerType(str, enum.Enum):
    """Default customer types. The column is a free string (013) so admins can add their own
    types from Settings; these are only the seeded defaults. No business logic branches on it."""

    trader = "trader"
    plumber = "plumber"
    other = "other"


class Customer(Base):
    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    # Free string (was Enum) — admin-configurable via lookups; not tied to any logic.
    customer_type: Mapped[str] = mapped_column(String(32), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)  # not unique (FR-018a)
    # (v4) detailed address: governorate + markaz/district + free text. Extra phone numbers live in
    # `contact_phone` (owner_type='customer'). `territory_id` stays the rep's sales territory.
    governorate_id: Mapped[int | None] = mapped_column(ForeignKey("governorate.id"), nullable=True)
    markaz: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(String(240), nullable=True)
    rep_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    territory_id: Mapped[int] = mapped_column(ForeignKey("territory.id"), nullable=False)
    # Default sale price tier (007); NULL resolves to the consumer tier.
    default_price_tier: Mapped[PriceTier | None] = mapped_column(Enum(PriceTier), nullable=True)
    # ---- card fields read off their العملاء form (031) ----
    # The branch the customer belongs to. Nullable: it is the first column on their list, but an
    # existing customer recorded before the field existed is not invalid for lacking one.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    email: Mapped[str | None] = mapped_column(String(160), nullable=True)
    tax_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    commercial_register: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # A standing allowance and VAT rate for this customer. NULL is not 0: NULL means "nothing
    # agreed, use whatever the line/item says", while 0 means "agreed, and it is zero" — and a
    # customer who negotiated 0% is a different fact from one nobody has negotiated with.
    discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    vat_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    # (031) المخزن اللي مرتجعات العميل ده بترجع فيه.
    #
    # Learned, not configured: the first return written for him remembers the store it went into,
    # and every later one opens on it. A customer's goods come back to the same place — the branch
    # that serves him — and making somebody pick it every time is asking a question whose answer
    # has not changed since the last return.
    #
    # NULL means «he has never had one», which is a different thing from «he has no preference».
    default_return_warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouse.id"), nullable=True)
    # نقدي — a walk-in who pays on the spot rather than running an account.
    is_cash: Mapped[bool] = mapped_column(default=False, nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # The customer's ORIGINAL, family-less account. Deliberately scoped to `family IS NULL` rather
    # than «whichever row comes first»: every existing caller means «this customer's account», and
    # once a customer holds two, an unscoped `uselist=False` would answer with an arbitrary one of
    # them — silently, and differently between runs.
    account: Mapped[CustomerAccount] = relationship(
        back_populates="customer", uselist=False,
        primaryjoin="and_(Customer.id == CustomerAccount.customer_id, "
                    "CustomerAccount.family.is_(None))",
        viewonly=True,
    )
    # Every account this customer holds, family ones included. New code asks for this.
    accounts: Mapped[list[CustomerAccount]] = relationship(
        back_populates="customer",
        primaryjoin="Customer.id == CustomerAccount.customer_id",
        viewonly=True,
    )


class CustomerAccount(Base):
    """Receivables / ذمم. Balance is derived from the linked ledger account (FR-021/026).

    (031) A customer may hold MORE THAN ONE of these — one per product family.

    The client sells two lines, «أبيض» and «بولي», at different commissions, and their old system
    modelled that by opening the same person twice: «محمد عامر» and «تكنو محمد عامر». Two customers
    for one man means his address is entered twice, his phone is entered twice, and «هو مديون
    بكام؟» has two answers and no way to add them up.

    So the person is ONE customer and the split moves down here, where it belongs: a receivable
    account per family, each with its own commission, and the customer's balance is their sum.

    `family` is NULL on an account that predates the split, and NULL is a real value here — it
    means «this customer's one account», which is what every customer had until now. That is what
    keeps `primary_account()` and every existing query answering exactly as before.
    """

    __tablename__ = "customer_account"
    __table_args__ = (
        # One account per family per customer. Replaces the old UNIQUE on `customer_id` alone —
        # that constraint WAS the reason the client had to open a second customer to get a second
        # account. NULL is not compared by UNIQUE in SQL, so legacy rows are unaffected.
        UniqueConstraint("customer_id", "family", name="uq_customer_account_family"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customer.id"), nullable=False, index=True
    )
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    # Which product line this account is for — a value from the `customer_account_family` lookup,
    # NOT an enum: the client may open a third line, and that should be an admin adding a row
    # rather than a migration.
    family: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # (031) The commission earned on this family. Nullable and left empty on purpose: NULL is
    # «no rate agreed for this line» and 0 is «agreed, and it is nothing» — the same distinction
    # the customer's discount makes, and for the same reason.
    commission_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    customer: Mapped[Customer] = relationship(
        back_populates="accounts",
        primaryjoin="Customer.id == CustomerAccount.customer_id",
        viewonly=True,
    )
    account: Mapped[object] = relationship("Account")
