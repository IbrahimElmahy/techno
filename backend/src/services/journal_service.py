from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from src.models.ledger import Account, Direction, EntryState, LedgerEntry, PartnerKind
from src.services import audit_service, chart_service, cost_center_service, ledger_service
from src.services.ledger_service import LedgerError, LineInput


class JournalError(Exception):
    pass


@dataclass(frozen=True)
class JournalLineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None
    cost_center_id: int | None = None
    partner_kind: PartnerKind | str | None = None
    partner_id: int | None = None
    cost_center_distribution: dict | None = None


def _validate_accounts(db: Session, lines: list[JournalLineInput]) -> None:
    if not lines:
        raise JournalError("يجب أن يتضمن قيد اليومية سطراً واحداً على الأقل.")
    for ln in lines:
        acc = db.get(Account, ln.account_id)
        if acc is None or not acc.active:
            raise JournalError("هذا الحساب غير موجود أو مقفل.")
        if ln.cost_center_id is not None and not cost_center_service.is_active(db, ln.cost_center_id):
            raise JournalError(
                "مركز التكلفة هذا غير موجود أو مقفل."
            )
        if ln.cost_center_distribution:
            from src.services import analytic_service

            try:
                analytic_service.validate(
                    db, analytic_service.normalize(ln.cost_center_distribution))
            except analytic_service.AnalyticError as exc:
                raise JournalError(str(exc)) from exc


def _to_line_inputs(lines: list[JournalLineInput]) -> list[LineInput]:
    return [
        LineInput(
            ln.account_id, ln.direction, ln.amount, ln.statement, ln.cost_center_id,
            ln.partner_kind, ln.partner_id, None, ln.cost_center_distribution,
        )
        for ln in lines
    ]


def post_entry(
    db: Session,
    *,
    entry_date: date,
    description: str,
    branch_id: int | None,
    lines: list[JournalLineInput],
    actor_user_id: int,
    entry_type: str = "journal",
    journal_id: int | None = None,
    state: str = EntryState.posted.value,
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
) -> LedgerEntry:
    _validate_accounts(db, lines)
    try:
        entry = ledger_service.post_entry(
            db,
            entry_type=entry_type,
            actor_user_id=actor_user_id,
            lines=_to_line_inputs(lines),
            description=description,
            branch_id=branch_id,
            entry_date=entry_date,
            journal_id=journal_id,
            state=state,
            partner_kind=partner_kind,
            partner_id=partner_id,
            invoice_date_due=invoice_date_due,
        )
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc

    audit_service.record(
        db, action=f"journal.{'draft' if state == EntryState.draft.value else 'post'}",
        actor_user_id=actor_user_id, entity_type="ledger_entry",
        entity_id=entry.id,
        after={"entry_type": entry_type, "branch_id": branch_id, "state": state,
               "number": entry.number},
    )
    return entry


def create_draft(
    db: Session,
    *,
    entry_date: date,
    description: str,
    branch_id: int | None,
    lines: list[JournalLineInput],
    actor_user_id: int,
    entry_type: str = "journal",
    journal_id: int | None = None,
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
) -> LedgerEntry:
    return post_entry(
        db, entry_date=entry_date, description=description, branch_id=branch_id,
        lines=lines, actor_user_id=actor_user_id, entry_type=entry_type,
        journal_id=journal_id, state=EntryState.draft.value,
        partner_kind=partner_kind, partner_id=partner_id,
        invoice_date_due=invoice_date_due,
    )


def update_draft(
    db: Session,
    *,
    entry_id: int,
    actor_user_id: int,
    entry_date: date | None = None,
    description: str | None = None,
    branch_id: int | None = None,
    journal_id: int | None = None,
    lines: list[JournalLineInput] | None = None,
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
) -> LedgerEntry:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise JournalError("القيد غير موجود.")
    if entry.state != EntryState.draft.value:
        raise JournalError("هذا القيد ليس مسودة — أعده إلى مسودة أولاً لتعديله.")
    if partner_kind is not None or partner_id is not None:
        entry.partner_kind = (
            partner_kind.value if isinstance(partner_kind, PartnerKind) else partner_kind
        )
        entry.partner_id = partner_id
    if invoice_date_due is not None:
        entry.invoice_date_due = invoice_date_due
    if lines is not None:
        _validate_accounts(db, lines)
        try:
            ledger_service.replace_lines(db, entry=entry, lines=_to_line_inputs(lines))
        except LedgerError as exc:
            raise JournalError(str(exc)) from exc
    if entry_date is not None:
        entry.entry_date = entry_date
    if description is not None:
        entry.description = description
    if branch_id is not None:
        entry.branch_id = branch_id
    if journal_id is not None:
        entry.journal_id = journal_id
    db.flush()
    audit_service.record(
        db, action="journal.draft_update", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=entry.id, after={"state": entry.state},
    )
    return entry


def post_draft(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    try:
        entry = ledger_service.post_draft(db, entry_id=entry_id, actor_user_id=actor_user_id)
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.post", actor_user_id=actor_user_id, entity_type="ledger_entry",
        entity_id=entry.id, after={"state": entry.state, "number": entry.number},
    )
    return entry


def reset_to_draft(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    try:
        entry = ledger_service.reset_to_draft(db, entry_id=entry_id, actor_user_id=actor_user_id)
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.reset_draft", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=entry.id, after={"state": entry.state},
    )
    return entry


def cancel_entry(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    try:
        entry = ledger_service.cancel_entry(db, entry_id=entry_id, actor_user_id=actor_user_id)
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.cancel", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=entry.id, after={"state": entry.state},
    )
    return entry


def reverse_entry(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    try:
        reversal = ledger_service.reverse_entry(
            db, original_id=entry_id, actor_user_id=actor_user_id
        )
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.reverse", actor_user_id=actor_user_id, entity_type="ledger_entry",
        entity_id=reversal.id, after={"reverses_entry_id": entry_id},
    )
    return reversal
