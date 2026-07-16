"""Ledger core: immutable double-entry (T013–T015).

The ledger is the single source of truth. Every treasury, custody, and customer-account
balance is derived from `ledger_line` — never stored standalone (Constitution VI / FR-026).
Posted entries/lines are immutable; corrections are new linked reversal entries (FR-027/028).
"""
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


class AccountType(str, enum.Enum):
    treasury = "treasury"
    custody = "custody"
    customer_receivable = "customer_receivable"
    # Sales & Inventory (002) extension — same ledger, additive (research R1).
    supplier_payable = "supplier_payable"      # normal credit (mirrors customer_receivable)
    sales_revenue = "sales_revenue"            # normal credit (singleton P&L)
    purchases_expense = "purchases_expense"    # normal debit (singleton P&L)
    # After-Sales Loyalty (003) extension — additive.
    loyalty_expense = "loyalty_expense"        # normal debit (singleton P&L)
    # General Ledger (005) extension — additive.
    opening_balance_equity = "opening_balance_equity"  # normal credit (singleton equity)
    # User-defined chart accounts (groups + postable leaves the user creates).
    user_defined = "user_defined"


class AccountNature(str, enum.Enum):
    """Chart classification (005). Drives the trial-balance sign and the normal side."""

    asset = "asset"
    liability = "liability"
    equity = "equity"
    income = "income"
    expense = "expense"


class Direction(str, enum.Enum):
    debit = "debit"
    credit = "credit"


class Account(Base):
    """A balance-bearing bucket and a node in the chart of accounts (005).

    Balance is derived from its lines. Postable leaves accept journal lines; group nodes
    (is_postable=False) only aggregate their descendants. The seven 001/002/003 system
    accounts live here too, re-homed under standard group headings (research R1/R2).
    """

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType), nullable=False)
    # FK target depends on account_type (custody.id / customer_account.id); NULL for the
    # singleton treasury. Kept as a plain ref to avoid polymorphic FK coupling.
    owner_ref: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    normal_side: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    # --- Chart of accounts columns (005, additive; nullable so legacy rows backfill) ---
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("account.id"), nullable=True, index=True
    )
    code: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    nature: Mapped[AccountNature | None] = mapped_column(Enum(AccountNature), nullable=True)
    is_postable: Mapped[bool] = mapped_column(default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(default=False, nullable=False)

    lines: Mapped[list[LedgerLine]] = relationship(back_populates="account")
    parent: Mapped[Account | None] = relationship(remote_side=[id], backref="children")


class LedgerEntry(Base):
    """Immutable event header. ≥2 lines, Σdebit = Σcredit (enforced in service)."""

    __tablename__ = "ledger_entry"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    entry_type: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    # Accounting/business date (005). User-chosen; the trial balance filters by this, NOT
    # created_at (opening balances are intentionally back-dated). NULL for legacy posts,
    # which fall back to created_at::date.
    entry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    # Originating rep; attribution survives customer reassignment (FR-020a).
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    # Set only on reversal entries; UNIQUE => an entry can be reversed at most once (FR-027).
    reverses_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list[LedgerLine]] = relationship(
        back_populates="entry", cascade="all, save-update"
    )


class LedgerLine(Base):
    """A debit or credit leg of an entry. Immutable once posted."""

    __tablename__ = "ledger_line"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_ledger_line_amount_positive"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("ledger_entry.id"), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False, index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Per-line بيان (005). Set by journal entries; NULL for 001/002/003 posts.
    statement: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Optional analytical cost-center dimension (006). NULL for untagged/legacy posts.
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )

    entry: Mapped[LedgerEntry] = relationship(back_populates="lines")
    account: Mapped[Account] = relationship(back_populates="lines")


class LedgerImmutableError(Exception):
    """Raised when code attempts to mutate or delete a posted ledger row."""


def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise LedgerImmutableError(
        f"{type(target).__name__} is immutable; post a reversal entry instead (FR-027/028)."
    )


# ORM-level immutability guard (DB-agnostic; the MySQL trigger in the Alembic migration
# enforces the same rule at the storage layer for production). Inserts are allowed.
for _model in (LedgerEntry, LedgerLine):
    event.listen(_model, "before_update", _block_mutation, propagate=True)
    event.listen(_model, "before_delete", _block_mutation, propagate=True)

