from __future__ import annotations

import dataclasses

from dataclasses import replace
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_VOUCHER_READ, CAP_VOUCHER_WRITE
from src.core.db import get_db
from src.core.fast_json import model_json
from src.models.ledger import Account
from src.models.role import RoleName
from src.models.treasury import TreasuryKind
from src.models.voucher import Voucher, VoucherKind
from src.auth import branch_scope
from src.services import (
    chart_service,
    document_resolver,
    ledger_service,
    lock_date_service,
    statement_service,
    treasury_service,
    voucher_service,
)
from src.services.ledger_service import LedgerError
from src.services import document_edit_service
from src.services.document_edit_service import DocumentEditError
from src.services.statement_service import StatementError
from src.services.treasury_service import TreasuryError
from src.services.voucher_service import VoucherError

router = APIRouter(tags=["vouchers"])


class ReceiptIn(BaseModel):
    family: str | None = None
    on_total: bool = False
    customer_id: int | None = None
    supplier_id: int | None = None
    account_id: int | None = None
    amount: Decimal
    treasury_id: int | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=32)
    client_uuid: str | None = None
    cost_center_id: int | None = None
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)
    rep_user_id: int | None = None


class PaymentIn(BaseModel):
    supplier_id: int | None = None
    customer_id: int | None = None
    account_id: int | None = None
    family: str | None = None
    amount: Decimal
    treasury_id: int | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=32)
    cost_center_id: int | None = None
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)


class HandoverIn(BaseModel):
    rep_user_id: int
    amount: Decimal
    family: str | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    cost_center_id: int | None = None
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)


class ExpenseIn(BaseModel):
    expense_account_id: int
    amount: Decimal
    treasury_id: int | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=32)
    cost_center_id: int | None = None
    cost_center_distribution: dict[str, Decimal] | None = None
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)


class CashTransferIn(BaseModel):
    from_treasury_id: int
    to_treasury_id: int
    amount: Decimal
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    cost_center_id: int | None = None
    statement1: str | None = Field(default=None, max_length=200)
    external_document_number: str | None = Field(default=None, max_length=40)


class TreasuryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: TreasuryKind = TreasuryKind.cash
    branch_id: int | None = None
    bank_name: str | None = Field(default=None, max_length=120)
    account_number: str | None = Field(default=None, max_length=60)
    is_default: bool = False


class TreasuryPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    bank_name: str | None = Field(default=None, max_length=120)
    account_number: str | None = Field(default=None, max_length=60)
    is_default: bool | None = None
    active: bool | None = None
    branch_id: int | None = None


class TreasuryOut(BaseModel):
    id: int
    name: str
    kind: TreasuryKind
    branch_id: int | None
    account_id: int
    bank_name: str | None
    account_number: str | None
    is_default: bool
    active: bool
    balance: Decimal


class PeriodLockIn(BaseModel):
    locked_through: date
    note: str | None = Field(default=None, max_length=255)


class PeriodLockOut(BaseModel):
    locked_through: date | None
    note: str | None = None


class VoucherOut(BaseModel):
    id: int
    document_number: str
    kind: VoucherKind
    amount: Decimal
    customer_id: int | None
    supplier_id: int | None
    rep_user_id: int | None
    treasury_id: int | None = None
    to_treasury_id: int | None = None
    voucher_date: date
    payment_method: str | None
    reference: str | None
    description: str | None
    family: str | None = None
    cost_center_id: int | None = None
    statement1: str | None = None
    external_document_number: str | None = None
    ledger_entry_id: int | None
    is_reversal: bool


class StatementLineOut(BaseModel):
    entry_id: int
    doc_kind: str | None = None
    doc_id: int | None = None
    doc_number: str | None = None
    doc_family: str | None = None
    voucher_kind: str | None = None
    entry_date: date
    entry_type: str
    description: str
    doc_statement: str | None = None
    debit: Decimal
    credit: Decimal
    balance_before: Decimal
    balance: Decimal
    cost_center_id: int | None = None
    cost_center_name: str | None = None
    rep_user_id: int | None = None
    rep_name: str | None = None
    store_name: str | None = None
    cash_on_invoice: bool = False
    account_id: int | None = None
    account_name: str | None = None
    line_id: int | None = None
    residual: Decimal | None = None
    due_date: date | None = None
    days_overdue: int | None = None
    payment_state: str | None = None
    payment_state_label: str | None = None
    matches: list[dict] = []
    account_balance_before: Decimal | None = None
    account_balance: Decimal | None = None


class AccountSummaryOut(BaseModel):
    account_id: int
    account_name: str
    code: str | None = None
    normal_side: str
    opening: Decimal
    debit: Decimal
    credit: Decimal
    closing: Decimal
    lines: int = 0


class AgingOut(BaseModel):
    current: Decimal = Decimal("0")
    d30: Decimal = Decimal("0")
    d60: Decimal = Decimal("0")
    d90: Decimal = Decimal("0")
    older: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    debit_open: Decimal = Decimal("0")
    credit_open: Decimal = Decimal("0")


class FamilyBalanceOut(BaseModel):
    family: str | None = None
    account_id: int
    balance: Decimal


class StatementOut(BaseModel):
    account_id: int | None = None
    account_name: str = ""
    main_account_id: int | None = None
    main_account_name: str | None = None
    opening_balance: Decimal
    closing_balance: Decimal
    total_debit: Decimal
    total_credit: Decimal
    lines: list[StatementLineOut]
    family: str | None = None
    families: list[FamilyBalanceOut] = []
    customer_id: int | None = None
    total_due: Decimal = Decimal("0")
    total_overdue: Decimal = Decimal("0")
    aging: AgingOut = AgingOut()
    reconcilable: bool = False
    normal_side: str | None = None
    account_summaries: list[AccountSummaryOut] = []


def _out(v) -> VoucherOut:
    return VoucherOut(
        id=v.id, document_number=v.document_number, kind=v.kind, amount=v.amount,
        customer_id=v.customer_id, supplier_id=v.supplier_id, rep_user_id=v.rep_user_id,
        treasury_id=v.treasury_id, to_treasury_id=v.to_treasury_id,
        voucher_date=v.voucher_date, payment_method=v.payment_method, reference=v.reference,
        description=v.description, ledger_entry_id=v.ledger_entry_id,
        family=getattr(v, "family", None),
        cost_center_id=getattr(v, "cost_center_id", None),
        statement1=getattr(v, "statement1", None),
        external_document_number=getattr(v, "external_document_number", None),
        is_reversal=v.reverses_id is not None,
    )


def _treasury_out(db: Session, t) -> TreasuryOut:
    return TreasuryOut(
        id=t.id, name=t.name, kind=t.kind, branch_id=t.branch_id, account_id=t.account_id,
        bank_name=t.bank_name, account_number=t.account_number, is_default=t.is_default,
        active=t.active, balance=treasury_service.balance(db, t),
    )


def _statement_out(s, docs: dict | None = None, reps: dict | None = None,
                   stores: dict | None = None) -> StatementOut:
    docs = docs or {}
    reps = reps or {}
    stores = stores or {}
    return StatementOut(
        account_id=s.account_id, account_name=s.account_name,
        main_account_id=getattr(s, "main_account_id", None),
        main_account_name=getattr(s, "main_account_name", None),
        opening_balance=s.opening_balance,
        closing_balance=s.closing_balance, total_debit=s.total_debit,
        total_credit=s.total_credit,
        lines=[StatementLineOut(
            entry_id=ln.entry_id, entry_date=ln.entry_date, entry_type=ln.entry_type,
            description=ln.description, debit=ln.debit, credit=ln.credit,
            balance_before=ln.balance_before, balance=ln.balance,
            doc_kind=(docs.get(ln.entry_id) or {}).get("kind"),
            doc_id=(docs.get(ln.entry_id) or {}).get("id"),
            doc_number=(docs.get(ln.entry_id) or {}).get("document_number"),
            doc_statement=(docs.get(ln.entry_id) or {}).get("statement"),
            doc_family=(docs.get(ln.entry_id) or {}).get("family"),
            voucher_kind=(docs.get(ln.entry_id) or {}).get("voucher_kind"),
            cost_center_id=ln.cost_center_id, cost_center_name=ln.cost_center_name,
            account_id=getattr(ln, "account_id", None),
            account_name=getattr(ln, "account_name", None),
            rep_user_id=((docs.get(ln.entry_id) or {}).get("rep_user_id") or ln.rep_id),
            rep_name=(reps.get((docs.get(ln.entry_id) or {}).get("rep_user_id"))
                      or ln.rep_name),
            store_name=stores.get(ln.entry_id),
            cash_on_invoice=bool(getattr(ln, "cash_on_invoice", False)),
            line_id=getattr(ln, "line_id", None),
            residual=getattr(ln, "residual", None),
            due_date=getattr(ln, "due_date", None),
            days_overdue=getattr(ln, "days_overdue", None),
            payment_state=getattr(ln, "payment_state", None),
            payment_state_label=getattr(ln, "payment_state_label", None),
            matches=list(getattr(ln, "matches", ()) or ()),
            account_balance_before=getattr(ln, "account_balance_before", None),
            account_balance=getattr(ln, "account_balance", None))
            for ln in s.lines],
        normal_side=getattr(s, "normal_side", None),
        account_summaries=[AccountSummaryOut(**dataclasses.asdict(a))
                           for a in getattr(s, "account_summaries", ()) or ()],
        total_due=getattr(s, "total_due", Decimal("0")),
        total_overdue=getattr(s, "total_overdue", Decimal("0")),
        aging=(AgingOut(**dataclasses.asdict(s.aging))
               if getattr(s, "aging", None) is not None else AgingOut()),
        reconcilable=bool(getattr(s, "reconcilable", False)),
    )


def _with_docs(db: Session, s) -> StatementOut:
    docs = document_resolver.resolve_many(db, [ln.entry_id for ln in s.lines])
    rep_ids = {d.get("rep_user_id") for d in docs.values() if d.get("rep_user_id")}
    reps: dict[int, str] = {}
    if rep_ids:
        from src.models.user import User
        reps = {u.id: (u.full_name or u.username)
                for u in db.scalars(select(User).where(User.id.in_(rep_ids))).all()}
    return _statement_out(s, docs, reps, _stores_of(db, s, docs))


def _stores_of(db: Session, s, docs: dict) -> dict[int, str]:
    from src.models.stock import LocationKind
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse
    from src.services.rep_store_service import rep_store

    wanted: dict[int, tuple] = {}
    rep_cache: dict[int, tuple | None] = {}
    rep_of_entry = {ln.entry_id: ln.rep_id for ln in s.lines}
    for entry_id, d in docs.items():
        if d.get("origin_kind") and d.get("origin_id"):
            wanted[entry_id] = (d["origin_kind"], int(d["origin_id"]))
        elif d.get("kind") == "voucher":
            rep_id = d.get("rep_user_id") or rep_of_entry.get(entry_id)
            if not rep_id:
                continue
            if rep_id not in rep_cache:
                rep_cache[rep_id] = rep_store(db, rep_id)
            if rep_cache[rep_id] is not None:
                wanted[entry_id] = rep_cache[rep_id]
    if not wanted:
        return {}

    def _kind(k) -> str:
        return k.value if isinstance(k, LocationKind) else str(k)

    wh_ids = {i for k, i in wanted.values() if _kind(k) == "warehouse"}
    cu_ids = {i for k, i in wanted.values() if _kind(k) == "custody"}
    custodies = ({c.id: c for c in db.scalars(
        select(Custody).where(Custody.id.in_(cu_ids))).all()} if cu_ids else {})
    wh_ids |= {c.warehouse_id for c in custodies.values() if c.warehouse_id}
    wh_names = ({w.id: w.name for w in db.scalars(
        select(Warehouse).where(Warehouse.id.in_(wh_ids))).all()} if wh_ids else {})
    rep_ids = {c.rep_id for c in custodies.values() if c.rep_id}
    rep_names = ({u.id: (u.full_name or u.username) for u in db.scalars(
        select(User).where(User.id.in_(rep_ids))).all()} if rep_ids else {})

    out: dict[int, str] = {}
    for entry_id, (k, i) in wanted.items():
        if _kind(k) == "warehouse":
            name = wh_names.get(i)
        else:
            c = custodies.get(i)
            if c is None:
                name = None
            elif c.warehouse_id and wh_names.get(c.warehouse_id):
                name = wh_names[c.warehouse_id]
            else:
                name = f"عهدة {rep_names.get(c.rep_id) or ''}".strip()
        if name:
            out[entry_id] = name
    return out


def _conflict(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT,
                         {"code": "voucher_invalid", "message": str(exc)})


@router.post("/vouchers/receipts", response_model=VoucherOut,
             status_code=status.HTTP_201_CREATED)
def create_receipt(
    body: ReceiptIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    if body.client_uuid:
        seen = db.scalar(select(Voucher).where(Voucher.client_uuid == body.client_uuid))
        if seen is not None:
            return _out(seen)
    try:
        v = voucher_service.create_receipt(
            db, customer_id=body.customer_id, supplier_id=body.supplier_id,
            account_id=body.account_id, amount=body.amount, actor_user_id=current.id,
            actor_role=current.role, treasury_id=body.treasury_id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference, payment_method=body.payment_method,
            family=body.family, on_total=body.on_total,
            client_uuid=body.client_uuid, cost_center_id=body.cost_center_id,
            statement1=body.statement1, external_document_number=body.external_document_number,
            rep_user_id=body.rep_user_id)
    except (VoucherError, LedgerError, TreasuryError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.post("/vouchers/payments", response_model=VoucherOut,
             status_code=status.HTTP_201_CREATED)
def create_payment(
    body: PaymentIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "الصرف للموردين من المكتب فقط."})
    try:
        v = voucher_service.create_payment(
            db, supplier_id=body.supplier_id, customer_id=body.customer_id,
            account_id=body.account_id, family=body.family,
            amount=body.amount, actor_user_id=current.id,
            actor_role=current.role, treasury_id=body.treasury_id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference, payment_method=body.payment_method,
            cost_center_id=body.cost_center_id, statement1=body.statement1, external_document_number=body.external_document_number)
    except (VoucherError, LedgerError, TreasuryError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


def _replace(db: Session, current: CurrentUser, voucher_id: int, kind: VoucherKind,
             fields: dict) -> VoucherOut:
    if current.role == RoleName.sales_rep:
        own = db.get(Voucher, voucher_id)
        if own is not None and current.id not in (own.actor_user_id, own.rep_user_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                {"code": "forbidden", "message": "هذا السند ليس لك."})
    try:
        v = voucher_service.replace_voucher(
            db, voucher_id=voucher_id, kind=kind, editor_user_id=current.id,
            editor_role=current.role, fields=fields)
    except voucher_service.VoucherNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": str(exc)})
    except (VoucherError, LedgerError, TreasuryError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.put("/vouchers/receipts/{voucher_id}", response_model=VoucherOut)
def update_receipt(
    voucher_id: int,
    body: ReceiptIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    return _replace(db, current, voucher_id, VoucherKind.receipt,
                    body.model_dump(exclude={"client_uuid"}))


@router.put("/vouchers/payments/{voucher_id}", response_model=VoucherOut)
def update_payment(
    voucher_id: int,
    body: PaymentIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "الصرف للموردين من المكتب فقط."})
    return _replace(db, current, voucher_id, VoucherKind.payment, body.model_dump())


@router.post("/vouchers/handovers", response_model=VoucherOut,
             status_code=status.HTTP_201_CREATED)
def create_handover(
    body: HandoverIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden", "message": "التوريد يسجله أمين الخزينة عند الاستلام."})
    try:
        v = voucher_service.create_handover(
            db, rep_user_id=body.rep_user_id, amount=body.amount, actor_user_id=current.id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference, family=body.family,
            cost_center_id=body.cost_center_id, statement1=body.statement1, external_document_number=body.external_document_number)
    except (VoucherError, LedgerError, TreasuryError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.post("/vouchers/expenses", response_model=VoucherOut,
             status_code=status.HTTP_201_CREATED)
def create_expense(
    body: ExpenseIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "المصروفات من المكتب فقط."})
    try:
        v = voucher_service.create_expense(
            db, expense_account_id=body.expense_account_id, amount=body.amount,
            actor_user_id=current.id, actor_role=current.role, treasury_id=body.treasury_id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference, payment_method=body.payment_method,
            cost_center_id=body.cost_center_id, statement1=body.statement1, external_document_number=body.external_document_number,
            cost_center_distribution=body.cost_center_distribution)
    except (VoucherError, TreasuryError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.post("/vouchers/transfers", response_model=VoucherOut,
             status_code=status.HTTP_201_CREATED)
def create_cash_transfer(
    body: CashTransferIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "التحويل بين الخزائن من المكتب فقط."})
    try:
        v = voucher_service.create_cash_transfer(
            db, from_treasury_id=body.from_treasury_id, to_treasury_id=body.to_treasury_id,
            amount=body.amount, actor_user_id=current.id, voucher_date=body.voucher_date,
            description=body.description, reference=body.reference,
            cost_center_id=body.cost_center_id, statement1=body.statement1, external_document_number=body.external_document_number)
    except (VoucherError, TreasuryError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.get("/treasuries", response_model=list[TreasuryOut])
def list_treasuries(
    active_only: bool = Query(default=False),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[TreasuryOut]:
    treasury_service.default_treasury(db)
    rows = treasury_service.list_treasuries(db, active_only=active_only)
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        rows = [t for t in rows if t.branch_id in (bid, None)]
    out = [_treasury_out(db, t) for t in rows]
    db.commit()
    return out


class CashAccountOut(BaseModel):
    account_id: int
    code: str | None
    name: str | None
    family: str | None
    rep_id: int | None
    rep_name: str | None


@router.get("/cash-accounts", response_model=list[CashAccountOut])
def list_cash_accounts(
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[CashAccountOut]:
    from src.models.ledger import AccountType
    from src.models.user import User
    from src.models.warehouse import Custody

    accounts = db.scalars(
        select(Account)
        .where(Account.account_type == AccountType.treasury, Account.active.is_(True))
        .order_by(Account.code)
    ).all()
    links = {
        c.account_id: c for c in db.scalars(select(Custody).where(
            Custody.account_id.isnot(None))).all()
    }
    names = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        accounts = [a for a in accounts if a.branch_id in (bid, None)]
    out: list[CashAccountOut] = []
    for a in accounts:
        if not (a.name or "").strip() and not (a.code or "").strip():
            continue
        c = links.get(a.id)
        out.append(CashAccountOut(
            account_id=a.id, code=a.code, name=a.name,
            family=c.family if c is not None else None,
            rep_id=c.rep_id if c is not None else None,
            rep_name=names.get(c.rep_id) if c is not None else None,
        ))
    return out


@router.post("/treasuries", response_model=TreasuryOut, status_code=status.HTTP_201_CREATED)
def create_treasury(
    body: TreasuryIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> TreasuryOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "إدارة الخزائن من المكتب فقط."})
    treasury_service.default_treasury(db)
    try:
        t = treasury_service.create_treasury(
            db, name=body.name, kind=body.kind, branch_id=body.branch_id,
            bank_name=body.bank_name, account_number=body.account_number,
            is_default=body.is_default, actor_user_id=current.id)
    except TreasuryError as exc:
        raise _conflict(exc)
    db.commit()
    return _treasury_out(db, t)


@router.patch("/treasuries/{treasury_id}", response_model=TreasuryOut)
def update_treasury(
    treasury_id: int,
    body: TreasuryPatch,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> TreasuryOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "إدارة الخزائن من المكتب فقط."})
    try:
        t = treasury_service.update_treasury(
            db, treasury_id=treasury_id, actor_user_id=current.id, name=body.name,
            bank_name=body.bank_name, account_number=body.account_number,
            is_default=body.is_default, active=body.active, branch_id=body.branch_id)
    except TreasuryError as exc:
        raise _conflict(exc)
    db.commit()
    return _treasury_out(db, t)


@router.delete("/treasuries/{treasury_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_treasury(
    treasury_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "إدارة الخزائن من المكتب فقط."})
    try:
        treasury_service.delete_treasury(db, treasury_id=treasury_id, actor_user_id=current.id)
    except TreasuryError as exc:
        raise _conflict(exc)
    db.commit()


@router.get("/period-lock", response_model=PeriodLockOut)
def get_period_lock(
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> PeriodLockOut:
    row = lock_date_service.get_settings(db)
    last = treasury_service.current_lock(db)
    db.commit()
    return PeriodLockOut(locked_through=row.period_lock_date,
                         note=last.note if last else None)


@router.post("/period-lock", response_model=PeriodLockOut,
             status_code=status.HTTP_201_CREATED)
def set_period_lock(
    body: PeriodLockIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> PeriodLockOut:
    if current.role not in (RoleName.system_admin, RoleName.accountant):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden", "message": "إقفال الفترة للأدمن أو المحاسب فقط."})
    row = lock_date_service.get_settings(db)
    lock_date_service.set_lock_dates(
        db, actor_user_id=current.id,
        fiscalyear_lock_date=row.fiscalyear_lock_date,
        period_lock_date=body.locked_through,
        note=body.note,
    )
    db.commit()
    return PeriodLockOut(locked_through=body.locked_through, note=body.note)


@router.delete("/vouchers/{voucher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voucher(
    voucher_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        document_edit_service.delete_voucher(
            db, voucher_id=voucher_id, actor_user_id=current.id)
    except DocumentEditError as exc:
        code = 404 if "مش موجود" in str(exc) else status.HTTP_409_CONFLICT
        raise HTTPException(code, {"code": "delete_blocked", "message": str(exc)})
    db.commit()


@router.post("/vouchers/{voucher_id}/reverse", response_model=VoucherOut,
             status_code=status.HTTP_201_CREATED)
def reverse_voucher(
    voucher_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "عكس السندات من المكتب فقط."})
    try:
        v = voucher_service.reverse_voucher(db, voucher_id=voucher_id,
                                            actor_user_id=current.id)
    except (VoucherError, LedgerError, TreasuryError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


class PaginatedVouchersOut(BaseModel):
    rows: list[VoucherOut]
    total: int
    limit: int
    offset: int


@router.get("/vouchers", response_model=None)
def list_vouchers(
    response: Response,
    kind: VoucherKind | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    rep_id: int | None = Query(default=None),
    treasury_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    limit: int | None = Query(default=None),
    offset: int = Query(default=0),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
):
    scope_rep = current.id if current.role == RoleName.sales_rep else rep_id
    rows = voucher_service.list_vouchers(
        db, kind=kind, customer_id=customer_id, supplier_id=supplier_id,
        rep_user_id=scope_rep, treasury_id=treasury_id, date_from=date_from, date_to=date_to)
    if current.role == RoleName.sales_rep:
        rows = [v for v in rows
                if v.actor_user_id == current.id or v.rep_user_id == current.id]
    visible_rows = branch_scope.visible(current, rows)
    total = len(visible_rows)
    response.headers["X-Total-Count"] = str(total)

    if limit is not None:
        clamped_limit = min(limit, 500)
        paged_rows = visible_rows[offset:offset + clamped_limit]
        page = PaginatedVouchersOut(
            rows=[_out(v) for v in paged_rows],
            total=total,
            limit=clamped_limit,
            offset=offset,
        )
        return model_json(page, headers={"X-Total-Count": str(total)})
    return model_json([_out(v) for v in visible_rows], headers={"X-Total-Count": str(total)})


@router.get("/vouchers/{voucher_id}", response_model=VoucherOut)
def get_voucher(
    voucher_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    v = db.get(Voucher, voucher_id)
    if v is not None and current.role == RoleName.sales_rep \
            and current.id not in (v.actor_user_id, v.rep_user_id):
        v = None
    if v is None or not branch_scope.visible(current, [v]):
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "السند غير موجود."})
    return _out(v)


@router.get("/customers/{customer_id}/statement", response_model=StatementOut)
def customer_statement(
    customer_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    family: str | None = Query(default=None, description="أبيض / بولي — اتركها فارغة لعرض الكل"),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    accounts = voucher_service._customer_accounts(db, customer_id)
    if not accounts:
        zero = Decimal("0")
        return StatementOut(
            account_id=None, account_name="", opening_balance=zero, closing_balance=zero,
            total_debit=zero, total_credit=zero, lines=[], family=family, families=[])

    if family:
        chosen = [a for a in accounts if (a.family or "") == family]
        if not chosen:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                {"code": "not_found",
                                 "message": f"ليس للعميل حساب لـ«{family}»"})
    else:
        chosen = accounts

    try:
        s = statement_service.account_statement(
            db, account_id=chosen[0].account_id,
            also_accounts=[a.account_id for a in chosen[1:]],
            date_from=date_from, date_to=date_to)
    except StatementError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": str(exc)}) from exc

    out = _with_docs(db, s)
    out.families = [
        FamilyBalanceOut(
            family=a.family, account_id=a.account_id,
            balance=ledger_service.balance_of(db, a.account_id),
        )
        for a in accounts
    ]
    out.family = family
    return out


@router.get("/accounts-group/statement", response_model=StatementOut)
def account_group_statement(
    owner_group: str | None = Query(default=None),
    root_id: int | None = Query(default=None),
    root_ids: list[int] | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    accounts = db.scalars(select(Account)).all()
    if root_ids:
        by_id = {a.id: a for a in accounts}
        roots = set(root_ids)
        def in_any(a: Account) -> bool:
            cur, hops = a, 0
            while cur is not None and hops < 12:
                if cur.id in roots:
                    return True
                cur = by_id.get(cur.parent_id) if cur.parent_id else None
                hops += 1
            return False
        members = [a for a in accounts if in_any(a) or (
            owner_group and chart_service.owner_group_label(a.account_type) == owner_group)]
        title = next((by_id[r].name for r in root_ids if r in by_id and by_id[r].name), owner_group or "")
    elif owner_group:
        members = [a for a in accounts
                   if chart_service.owner_group_label(a.account_type) == owner_group]
        title = owner_group
    elif root_id is not None:
        by_id = {a.id: a for a in accounts}
        root = by_id.get(root_id)
        if root is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                {"code": "not_found", "message": "الحساب الرئيسي غير موجود"})
        def in_tree(a: Account) -> bool:
            cur, hops = a, 0
            while cur is not None and hops < 12:
                if cur.id == root_id:
                    return True
                cur = by_id.get(cur.parent_id) if cur.parent_id else None
                hops += 1
            return False
        members = [a for a in accounts if in_tree(a)]
        title = root.name or f"#{root_id}"
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "missing_group",
                             "message": "حدد owner_group أو root_id"})
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        members = [a for a in members if a.branch_id in (bid, None)]
    if not members:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "لا توجد حسابات في هذه المجموعة"})

    ids = [a.id for a in members]
    s = statement_service.account_statement(
        db, account_id=ids[0], also_accounts=ids[1:],
        date_from=date_from, date_to=date_to)
    s = replace(s, account_name=title, account_id=(root_id or 0),
                main_account_id=None, main_account_name=None)
    return _with_docs(db, s)


@router.get("/accounts/{account_id}/statement", response_model=StatementOut)
def any_account_statement(
    account_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    all_customer_accounts: bool = Query(
        default=False, description="حساب عميل؟ اعرض كل حساباته (أبيض/بولي) في كشف واحد"),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    from src.models.customer import Customer, CustomerAccount

    link = db.scalars(
        select(CustomerAccount).where(CustomerAccount.account_id == account_id)).first()
    siblings = (voucher_service._customer_accounts(db, link.customer_id)
                if link is not None else [])
    also = ([a.account_id for a in siblings if a.account_id != account_id]
            if all_customer_accounts and len(siblings) > 1 else [])
    try:
        s = statement_service.account_statement(
            db, account_id=account_id, also_accounts=also,
            date_from=date_from, date_to=date_to)
    except StatementError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": str(exc)}) from exc
    out = _with_docs(db, s)
    if link is not None:
        out.customer_id = link.customer_id
        if len(siblings) > 1:
            out.families = [
                FamilyBalanceOut(family=a.family, account_id=a.account_id,
                                 balance=ledger_service.balance_of(db, a.account_id))
                for a in siblings
            ]
            if also:
                cust = db.get(Customer, link.customer_id)
                out.account_name = (
                    f"عميل — {cust.name if cust else link.customer_id} (كل الحسابات)")
    return out


@router.get("/suppliers/{supplier_id}/statement", response_model=StatementOut)
def supplier_statement(
    supplier_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    try:
        account = voucher_service._supplier_account(db, supplier_id)
        s = statement_service.account_statement(
            db, account_id=account.account_id, date_from=date_from, date_to=date_to)
    except (VoucherError, StatementError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": str(exc)})
    return _with_docs(db, s)


@router.get("/reps/{rep_user_id}/cash-statement", response_model=StatementOut)
def rep_cash_statement(
    rep_user_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    family: str | None = Query(default=None, description="أبيض / بولي — صندوق الخط"),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    if current.role == RoleName.sales_rep and current.id != rep_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "عهدة مندوب آخر."})
    from sqlalchemy import select

    from src.models.warehouse import Custody

    custody = db.scalars(
        select(Custody)
        .where(Custody.rep_id == rep_user_id, *([Custody.family == family] if family else []))
        .order_by(*([] if family else [Custody.family.is_(None).desc()]),
                  Custody.active.desc(), Custody.id)
    ).first()
    if custody is None or custody.account_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المندوب ليس له عهدة بحساب نقدي."})
    s = statement_service.account_statement(
        db, account_id=custody.account_id, date_from=date_from, date_to=date_to)
    return _with_docs(db, s)
