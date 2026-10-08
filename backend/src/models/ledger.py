from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    String,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY
from src.models.journal import Journal  # noqa: F401


class AccountType(str, enum.Enum):
    treasury = "treasury"
    custody = "custody"
    customer_receivable = "customer_receivable"
    supplier_payable = "supplier_payable"
    sales_revenue = "sales_revenue"
    purchases_expense = "purchases_expense"
    loyalty_expense = "loyalty_expense"
    opening_balance_equity = "opening_balance_equity"
    user_defined = "user_defined"


class AccountNature(str, enum.Enum):
    asset = "asset"
    liability = "liability"
    equity = "equity"
    income = "income"
    expense = "expense"


class Direction(str, enum.Enum):
    debit = "debit"
    credit = "credit"


class EntryState(str, enum.Enum):
    draft = "draft"
    posted = "posted"
    cancelled = "cancelled"


class MoveType(str, enum.Enum):
    entry = "entry"
    out_invoice = "out_invoice"
    out_refund = "out_refund"
    in_invoice = "in_invoice"
    in_refund = "in_refund"


class PartnerKind(str, enum.Enum):
    customer = "customer"
    supplier = "supplier"
    employee = "employee"


class Account(Base):
    __tablename__ = "account"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType), nullable=False)
    owner_ref: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    normal_side: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branch.id"), nullable=True, index=True
    )

    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("account.id"), nullable=True, index=True
    )
    code: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    nature: Mapped[AccountNature | None] = mapped_column(Enum(AccountNature), nullable=True)
    is_postable: Mapped[bool] = mapped_column(default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(default=False, nullable=False)
    reconcilable: Mapped[bool] = mapped_column(default=False, nullable=False)
    appears_in: Mapped[str | None] = mapped_column(String(24), nullable=True)
    main_level: Mapped[str | None] = mapped_column(String(80), nullable=True)

    lines: Mapped[list[LedgerLine]] = relationship(back_populates="account")
    parent: Mapped[Account | None] = relationship(remote_side=[id], backref="children")


class LedgerEntry(Base):
    __tablename__ = "ledger_entry"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    entry_type: Mapped[str] = mapped_column(String(40), nullable=False)
    journal_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal.id"), nullable=True, index=True
    )
    state: Mapped[str] = mapped_column(
        String(12), nullable=False, default=EntryState.posted.value
    )
    number: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    move_type: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    partner_kind: Mapped[str | None] = mapped_column(String(12), nullable=True)
    partner_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    invoice_date_due: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    payment_state: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    secure_sequence_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    inalterable_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    entry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    external_ref: Mapped[str | None] = mapped_column(
        String(60), nullable=True, index=True
    )
    reverses_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list[LedgerLine]] = relationship(
        back_populates="entry", cascade="all, save-update",
        order_by="LedgerLine.id",
    )
    journal: Mapped["Journal | None"] = relationship("Journal", lazy="joined")


class LedgerLine(Base):
    __tablename__ = "ledger_line"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_ledger_line_amount_positive"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("ledger_entry.id"), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False, index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    statement: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    partner_kind: Mapped[str | None] = mapped_column(String(12), nullable=True)
    partner_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    date_maturity: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    amount_residual: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    full_reconcile_id: Mapped[int | None] = mapped_column(
        ForeignKey("full_reconcile.id"), nullable=True, index=True
    )

    entry: Mapped[LedgerEntry] = relationship(back_populates="lines")
    account: Mapped[Account] = relationship(back_populates="lines")
    distributions: Mapped[list["LedgerLineDistribution"]] = relationship(  # noqa: F821
        "LedgerLineDistribution",
        primaryjoin="LedgerLine.id == foreign(LedgerLineDistribution.line_id)",
        lazy="selectin", viewonly=True,
    )


class LedgerImmutableError(Exception):
    pass


def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise LedgerImmutableError(
        f"{type(target).__name__} is immutable; post a reversal entry instead (FR-027/028)."
    )


_ = _block_mutation

