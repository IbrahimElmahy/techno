"""General Ledger & Chart of Accounts router (005).

Chart tree CRUD, manual journal entries (+reverse), opening balances, and the derived trial
balance. All gated by the `accounting.*` capabilities (Accountant + System Admin). Journals are
branch-tagged; branch-scoped users post/read only their own branch.
"""
from __future__ import annotations

from datetime import date
from datetime import date as DateType  # الحقل اسمه `date` وبيحجب النوع جوه الكلاس
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import (
    CAP_ACCOUNTING_CHART_READ,
    CAP_ACCOUNTING_CHART_WRITE,
    CAP_ACCOUNTING_JOURNAL_POST,
    CAP_ACCOUNTING_JOURNAL_REVERSE,
    CAP_ACCOUNTING_TRIAL_BALANCE_READ,
)
from src.core.db import get_db
from src.models.customer import Customer
from src.models.employee import Employee
from src.models.journal import JOURNAL_KIND_LABEL, Journal, JournalKind
from src.models.ledger import (
    Account,
    AccountNature,
    Direction,
    EntryState,
    LedgerEntry,
    LedgerLine,
    PartnerKind,
)
from src.models.supplier import Supplier
from src.services import (
    account_routing_service,
    chart_service,
    journal_registry,
    journal_service,
    move_registry,
    opening_balance_service,
    trial_balance_service,
)
from src.services.account_routing_service import RoutingError
from src.services.chart_service import ChartError
from src.services.journal_service import JournalError, JournalLineInput
from src.services.opening_balance_service import OpeningLineInput

router = APIRouter(tags=["accounting"])


def _ensure_accounting_branch(current: CurrentUser, target_branch_id: int | None) -> None:
    """Accounting branch scope: System Admin and a company-wide accountant (no branch assigned)
    may act on any branch; a branch-scoped accountant only on their own (FR-016)."""
    if current.is_admin or current.branch_id is None:
        return
    if current.branch_id != target_branch_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden", "message": "Out-of-branch accounting access denied."},
        )


# --- Schemas ---------------------------------------------------------------------------------

class AccountOut(BaseModel):
    id: int
    code: str | None
    name: str | None
    parent_id: int | None
    # What the account IS to the system — «حساب عميل», «خزينة», «حساب أنشأه المستخدم». The screens
    # group by this (the chart has no real «العملاء» row), so it has to travel with the row.
    account_type: str | None = None
    nature: AccountNature | None
    normal_side: Direction
    is_postable: bool
    is_system: bool
    active: bool
    appears_in: str | None = None
    main_level: str | None = None
    balance: Decimal
    children: list[AccountOut] | None = None
    # An account opened FOR somebody — a customer, a supplier, a safe, a rep's custody — carries
    # `owner_ref` and no name of its own. These two say who it belongs to and under which heading,
    # derived on read so renaming the customer renames his account with him.
    owner_name: str | None = None
    owner_group: str | None = None


class AccountCreate(BaseModel):
    code: str
    name: str
    parent_id: int | None = None
    nature: AccountNature
    is_postable: bool
    # trading | profit_loss | balance_sheet — omit to let the account's nature decide.
    appears_in: str | None = None
    main_level: str | None = None


class AccountUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None
    # «يظهر في» — trading | profit_loss | balance_sheet | none, or "" to follow the nature.
    appears_in: str | None = None
    main_level: str | None = None


class JournalLineIn(BaseModel):
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None
    cost_center_id: int | None = None
    # (المرحلة ٢) شريك السطر. مالوش قيمة ⇒ بياخد شريك القيد.
    partner_kind: str | None = None
    partner_id: int | None = None


class JournalEntryCreate(BaseModel):
    date: date
    description: str = ""
    branch_id: int
    # الدفتر. مالوش قيمة ⇒ بيتحدد من نوع القيد («قيود متنوعة» للقيد اليدوي).
    journal_id: int | None = None
    # "posted" يرحّل على طول (السلوك القديم)، "draft" بيسيبه مسودة ناقصة.
    state: str = EntryState.posted.value
    # (المرحلة ٢) القيد على مين، وامتى مستحق. الاتنين اختياريين: القيد اللي مالوش
    # شريك (إقفال، تسوية بين حسابات) بيفضل من غير — وده صح مش نقص.
    partner_kind: str | None = None
    partner_id: int | None = None
    due_date: DateType | None = None
    # سطر واحد كفاية للمسودة. المرحّل بيتفرض عليه التوازن في `ledger_service`، وده شرط
    # أقوى من «سطرين»: قيد بسطرين مش متوازنين كان بيعدّي من هنا قبل كده.
    lines: list[JournalLineIn] = Field(min_length=1)


class JournalEntryUpdate(BaseModel):
    """تعديل مسودة. المرحّل مايتعدلش — يترجّع مسودة الأول."""

    date: DateType | None = None
    description: str | None = None
    branch_id: int | None = None
    journal_id: int | None = None
    partner_kind: str | None = None
    partner_id: int | None = None
    due_date: DateType | None = None
    lines: list[JournalLineIn] | None = None


class JournalOut(BaseModel):
    id: int
    code: str
    name: str
    kind: str
    kind_label: str
    active: bool
    is_system: bool
    sort_order: int


class JournalCreate(BaseModel):
    code: str = Field(min_length=1, max_length=12)
    name: str = Field(min_length=1, max_length=120)
    kind: str = JournalKind.general.value
    sort_order: int = 100


class JournalUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    active: bool | None = None
    sort_order: int | None = None


class JournalLineOut(BaseModel):
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None
    cost_center_id: int | None = None
    partner_kind: str | None = None
    partner_id: int | None = None
    date_maturity: date | None = None


class JournalEntryOut(BaseModel):
    id: int
    entry_type: str
    date: date | None
    description: str
    branch_id: int | None
    actor_user_id: int
    reverses_entry_id: int | None
    lines: list[JournalLineOut]
    total: Decimal
    # المرحلة ١ — الدفتر والحالة والرقم.
    journal_id: int | None = None
    journal_code: str | None = None
    journal_name: str | None = None
    state: str = EntryState.posted.value
    number: str | None = None
    # مجموع الدائن كمان، عشان الواجهة توري الفرق من غير ما تحسبه من السطور.
    total_credit: Decimal = Decimal("0.00")
    balanced: bool = True
    # المرحلة ٢ — نوع المستند والشريك والاستحقاق.
    move_type: str | None = None
    move_type_label: str | None = None
    partner_kind: str | None = None
    partner_id: int | None = None
    # الاسم بيتجاب مع القايمة في استعلام واحد — الرقم لوحده مابيقولش حاجة للي بيقرا.
    partner_name: str | None = None
    due_date: date | None = None


class OpeningLineIn(BaseModel):
    account_id: int
    amount: Decimal


class OpeningBalancesCreate(BaseModel):
    date: date
    branch_id: int | None = None
    lines: list[OpeningLineIn] = Field(min_length=1)


class TrialBalanceRowOut(BaseModel):
    account_id: int
    code: str | None
    name: str | None
    is_postable: bool
    opening: Decimal
    period_debit: Decimal
    period_credit: Decimal
    closing: Decimal
    # asset | liability | equity | income | expense — which of the four books the row belongs in.
    nature: str | None = None


class TrialBalanceOut(BaseModel):
    from_: date = Field(alias="from")
    to: date
    branch_id: int | None
    rows: list[TrialBalanceRowOut]
    grand_total_debit: Decimal
    grand_total_credit: Decimal
    balanced: bool

    model_config = {"populate_by_name": True}


# --- Serialization helpers -------------------------------------------------------------------

def _account_out(db: Session, acc: Account, *, with_children: bool = False,
                 owner_names: dict[int, str] | None = None,
                 balances: dict[int, Decimal] | None = None,
                 kids_by_parent: dict[int, list[Account]] | None = None) -> AccountOut:
    children = None
    if with_children:
        if kids_by_parent is not None:
            kids = kids_by_parent.get(acc.id, [])
        else:
            kids = db.scalars(
                select(Account).where(Account.parent_id == acc.id).order_by(Account.code)
            ).all()
        children = [_account_out(db, k, with_children=True, owner_names=owner_names,
                                 balances=balances, kids_by_parent=kids_by_parent)
                    for k in kids]
    return AccountOut(
        id=acc.id, code=acc.code, name=acc.name, parent_id=acc.parent_id,
        account_type=acc.account_type.value if acc.account_type else None, nature=acc.nature,
        normal_side=acc.normal_side, is_postable=acc.is_postable, is_system=acc.is_system,
        active=acc.active, appears_in=acc.appears_in,
        main_level=getattr(acc, "main_level", None),
        balance=(balances.get(acc.id, Decimal("0.00")) if balances is not None
                 else chart_service.account_balance(db, acc.id)), children=children,
        owner_name=(owner_names or {}).get(acc.id),
        owner_group=chart_service.owner_group_label(acc.account_type),
    )


def _partner_names(db: Session, entries) -> dict[tuple[str, int], str]:
    """أسماء الشركاء اللي على القيود دي — استعلام واحد لكل نوع.

    الرقم لوحده مابيقولش حاجة للي بيقرا الشاشة، وجلب الاسم لكل قيد على حدة بيحوّل
    قايمة من ٥٠٠ قيد لـ٥٠٠ رحلة للقاعدة.
    """
    wanted: dict[str, set[int]] = {}
    for entry in entries:
        if entry.partner_kind and entry.partner_id:
            wanted.setdefault(entry.partner_kind, set()).add(entry.partner_id)
    if not wanted:
        return {}
    models = {
        PartnerKind.customer.value: Customer,
        PartnerKind.supplier.value: Supplier,
        PartnerKind.employee.value: Employee,
    }
    out: dict[tuple[str, int], str] = {}
    for kind, ids in wanted.items():
        model = models.get(kind)
        if model is None:
            continue
        for row_id, name in db.execute(
            select(model.id, model.name).where(model.id.in_(ids))
        ).all():
            out[(kind, int(row_id))] = name
    return out


def _entry_out(entry: LedgerEntry, partner_names: dict | None = None) -> JournalEntryOut:
    total = sum(
        (l.amount for l in entry.lines if l.direction == Direction.debit), Decimal("0.00")
    )
    total_credit = sum(
        (l.amount for l in entry.lines if l.direction == Direction.credit), Decimal("0.00")
    )
    journal = entry.journal
    return JournalEntryOut(
        id=entry.id, entry_type=entry.entry_type, date=entry.entry_date,
        description=entry.description, branch_id=entry.branch_id, actor_user_id=entry.actor_user_id,
        reverses_entry_id=entry.reverses_entry_id,
        journal_id=entry.journal_id,
        journal_code=journal.code if journal else None,
        journal_name=journal.name if journal else None,
        state=entry.state or EntryState.posted.value,
        number=entry.number,
        total_credit=total_credit,
        balanced=(total == total_credit),
        lines=[
            JournalLineOut(account_id=l.account_id, direction=l.direction, amount=l.amount,
                           statement=l.statement, cost_center_id=l.cost_center_id,
                           partner_kind=l.partner_kind, partner_id=l.partner_id,
                           date_maturity=l.date_maturity)
            for l in entry.lines
        ],
        total=total,
        move_type=entry.move_type,
        move_type_label=move_registry.MOVE_TYPE_LABEL.get(entry.move_type or ""),
        partner_kind=entry.partner_kind,
        partner_id=entry.partner_id,
        partner_name=(partner_names or {}).get((entry.partner_kind, entry.partner_id)),
        due_date=entry.invoice_date_due,
    )


# --- Chart of accounts -----------------------------------------------------------------------

@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(
    tree: bool = False,
    postable_only: bool = False,
    active: bool | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[AccountOut]:
    stmt = select(Account)
    if tree:
        stmt = stmt.where(Account.parent_id.is_(None))
    if postable_only:
        stmt = stmt.where(Account.is_postable.is_(True))
    if active is not None:
        stmt = stmt.where(Account.active.is_(active))
    accounts = list(db.scalars(stmt.order_by(Account.code)).all())
    # Resolved for the whole page at once rather than per row: a chart has one account per
    # customer, so per-row lookups would be a query per customer on every load.
    scope = accounts if not tree else list(db.scalars(select(Account)).all())
    owner_names = chart_service.bulk_owner_names(db, scope)
    # الأرصدة والأبناء بيتجابوا للشجرة كلها مرة واحدة.
    #
    # كانت بتتحسب لكل حساب لوحده، وكل حساب بيقرا سطوره من الدفتر صف صف. شجرة فيها حساب
    # لكل عميل بقت ٣٧٦٧ حساب و٤٨ ألف سطر — يعني الشاشة كانت بتاخد ١٠.٧ ثانية على السيرفر
    # نفسه قبل ما الشبكة تشوف حاجة.
    balances = chart_service.bulk_balances(db)
    kids_by_parent: dict[int, list[Account]] | None = None
    if tree:
        kids_by_parent = {}
        for a in sorted(scope, key=lambda x: x.code or ""):
            if a.parent_id is not None:
                kids_by_parent.setdefault(a.parent_id, []).append(a)
    return [_account_out(db, a, with_children=tree, owner_names=owner_names,
                         balances=balances, kids_by_parent=kids_by_parent)
            for a in accounts]


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    body: AccountCreate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> AccountOut:
    try:
        acc = chart_service.create_account(
            db, code=body.code, name=body.name, nature=body.nature,
            is_postable=body.is_postable, parent_id=body.parent_id,
            appears_in=body.appears_in, main_level=body.main_level,
        )
    except ChartError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "chart_conflict", "message": str(exc)})
    db.commit()
    return _account_out(db, acc)


@router.get("/accounts/{account_id}", response_model=AccountOut)
def get_account(
    account_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> AccountOut:
    acc = db.get(Account, account_id)
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": "Account not found"})
    return _account_out(db, acc)


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int,
    body: AccountUpdate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> AccountOut:
    try:
        acc = chart_service.update_account(
            db, account_id=account_id, name=body.name, active=body.active,
            appears_in=body.appears_in, main_level=body.main_level,
        )
    except ChartError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "chart_conflict", "message": str(exc)})
    db.commit()
    return _account_out(db, acc)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_account(
    account_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        chart_service.deactivate_account(db, account_id=account_id)
    except ChartError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "chart_conflict", "message": str(exc)})
    db.commit()


# --- Journal entries -------------------------------------------------------------------------

@router.get("/journal-entries", response_model=list[JournalEntryOut])
def list_journal_entries(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    branch_id: int | None = None,
    cost_center_id: int | None = None,
    journal_id: int | None = None,
    state: str | None = None,
    partner_kind: str | None = None,
    partner_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[JournalEntryOut]:
    stmt = select(LedgerEntry).where(
        LedgerEntry.entry_type.in_(["journal", "opening_balance", "reversal"])
    )
    if journal_id is not None:
        stmt = stmt.where(LedgerEntry.journal_id == journal_id)
    if state == EntryState.posted.value:
        # NULL = مرحّل — القيود اللي اتكتبت قبل ما العمود يتولد.
        stmt = stmt.where(
            LedgerEntry.state.is_(None) | (LedgerEntry.state == EntryState.posted.value)
        )
    elif state is not None:
        stmt = stmt.where(LedgerEntry.state == state)
    if branch_id is not None:
        stmt = stmt.where(LedgerEntry.branch_id == branch_id)
    if from_ is not None:
        stmt = stmt.where(LedgerEntry.entry_date >= from_)
    if to is not None:
        stmt = stmt.where(LedgerEntry.entry_date <= to)
    if cost_center_id is not None:  # entries that touch this cost center on any line (006)
        stmt = stmt.where(
            LedgerEntry.lines.any(LedgerLine.cost_center_id == cost_center_id)
        )
    if partner_kind is not None:
        stmt = stmt.where(LedgerEntry.partner_kind == partner_kind)
    if partner_id is not None:
        stmt = stmt.where(LedgerEntry.partner_id == partner_id)
    entries = db.scalars(stmt.order_by(LedgerEntry.id)).all()
    names = _partner_names(db, entries)
    return [_entry_out(e, names) for e in entries]


@router.get("/journal-entries/{entry_id}", response_model=JournalEntryOut)
def get_journal_entry(
    entry_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, {"code": "not_found", "message": "Entry not found"})
    return _entry_out(entry, _partner_names(db, [entry]))


@router.post("/journal-entries", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def post_journal_entry(
    body: JournalEntryCreate,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    _ensure_accounting_branch(current, body.branch_id)  # branch-scoped users post only their branch
    try:
        entry = journal_service.post_entry(
            db,
            entry_date=body.date,
            description=body.description,
            branch_id=body.branch_id,
            lines=[
                JournalLineInput(l.account_id, l.direction, l.amount, l.statement,
                                 l.cost_center_id, l.partner_kind, l.partner_id)
                for l in body.lines
            ],
            actor_user_id=current.id,
            journal_id=body.journal_id,
            state=body.state,
            partner_kind=body.partner_kind,
            partner_id=body.partner_id,
            invoice_date_due=body.due_date,
        )
    except JournalError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "journal_invalid", "message": str(exc)})
    db.commit()
    return _entry_out(entry, _partner_names(db, [entry]))


@router.patch("/journal-entries/{entry_id}", response_model=JournalEntryOut)
def update_journal_entry(
    entry_id: int,
    body: JournalEntryUpdate,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    """يعدّل مسودة. المرحّل بيترفض — لازم يترجّع مسودة الأول."""
    existing = db.get(LedgerEntry, entry_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "القيد مش موجود"})
    _ensure_accounting_branch(current, existing.branch_id)
    try:
        entry = journal_service.update_draft(
            db, entry_id=entry_id, actor_user_id=current.id,
            entry_date=body.date, description=body.description,
            branch_id=body.branch_id, journal_id=body.journal_id,
            partner_kind=body.partner_kind, partner_id=body.partner_id,
            invoice_date_due=body.due_date,
            lines=None if body.lines is None else [
                JournalLineInput(l.account_id, l.direction, l.amount, l.statement,
                                 l.cost_center_id, l.partner_kind, l.partner_id)
                for l in body.lines
            ],
        )
    except JournalError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "journal_invalid", "message": str(exc)})
    db.commit()
    return _entry_out(entry, _partner_names(db, [entry]))


@router.post("/journal-entries/{entry_id}/post", response_model=JournalEntryOut)
def post_draft_entry(
    entry_id: int,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    """يرحّل مسودة — هنا بيتفرض التوازن وبيتصرف رقم الدفتر."""
    existing = db.get(LedgerEntry, entry_id)
    if existing is not None:
        _ensure_accounting_branch(current, existing.branch_id)
    try:
        entry = journal_service.post_draft(db, entry_id=entry_id, actor_user_id=current.id)
    except JournalError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "journal_invalid", "message": str(exc)})
    db.commit()
    return _entry_out(entry, _partner_names(db, [entry]))


@router.post("/journal-entries/{entry_id}/reset-to-draft", response_model=JournalEntryOut)
def reset_entry_to_draft(
    entry_id: int,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_REVERSE)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    """يرجّع قيد مرحّل لمسودة — بيخرج من الحسابات ورقمه بيفضل محجوز."""
    existing = db.get(LedgerEntry, entry_id)
    if existing is not None:
        _ensure_accounting_branch(current, existing.branch_id)
    try:
        entry = journal_service.reset_to_draft(db, entry_id=entry_id, actor_user_id=current.id)
    except JournalError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "journal_conflict", "message": str(exc)})
    db.commit()
    return _entry_out(entry, _partner_names(db, [entry]))


@router.post("/journal-entries/{entry_id}/cancel", response_model=JournalEntryOut)
def cancel_journal_entry(
    entry_id: int,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_REVERSE)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    """يلغي قيد — بيخرج من الحسابات وبيفضل موجود برقمه للمراجعة."""
    existing = db.get(LedgerEntry, entry_id)
    if existing is not None:
        _ensure_accounting_branch(current, existing.branch_id)
    try:
        entry = journal_service.cancel_entry(db, entry_id=entry_id, actor_user_id=current.id)
    except JournalError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "journal_conflict", "message": str(exc)})
    db.commit()
    return _entry_out(entry, _partner_names(db, [entry]))


# --- دفاتر اليومية ---------------------------------------------------------------------------


def _journal_out(j: Journal) -> JournalOut:
    return JournalOut(
        id=j.id, code=j.code, name=j.name, kind=j.kind,
        kind_label=JOURNAL_KIND_LABEL.get(j.kind, j.kind),
        active=j.active, is_system=j.is_system, sort_order=j.sort_order,
    )


@router.get("/journals", response_model=list[JournalOut])
def list_journals(
    active: bool | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[JournalOut]:
    journal_registry.ensure_seeded(db)
    db.commit()
    stmt = select(Journal)
    if active is not None:
        stmt = stmt.where(Journal.active.is_(active))
    rows = db.scalars(stmt.order_by(Journal.sort_order, Journal.code)).all()
    return [_journal_out(j) for j in rows]


@router.post("/journals", response_model=JournalOut, status_code=status.HTTP_201_CREATED)
def create_journal(
    body: JournalCreate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> JournalOut:
    code = body.code.strip().upper()
    if db.scalar(select(Journal).where(Journal.code == code)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "duplicate", "message": "فيه دفتر بنفس الكود."})
    if body.kind not in {k.value for k in JournalKind}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "invalid", "message": "نوع الدفتر مش معروف."})
    journal = Journal(code=code, name=body.name.strip(), kind=body.kind,
                      sort_order=body.sort_order, is_system=False, active=True)
    db.add(journal)
    db.commit()
    db.refresh(journal)
    return _journal_out(journal)


@router.patch("/journals/{journal_id}", response_model=JournalOut)
def update_journal(
    journal_id: int,
    body: JournalUpdate,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> JournalOut:
    journal = db.get(Journal, journal_id)
    if journal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "الدفتر مش موجود"})
    if body.name is not None:
        journal.name = body.name.strip()
    if body.kind is not None:
        if body.kind not in {k.value for k in JournalKind}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                {"code": "invalid", "message": "نوع الدفتر مش معروف."})
        journal.kind = body.kind
    if body.sort_order is not None:
        journal.sort_order = body.sort_order
    if body.active is not None:
        # دفتر النظام مايتقفلش: فيه كود بيوجّه قيود عليه، وقفله معناه قيود من غير دفتر.
        if journal.is_system and not body.active:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                {"code": "system_journal", "message": "دفتر النظام مايتقفلش."})
        journal.active = body.active
    db.commit()
    db.refresh(journal)
    return _journal_out(journal)


@router.post("/journal-entries/{entry_id}/reverse", response_model=JournalEntryOut,
             status_code=status.HTTP_201_CREATED)
def reverse_journal_entry(
    entry_id: int,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_REVERSE)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    original = db.get(LedgerEntry, entry_id)
    if original is not None:
        _ensure_accounting_branch(current, original.branch_id)
    try:
        reversal = journal_service.reverse_entry(db, entry_id=entry_id, actor_user_id=current.id)
    except JournalError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "journal_conflict", "message": str(exc)})
    db.commit()
    return _entry_out(reversal, _partner_names(db, [reversal]))


# --- Opening balances ------------------------------------------------------------------------

@router.post("/opening-balances", response_model=JournalEntryOut, status_code=status.HTTP_201_CREATED)
def post_opening_balances(
    body: OpeningBalancesCreate,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    if body.branch_id is not None:
        _ensure_accounting_branch(current, body.branch_id)
    try:
        entry = opening_balance_service.post_opening_balances(
            db,
            entry_date=body.date,
            branch_id=body.branch_id,
            lines=[OpeningLineInput(l.account_id, l.amount) for l in body.lines],
            actor_user_id=current.id,
        )
    except JournalError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "opening_invalid", "message": str(exc)})
    db.commit()
    return _entry_out(entry, _partner_names(db, [entry]))


# --- Trial balance ---------------------------------------------------------------------------

@router.get("/trial-balance", response_model=TrialBalanceOut)
def get_trial_balance(
    from_: date = Query(alias="from"),
    to: date = Query(...),
    branch_id: int | None = None,
    include_groups: bool = True,
    cost_center_id: int | None = None,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_TRIAL_BALANCE_READ)),
    db: Session = Depends(get_db),
) -> TrialBalanceOut:
    # A branch-scoped accountant sees only their own branch; System Admin and a company-wide
    # accountant (no branch assigned) may pass any branch_id or omit it for all branches.
    if not current.is_admin and current.branch_id is not None:
        branch_id = current.branch_id
    result = trial_balance_service.trial_balance(
        db, from_date=from_, to_date=to, branch_id=branch_id, include_groups=include_groups,
        cost_center_id=cost_center_id,
    )
    return TrialBalanceOut(
        from_=result.from_date,
        to=result.to_date,
        branch_id=result.branch_id,
        rows=[
            TrialBalanceRowOut(
                account_id=r.account_id, code=r.code, name=r.name, is_postable=r.is_postable,
                opening=r.opening, period_debit=r.period_debit, period_credit=r.period_credit,
                closing=r.closing, nature=r.nature,
            )
            for r in result.rows
        ],
        grand_total_debit=result.grand_total_debit,
        grand_total_credit=result.grand_total_credit,
        balanced=result.balanced,
    )


# ---------------------------------------------------------------------------
# التوجيه المحاسبي — which account each posting role uses.
# ---------------------------------------------------------------------------
class RoutingOut(BaseModel):
    role: str
    label: str
    account_id: int
    account_code: str
    account_name: str
    # "default" = the account this system seeded; "configured" = one an admin pointed it at. The
    # two are indistinguishable once posted, and an admin chasing a wrong statement needs to know
    # whether somebody changed this or nobody ever did.
    source: str
    nature_warning: str | None = None


class RoutingIn(BaseModel):
    role: str
    # None restores the default — the way back when a role is pointed somewhere wrong.
    account_id: int | None = None


@router.get("/account-routing", response_model=list[RoutingOut])
def read_account_routing(
    branch_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[RoutingOut]:
    """كل دور محاسبي والحساب اللي بيترحّل عليه فعلاً."""
    rows = account_routing_service.current_routing(db, branch_id=branch_id)
    db.commit()  # get-or-create may have seeded a default account on first read
    return [RoutingOut(**r) for r in rows]


@router.put("/account-routing", response_model=list[RoutingOut])
def set_account_routing(
    body: RoutingIn,
    branch_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> list[RoutingOut]:
    """وجّه دور لحساب، أو ابعت account_id فاضي للرجوع للافتراضي.

    Returns the full routing rather than the one row, so the caller never has to guess whether the
    rest still says what it said before the change.
    """
    try:
        account_routing_service.set_routing(
            db, body.role, account_id=body.account_id, branch_id=branch_id)
    except RoutingError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "routing_invalid", "message": str(exc)}) from exc
    rows = account_routing_service.current_routing(db, branch_id=branch_id)
    db.commit()
    return [RoutingOut(**r) for r in rows]
