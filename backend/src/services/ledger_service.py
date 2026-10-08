from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import case, exists, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.lib import entry_text
from src.models.journal import Journal
from src.models.ledger import (
    Account,
    Direction,
    EntryState,
    LedgerEntry,
    LedgerLine,
    MoveType,
    PartnerKind,
)
from src.services import journal_registry, lock_date_service, move_registry
from src.services.lock_date_service import LockDateError


class LedgerError(Exception):
    pass


@dataclass(frozen=True)
class LineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None
    cost_center_id: int | None = None
    partner_kind: PartnerKind | str | None = None
    partner_id: int | None = None
    date_maturity: date | None = None
    cost_center_distribution: dict | None = None


def _validate_lines(lines: list[LineInput]) -> None:
    if not lines:
        raise LedgerError("القيد لازم يكون فيه سطر واحد على الأقل.")
    if any(to_money(l.amount) <= ZERO for l in lines):
        raise LedgerError("كل سطر لازم يكون مبلغه أكبر من صفر.")


def posted_only(stmt):
    return stmt.where(is_posted_sql())


def is_posted_sql():
    return LedgerEntry.state.is_(None) | (LedgerEntry.state == EntryState.posted.value)


def in_books_sql(posted_only: bool = True):
    if posted_only:
        return is_posted_sql()
    return LedgerEntry.state.is_(None) | (LedgerEntry.state != EntryState.cancelled.value)


def posted_line_cond():
    return exists().where(
        (LedgerEntry.id == LedgerLine.entry_id) & is_posted_sql()
    )


def is_posted(entry: LedgerEntry) -> bool:
    return entry.state in (None, EntryState.posted.value)


def _sides(lines: list[LineInput]) -> tuple[Decimal, Decimal]:
    debit = sum((to_money(ln.amount) for ln in lines if ln.direction == Direction.debit), ZERO)
    credit = sum((to_money(ln.amount) for ln in lines if ln.direction == Direction.credit), ZERO)
    return to_money(debit), to_money(credit)


def _assert_balanced(lines: list[LineInput]) -> None:
    debit, credit = _sides(lines)
    if debit != credit:
        diff = to_money(abs(debit - credit))
        raise LedgerError(
            f"القيد مش متوازن: المدين {debit} والدائن {credit} — الفرق {diff}. "
            "صلّح السطور أو سيبه مسودة."
        )


def _assert_period_open(
    db: Session, when: date | None, actor_user_id: int | None = None
) -> None:
    try:
        lock_date_service.assert_open(db, when, actor_user_id=actor_user_id)
    except LockDateError as exc:
        raise LedgerError(str(exc)) from exc


def _as_value(kind) -> str | None:
    if kind is None:
        return None
    return kind.value if isinstance(kind, PartnerKind) else str(kind)


def _build_lines(
    lines: list[LineInput],
    *,
    partner_kind: str | None = None,
    partner_id: int | None = None,
    date_maturity: date | None = None,
    cost_center_id: int | None = None,
) -> list[LedgerLine]:
    built: list[LedgerLine] = []
    for ln in lines:
        own = _as_value(ln.partner_kind) is not None or ln.partner_id is not None
        built.append(
            LedgerLine(
                account_id=ln.account_id,
                direction=ln.direction,
                amount=to_money(ln.amount),
                statement=ln.statement,
                cost_center_id=ln.cost_center_id or cost_center_id,
                partner_kind=_as_value(ln.partner_kind) if own else partner_kind,
                partner_id=ln.partner_id if own else partner_id,
                date_maturity=ln.date_maturity or date_maturity,
            )
        )
    return built


def _distribution_rows(db, line_id):
    from src.models.analytic import LedgerLineDistribution

    return db.scalars(
        select(LedgerLineDistribution).where(LedgerLineDistribution.line_id == line_id)
    ).all()


def _apply_distributions(db, built, inputs, document_distribution) -> None:
    from src.services import analytic_service

    for line, source in zip(built, inputs):
        shares = source.cost_center_distribution or (
            document_distribution if source.cost_center_id is None else None
        )
        if shares:
            try:
                analytic_service.set_distribution(db, line=line, shares=shares)
            except analytic_service.AnalyticError as exc:
                raise LedgerError(str(exc)) from exc


def _assert_not_hashed(entry: LedgerEntry) -> None:
    from src.services import secure_hash_service

    try:
        secure_hash_service.assert_alterable(entry)
    except secure_hash_service.HashChainError as exc:
        raise LedgerError(str(exc)) from exc


def _stamp_posted(db: Session, entry: LedgerEntry) -> None:
    if entry.journal_id is None:
        entry.journal_id = journal_registry.resolve(db, entry.entry_type).id
    if entry.move_type is None:
        entry.move_type = move_registry.move_type_for(entry.entry_type).value
    entry.state = EntryState.posted.value
    entry.posted_at = datetime.now()
    if not entry.number:
        journal = db.get(Journal, entry.journal_id)
        when = entry.entry_date or date.today()
        entry.number = journal_registry.next_number(db, journal=journal, when=when)
    from src.services import reconcile_service

    reconcile_service.stamp_residuals(db, entry)
    entry.payment_state = reconcile_service.payment_state_of(entry)
    from src.services import secure_hash_service

    secure_hash_service.stamp(db, entry)


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
    journal_id: int | None = None,
    state: str = EntryState.posted.value,
    move_type: MoveType | str | None = None,
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
    cost_center_id: int | None = None,
    cost_center_distribution: dict | None = None,
) -> LedgerEntry:
    _validate_lines(lines)
    if state == EntryState.posted.value:
        _assert_balanced(lines)
    _assert_period_open(db, entry_date, actor_user_id)
    kind = _as_value(partner_kind)
    due = invoice_date_due or entry_date or date.today()
    entry = LedgerEntry(
        entry_type=entry_type,
        description=description,
        actor_user_id=actor_user_id,
        rep_id=rep_id,
        branch_id=branch_id,
        reverses_entry_id=reverses_entry_id,
        entry_date=entry_date,
        journal_id=journal_id,
        state=state,
        move_type=(
            move_type.value if isinstance(move_type, MoveType)
            else move_type or move_registry.move_type_for(entry_type).value
        ),
        partner_kind=kind,
        partner_id=partner_id,
        invoice_date_due=due,
    )
    entry.lines = _build_lines(lines, partner_kind=kind, partner_id=partner_id,
                               date_maturity=due, cost_center_id=cost_center_id)
    db.add(entry)
    db.flush()
    _apply_distributions(db, entry.lines, lines, cost_center_distribution)
    if state == EntryState.posted.value:
        _stamp_posted(db, entry)
        db.flush()
    return entry


def _entry_lines_as_input(entry: LedgerEntry) -> list[LineInput]:
    return [
        LineInput(
            ln.account_id, ln.direction, ln.amount, ln.statement, ln.cost_center_id,
            ln.partner_kind, ln.partner_id, ln.date_maturity,
        )
        for ln in entry.lines
    ]


def create_draft(
    db: Session,
    *,
    entry_type: str,
    actor_user_id: int,
    lines: list[LineInput],
    description: str = "",
    branch_id: int | None = None,
    entry_date: date | None = None,
    journal_id: int | None = None,
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
) -> LedgerEntry:
    return post_entry(
        db, entry_type=entry_type, actor_user_id=actor_user_id, lines=lines,
        description=description, branch_id=branch_id, entry_date=entry_date,
        journal_id=journal_id, state=EntryState.draft.value,
        partner_kind=partner_kind, partner_id=partner_id,
        invoice_date_due=invoice_date_due,
    )


def replace_lines(db: Session, *, entry: LedgerEntry, lines: list[LineInput]) -> LedgerEntry:
    if entry.state != EntryState.draft.value:
        raise LedgerError("القيد ده مش مسودة — رجّعه مسودة الأول عشان تعدّل سطوره.")
    _validate_lines(lines)
    for line in list(entry.lines):
        db.delete(line)
    db.flush()
    entry.lines = _build_lines(
        lines,
        partner_kind=entry.partner_kind,
        partner_id=entry.partner_id,
        date_maturity=entry.invoice_date_due or entry.entry_date,
    )
    db.flush()
    _apply_distributions(db, entry.lines, lines, None)
    return entry


def post_draft(db: Session, *, entry_id: int, actor_user_id: int | None = None) -> LedgerEntry:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise LedgerError("القيد مش موجود.")
    if entry.state == EntryState.posted.value:
        raise LedgerError("القيد مرحّل خلاص.")
    if entry.state == EntryState.cancelled.value:
        raise LedgerError("القيد ملغي — مايتّرحّلش.")
    inputs = _entry_lines_as_input(entry)
    _validate_lines(inputs)
    _assert_balanced(inputs)
    _assert_period_open(db, entry.entry_date, actor_user_id or entry.actor_user_id)
    _stamp_posted(db, entry)
    db.flush()
    return entry


def _release_residuals(db: Session, entry: LedgerEntry) -> None:
    from src.models.reconcile import PartialReconcile

    ids = [ln.id for ln in entry.lines]
    if ids:
        linked = db.scalar(
            select(PartialReconcile.id).where(
                PartialReconcile.debit_line_id.in_(ids)
                | PartialReconcile.credit_line_id.in_(ids)
            ).limit(1)
        )
        if linked is not None:
            raise LedgerError(
                "القيد ده متقفل على فواتير — فك المطابقة الأول من شاشة التسوية.")
    for line in entry.lines:
        line.amount_residual = None
    entry.payment_state = None


def reset_to_draft(db: Session, *, entry_id: int, actor_user_id: int | None = None) -> LedgerEntry:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise LedgerError("القيد مش موجود.")
    if entry.state == EntryState.draft.value:
        return entry
    _assert_not_hashed(entry)
    _assert_period_open(db, entry.entry_date, actor_user_id or entry.actor_user_id)
    _release_residuals(db, entry)
    entry.state = EntryState.draft.value
    entry.posted_at = None
    db.flush()
    return entry


def cancel_entry(db: Session, *, entry_id: int, actor_user_id: int | None = None) -> LedgerEntry:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise LedgerError("القيد مش موجود.")
    if entry.state == EntryState.posted.value:
        _assert_not_hashed(entry)
        _assert_period_open(db, entry.entry_date, actor_user_id or entry.actor_user_id)
    _release_residuals(db, entry)
    entry.state = EntryState.cancelled.value
    db.flush()
    return entry


def reverse_entry(db: Session, *, original_id: int, actor_user_id: int) -> LedgerEntry:
    original = db.get(LedgerEntry, original_id)
    if original is None:
        raise LedgerError("القيد الأصلي مش موجود.")

    swapped = [
        LineInput(
            account_id=line.account_id,
            direction=(
                Direction.credit if line.direction == Direction.debit else Direction.debit
            ),
            amount=line.amount,
            statement=line.statement,
            cost_center_id=line.cost_center_id,
            cost_center_distribution={
                int(r.cost_center_id): to_money(r.percent)
                for r in _distribution_rows(db, line.id)
            } or None,
        )
        for line in original.lines
    ]
    return post_entry(
        db,
        entry_type="reversal",
        actor_user_id=actor_user_id,
        lines=swapped,
        description=entry_text.reversal(original_id),
        rep_id=original.rep_id,
        branch_id=original.branch_id,
        reverses_entry_id=original_id,
        entry_date=original.entry_date,
        move_type=move_registry.reversed_move_type(original.move_type),
        partner_kind=original.partner_kind,
        partner_id=original.partner_id,
        invoice_date_due=original.invoice_date_due,
    )


def total_balance_of(db: Session, account_ids) -> Decimal:
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
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(ids), is_posted_sql())
    )
    return to_money(total or 0)


def balance_of(db: Session, account_id: int) -> Decimal:
    account = db.get(Account, account_id)
    if account is None:
        raise LedgerError("الحساب مش موجود.")
    signed = case(
        (LedgerLine.direction == account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    total = db.scalar(
        select(func.coalesce(func.sum(signed), 0))
        .select_from(LedgerLine)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id == account_id, is_posted_sql())
    )
    return to_money(total if total is not None else ZERO)
