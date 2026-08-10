"""Ledger service (T017–T019): post_entry, reverse_entry, balance_of.

The only write paths into the ledger. No update/delete — corrections are reversals (FR-027/028).
All balances are derived here from `ledger_line` (FR-026); nothing is stored standalone.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine


class LedgerError(Exception):
    """Invalid ledger operation (unbalanced, too few lines, double reversal, ...)."""


@dataclass(frozen=True)
class LineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None  # per-line بيان (005); ignored by 001/002/003 callers
    cost_center_id: int | None = None  # optional analytical dimension (006)


def _validate_lines(lines: list[LineInput]) -> None:
    if len(lines) < 2:
        raise LedgerError("القيد لازم يكون فيه سطرين على الأقل.")
    debit = sum((to_money(l.amount) for l in lines if l.direction == Direction.debit), ZERO)
    credit = sum((to_money(l.amount) for l in lines if l.direction == Direction.credit), ZERO)
    if any(to_money(l.amount) <= ZERO for l in lines):
        raise LedgerError("كل سطر لازم يكون مبلغه أكبر من صفر.")
    if debit != credit:
        raise LedgerError(f"القيد مش متوازن — مدين {debit} ودائن {credit}.")


def _assert_period_open(db: Session, when: date | None) -> None:
    """إقفال الفترة — refuse to post into a closed period (019).

    Enforced HERE, in the single write path into the ledger, so no document type can slip
    a posting into a month the accountant has already closed and reported on.
    """
    # Imported lazily: treasury_service imports ledger_service for balances.
    from src.models.treasury import PeriodLock

    lock = db.scalar(select(PeriodLock).order_by(PeriodLock.id.desc()).limit(1))
    if lock is None:
        return
    effective = when or date.today()
    if effective <= lock.locked_through:
        raise LedgerError(
            f"الفترة مقفلة حتى {lock.locked_through} — لا يمكن الترحيل بتاريخ {effective}."
        )


def post_entry(
    db: Session,
    *,
    entry_type: str,
    actor_user_id: int,
    lines: list[LineInput],
    description: str = "",
    rep_id: int | None = None,
    branch_id: int | None = None,
    reverses_entry_id: int | None = None,
    entry_date: date | None = None,
) -> LedgerEntry:
    """Append a balanced, immutable entry. Returns the persisted entry with lines."""
    _validate_lines(lines)
    _assert_period_open(db, entry_date)
    entry = LedgerEntry(
        entry_type=entry_type,
        description=description,
        actor_user_id=actor_user_id,
        rep_id=rep_id,
        branch_id=branch_id,
        reverses_entry_id=reverses_entry_id,
        entry_date=entry_date,
    )
    entry.lines = [
        LedgerLine(
            account_id=l.account_id,
            direction=l.direction,
            amount=to_money(l.amount),
            statement=l.statement,
            cost_center_id=l.cost_center_id,
        )
        for l in lines
    ]
    db.add(entry)
    db.flush()
    return entry


def _assert_within_edit_window(db: Session, original: LedgerEntry, actor_user_id: int) -> None:
    """«قفل تعديل المستندات (أيام)» — after N days, only an admin may reverse a document.

    A rolling companion to the hard period lock, not a replacement: the lock is a deliberate act on
    a date the accountant chooses, and it only ever protects a month somebody remembered to close.
    This closes the ordinary user's window by itself, so last month's invoice cannot be quietly
    reversed on a busy Tuesday and quietly change a figure already reported.

    Enforced here, in the one path every financial reversal takes, so no document type is exempt by
    accident. The actor's role is read from the database rather than passed in — a guard that
    depends on seven callers remembering to hand it the role is a guard that silently does nothing.

    Off by default (NULL/0). Stock-only documents that post no ledger entry — stock permits,
    transfers, production orders — do not pass through here and are not covered; that gap is real
    and is documented rather than papered over.
    """
    from src.models.role import RoleName
    from src.models.sales import SalesSetting
    from src.models.user import User

    setting = db.scalar(select(SalesSetting).order_by(SalesSetting.id.desc()).limit(1))
    days = getattr(setting, "edit_lock_days", None) if setting else None
    if not days or int(days) <= 0:
        return

    doc_date = original.entry_date or date.today()
    age = (date.today() - doc_date).days
    if age <= int(days):
        return

    actor = db.get(User, actor_user_id)
    # `User.role` is the Role row, not the enum — its `.name` is the RoleName.
    role_name = getattr(getattr(actor, "role", None), "name", None)
    if role_name == RoleName.system_admin:
        return
    raise LedgerError(
        f"المستند بتاريخ {doc_date} عدّى {days} يوم — التعديل أو العكس للمسؤول بس."
    )


def reverse_entry(db: Session, *, original_id: int, actor_user_id: int) -> LedgerEntry:
    """Create the mirror reversal of an entry (debits<->credits swapped).

    Enforces reverse-once (UNIQUE reverses_entry_id) and that a reversal is not re-reversible.
    """
    original = db.get(LedgerEntry, original_id)
    if original is None:
        raise LedgerError("القيد الأصلي مش موجود.")
    if original.reverses_entry_id is not None:
        raise LedgerError("القيد العكسي نفسه مايتعملهوش عكس.")
    existing = db.scalar(
        select(LedgerEntry).where(LedgerEntry.reverses_entry_id == original_id)
    )
    if existing is not None:
        raise LedgerError("القيد ده اتعكس قبل كده.")
    _assert_within_edit_window(db, original, actor_user_id)

    swapped = [
        LineInput(
            account_id=line.account_id,
            direction=(
                Direction.credit if line.direction == Direction.debit else Direction.debit
            ),
            amount=line.amount,
            statement=line.statement,
            cost_center_id=line.cost_center_id,  # reversal nets within the same cost center (006)
        )
        for line in original.lines
    ]
    return post_entry(
        db,
        entry_type="reversal",
        actor_user_id=actor_user_id,
        lines=swapped,
        description=f"Reversal of entry {original_id}",
        rep_id=original.rep_id,
        branch_id=original.branch_id,
        reverses_entry_id=original_id,
        # Reversal nets in the original's accounting period (005 analysis finding A/C).
        entry_date=original.entry_date,
    )


def total_balance_of(db: Session, account_ids) -> Decimal:
    """The balances of many accounts, added up — in one query.

    `balance_of` loads every line of ONE account and sums them in Python, which is the right shape
    for one account and the wrong shape for all of them: totalling 233 customer accounts meant 233
    round trips and every ledger line in the system crossing the wire. Doing it twice inside the
    customer merge — once before and once after, to prove no money moved — took the request past
    the serverless timeout, and the merge came back 503 having done nothing.

    Same arithmetic, computed by the database: a line counts positive when its direction matches
    the account's normal side and negative when it does not.
    """
    ids = list(account_ids)
    if not ids:
        return ZERO
    signed = case(
        (LedgerLine.direction == Account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    total = db.scalar(
        select(func.coalesce(func.sum(signed), 0))
        .select_from(LedgerLine)
        .join(Account, Account.id == LedgerLine.account_id)
        .where(LedgerLine.account_id.in_(ids))
    )
    return to_money(total or 0)


def balance_of(db: Session, account_id: int) -> Decimal:
    """Derive an account's balance from its lines (signed by the account's normal side)."""
    account = db.get(Account, account_id)
    if account is None:
        raise LedgerError("الحساب مش موجود.")
    total = ZERO
    lines = db.scalars(select(LedgerLine).where(LedgerLine.account_id == account_id)).all()
    for line in lines:
        signed = (
            to_money(line.amount)
            if line.direction == account.normal_side
            else -to_money(line.amount)
        )
        total += signed
    return to_money(total)
