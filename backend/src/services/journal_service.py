"""Manual journal entries (005, T015/T019).

A journal entry IS a balanced Foundation `ledger_entry` (one ledger; Principle VI). This service
adds the chart-specific guard — every line must target a postable, active leaf — then delegates
balancing, immutability, and reverse-once to `ledger_service`, and records audit explicitly
(post_entry does NOT auto-audit, analysis finding B).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from src.models.ledger import Account, Direction, EntryState, LedgerEntry, PartnerKind
from src.services import audit_service, chart_service, cost_center_service, ledger_service
from src.services.ledger_service import LedgerError, LineInput


class JournalError(Exception):
    """Invalid journal entry (non-postable account, unbalanced, inactive cost center, etc.)."""


@dataclass(frozen=True)
class JournalLineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None
    cost_center_id: int | None = None  # optional analytical dimension (006)
    # (المرحلة ٢) الشريك على السطر — القيد اللي بيقفل على عميل بعينه بيتقال هنا.
    partner_kind: PartnerKind | str | None = None
    partner_id: int | None = None


def _validate_accounts(db: Session, lines: list[JournalLineInput]) -> None:
    """كل سطر لازم يشاور على حساب موجود وشغّال، ومركز تكلفة شغّال لو اتحدد."""
    if not lines:
        raise JournalError("قيد اليومية لازم يكون فيه سطر واحد على الأقل.")
    for ln in lines:
        # «الحساب ده مش حساب فرعي شغال بيقبل الترحيل» اتشالت بطلب العميل: القيد بينزل على
        # أي حساب متحدد، رئيسي أو فرعي. القاعدة كانت بتقول إن الحساب الرئيسي مجموع أولاده
        # ومايتكتبش عليه — وده صح محاسبياً وعائق عملياً، لأن اللي بيكتب قيد بيبقى قاصد
        # الحساب اللي اختاره.
        #
        # الحساب المقفول لسه مرفوض: مقفول معناها «مش بيتحرك تاني»، وده قرار المستخدم نفسه
        # مش قاعدة اتفرضت عليه.
        acc = db.get(Account, ln.account_id)
        if acc is None or not acc.active:
            raise JournalError("الحساب ده مش موجود أو مقفول.")
        if ln.cost_center_id is not None and not cost_center_service.is_active(db, ln.cost_center_id):
            raise JournalError(
                "مركز التكلفة ده مش موجود أو مقفول."
            )


def _to_line_inputs(lines: list[JournalLineInput]) -> list[LineInput]:
    return [
        LineInput(
            ln.account_id, ln.direction, ln.amount, ln.statement, ln.cost_center_id,
            ln.partner_kind, ln.partner_id,
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
    """يكتب قيد يومية بإيد المستخدم. `state="draft"` بيسيبه ناقص ومن غير رقم."""
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
    except LedgerError as exc:  # غير متوازن / مبلغ مش موجب / سطور فاضية
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
    """مسودة قيد — مش بتدخل الحسابات ومش لازم تتوازن."""
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
    """يعدّل مسودة. المرحّل مايوصلش هنا — يترجّع مسودة الأول."""
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise JournalError("القيد مش موجود.")
    if entry.state != EntryState.draft.value:
        raise JournalError("القيد ده مش مسودة — رجّعه مسودة الأول عشان تعدّله.")
    if partner_kind is not None or partner_id is not None:
        entry.partner_kind = (
            partner_kind.value if isinstance(partner_kind, PartnerKind) else partner_kind
        )
        entry.partner_id = partner_id
    if invoice_date_due is not None:
        entry.invoice_date_due = invoice_date_due
    # الشريك بيتظبط قبل السطور مش بعدها: `replace_lines` بيورّث شريك القيد للسطر
    # اللي ماقالش بتاعه، فلو اتظبط بعدها كانت السطور الجديدة هتورث الشريك القديم.
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
    """يرحّل مسودة — هنا بس بيتفرض التوازن، وهنا بس بيتصرف الرقم."""
    try:
        entry = ledger_service.post_draft(db, entry_id=entry_id)
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.post", actor_user_id=actor_user_id, entity_type="ledger_entry",
        entity_id=entry.id, after={"state": entry.state, "number": entry.number},
    )
    return entry


def reset_to_draft(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    """يرجّع قيد مرحّل لمسودة — بيخرج من الحسابات، ورقمه بيفضل محجوز."""
    try:
        entry = ledger_service.reset_to_draft(db, entry_id=entry_id)
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.reset_draft", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=entry.id, after={"state": entry.state},
    )
    return entry


def cancel_entry(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    """يلغي قيد — بيخرج من كل الحسابات وبيفضل موجود برقمه للمراجعة."""
    try:
        entry = ledger_service.cancel_entry(db, entry_id=entry_id)
    except LedgerError as exc:
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.cancel", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=entry.id, after={"state": entry.state},
    )
    return entry


def reverse_entry(db: Session, *, entry_id: int, actor_user_id: int) -> LedgerEntry:
    """Correct a journal entry by posting its linked mirror (reverse-once; never edit/delete)."""
    try:
        reversal = ledger_service.reverse_entry(
            db, original_id=entry_id, actor_user_id=actor_user_id
        )
    except LedgerError as exc:  # already reversed / not re-reversible / missing
        raise JournalError(str(exc)) from exc
    audit_service.record(
        db, action="journal.reverse", actor_user_id=actor_user_id, entity_type="ledger_entry",
        entity_id=reversal.id, after={"reverses_entry_id": entry_id},
    )
    return reversal
