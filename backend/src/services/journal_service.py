from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import lru_cache

from sqlalchemy import exists, select, union_all
from sqlalchemy.orm import Session, aliased

from src.models.ledger import Account, Direction, EntryState, LedgerEntry, PartnerKind
from src.services import audit_service, cost_center_service, ledger_service
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


MANUAL_ENTRY_TYPES = ("journal", "opening_balance", "reversal")

_DOC_LABEL = {
    "invoice": "فاتورة بيع",
    "return": "مرتجع بيع",
    "purchase": "فاتورة شراء",
    "purchase_return": "مرتجع شراء",
    "voucher": "سند",
    "expense_bill": "فاتورة مصروف",
}


@lru_cache(maxsize=1)
def _entry_refs() -> tuple:
    import src.models  # noqa: F401
    from src.core.db import Base

    refs = []
    for _, table in sorted(Base.metadata.tables.items()):
        if table.name in ("ledger_entry", "ledger_line"):
            continue
        for col in table.columns:
            if any(fk.target_fullname == "ledger_entry.id" for fk in col.foreign_keys):
                refs.append(col)
    payroll = Base.metadata.tables.get("payroll_remittance")
    if payroll is not None and "payment_entry_id" in payroll.c:
        col = payroll.c.payment_entry_id
        if col not in refs:
            refs.append(col)
    return tuple(refs)


def _linked(target_id):
    refs = union_all(*[select(col.label("entry_id")).where(col.is_not(None))
                       for col in _entry_refs()]).subquery()
    return target_id.in_(select(refs.c.entry_id))


def manual_entry_sql():
    original = aliased(LedgerEntry)
    return (
        LedgerEntry.entry_type.in_(MANUAL_ENTRY_TYPES)
        & ~_linked(LedgerEntry.id)
        & ~exists(
            select(original.id).where(
                original.id == LedgerEntry.reverses_entry_id,
                original.entry_type.not_in(MANUAL_ENTRY_TYPES) | _linked(original.id))
        )
    )


def is_manual(db: Session, entry: LedgerEntry) -> bool:
    return db.scalar(
        select(LedgerEntry.id).where(LedgerEntry.id == entry.id, manual_entry_sql())
    ) is not None


def assert_manual(db: Session, entry: LedgerEntry) -> None:
    if is_manual(db, entry):
        return
    from src.services import document_resolver

    doc = document_resolver.resolve_entry(db, entry.id)
    if doc is None and entry.reverses_entry_id:
        doc = document_resolver.resolve_entry(db, entry.reverses_entry_id)
    if doc is not None:
        label = _DOC_LABEL.get(doc["kind"], "مستند")
        number = doc.get("document_number") or doc["id"]
        raise JournalError(
            f"هذا القيد ناتج عن {label} رقم {number} — عدّله أو احذفه من شاشة المستند نفسه.")
    raise JournalError(
        "هذا القيد ناتج عن مستند في النظام وليس قيداً يدوياً — عدّله أو احذفه من شاشة المستند نفسه.")


def _snapshot(entry: LedgerEntry) -> dict:
    return {
        "number": entry.number,
        "entry_type": entry.entry_type,
        "state": entry.state,
        "date": entry.entry_date.isoformat() if entry.entry_date else None,
        "description": entry.description,
        "branch_id": entry.branch_id,
        "journal_id": entry.journal_id,
        "partner_kind": entry.partner_kind,
        "partner_id": entry.partner_id,
        "reverses_entry_id": entry.reverses_entry_id,
        "lines": [
            {
                "account_id": ln.account_id,
                "account": (ln.account.name or ln.account.code) if ln.account else None,
                "direction": getattr(ln.direction, "value", ln.direction),
                "amount": str(ln.amount),
                "statement": ln.statement,
                "cost_center_id": ln.cost_center_id,
            }
            for ln in entry.lines
        ],
    }


def replace_entry(
    db: Session,
    *,
    entry_id: int,
    actor_user_id: int,
    entry_date: date,
    description: str,
    branch_id: int | None,
    journal_id: int | None,
    lines: list[JournalLineInput],
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
) -> LedgerEntry:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise JournalError("القيد غير موجود.")
    assert_manual(db, entry)
    if entry.reverses_entry_id is not None:
        raise JournalError("هذا قيد عكسي لا يُعدَّل — احذفه إن لم يعد مطلوباً.")
    if db.scalar(
        select(LedgerEntry.id).where(LedgerEntry.reverses_entry_id == entry.id).limit(1)
    ) is not None:
        raise JournalError("هذا القيد معكوس — احذف القيد العكسي أولاً ثم عدّل القيد.")
    before = _snapshot(entry)
    _validate_accounts(db, lines)

    line_ids = [ln.id for ln in entry.lines]
    if line_ids:
        from src.models.reconcile import PartialReconcile
        from src.services import reconcile_service

        if db.scalar(
            select(PartialReconcile.id).where(
                PartialReconcile.debit_line_id.in_(line_ids)
                | PartialReconcile.credit_line_id.in_(line_ids)
            ).limit(1)
        ) is not None:
            reconcile_service.unreconcile(db, line_ids=line_ids)

    kind = partner_kind.value if isinstance(partner_kind, PartnerKind) else partner_kind
    entry.partner_kind = kind if partner_id else None
    entry.partner_id = partner_id if kind else None
    entry.invoice_date_due = invoice_date_due or entry_date
    entry.description = description
    entry.branch_id = branch_id
    if journal_id is not None:
        entry.journal_id = journal_id
    try:
        ledger_service.rewrite_entry(
            db, entry=entry, lines=_to_line_inputs(lines), entry_date=entry_date,
            actor_user_id=actor_user_id,
        )
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    db.refresh(entry)
    audit_service.record(
        db, action="journal.update", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=entry.id,
        before=before, after=_snapshot(entry),
    )
    return entry


def delete_entry(db: Session, *, entry_id: int, actor_user_id: int) -> None:
    from src.services.document_edit_service import DocumentEditError, _drop_entry

    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise JournalError("القيد غير موجود.")
    assert_manual(db, entry)
    reversals = list(db.scalars(
        select(LedgerEntry).where(LedgerEntry.reverses_entry_id == entry.id)).all())
    for e in (entry, *reversals):
        if ledger_service.is_posted(e):
            try:
                ledger_service._assert_period_open(db, e.entry_date, actor_user_id)
            except LedgerError as exc:
                raise JournalError(str(exc)) from exc
    before = _snapshot(entry)
    if reversals:
        before["reversals"] = [dict(_snapshot(r), id=r.id) for r in reversals]
    try:
        _drop_entry(db, entry_id)
    except DocumentEditError as exc:
        raise JournalError(str(exc)) from exc
    db.flush()
    db.expunge(entry)
    for r in reversals:
        db.expunge(r)
    audit_service.record(
        db, action="journal.delete", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=entry_id, before=before,
    )
