"""Cash vouchers + account statements router — 018-finance-vouchers.

سند قبض / سند صرف / توريد المندوب، وكشف حساب العميل والمورد والمندوب.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_VOUCHER_READ, CAP_VOUCHER_WRITE
from src.core.db import get_db
from src.models.role import RoleName
from src.models.treasury import TreasuryKind
from src.models.voucher import VoucherKind
from src.services import statement_service, treasury_service, voucher_service
from src.services.ledger_service import LedgerError
from src.services.statement_service import StatementError
from src.services.treasury_service import TreasuryError
from src.services.voucher_service import VoucherError

router = APIRouter(tags=["vouchers"])


class ReceiptIn(BaseModel):
    customer_id: int
    amount: Decimal
    treasury_id: int | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=32)


class PaymentIn(BaseModel):
    supplier_id: int
    amount: Decimal
    treasury_id: int | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=32)


class HandoverIn(BaseModel):
    rep_user_id: int
    amount: Decimal
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)


class ExpenseIn(BaseModel):
    expense_account_id: int
    amount: Decimal
    treasury_id: int | None = None
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=32)


class CashTransferIn(BaseModel):
    from_treasury_id: int
    to_treasury_id: int
    amount: Decimal
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)


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
    ledger_entry_id: int | None
    is_reversal: bool


class StatementLineOut(BaseModel):
    entry_id: int
    entry_date: date
    entry_type: str
    description: str
    debit: Decimal
    credit: Decimal
    balance: Decimal


class StatementOut(BaseModel):
    account_id: int
    opening_balance: Decimal
    closing_balance: Decimal
    total_debit: Decimal
    total_credit: Decimal
    lines: list[StatementLineOut]


def _out(v) -> VoucherOut:
    return VoucherOut(
        id=v.id, document_number=v.document_number, kind=v.kind, amount=v.amount,
        customer_id=v.customer_id, supplier_id=v.supplier_id, rep_user_id=v.rep_user_id,
        treasury_id=v.treasury_id, to_treasury_id=v.to_treasury_id,
        voucher_date=v.voucher_date, payment_method=v.payment_method, reference=v.reference,
        description=v.description, ledger_entry_id=v.ledger_entry_id,
        is_reversal=v.reverses_id is not None,
    )


def _treasury_out(db: Session, t) -> TreasuryOut:
    return TreasuryOut(
        id=t.id, name=t.name, kind=t.kind, branch_id=t.branch_id, account_id=t.account_id,
        bank_name=t.bank_name, account_number=t.account_number, is_default=t.is_default,
        active=t.active, balance=treasury_service.balance(db, t),
    )


def _statement_out(s) -> StatementOut:
    return StatementOut(
        account_id=s.account_id, opening_balance=s.opening_balance,
        closing_balance=s.closing_balance, total_debit=s.total_debit,
        total_credit=s.total_credit,
        lines=[StatementLineOut(
            entry_id=ln.entry_id, entry_date=ln.entry_date, entry_type=ln.entry_type,
            description=ln.description, debit=ln.debit, credit=ln.credit, balance=ln.balance)
            for ln in s.lines],
    )


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
    """سند قبض — تحصيل من عميل (المندوب يحصّل في عهدته، المكتب في الخزينة)."""
    try:
        v = voucher_service.create_receipt(
            db, customer_id=body.customer_id, amount=body.amount, actor_user_id=current.id,
            actor_role=current.role, treasury_id=body.treasury_id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference, payment_method=body.payment_method)
    except (VoucherError, LedgerError) as exc:
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
    """سند صرف — دفع لمورد (ممنوع على المناديب)."""
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "الصرف للموردين من المكتب فقط."})
    try:
        v = voucher_service.create_payment(
            db, supplier_id=body.supplier_id, amount=body.amount, actor_user_id=current.id,
            actor_role=current.role, treasury_id=body.treasury_id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference, payment_method=body.payment_method)
    except (VoucherError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.post("/vouchers/handovers", response_model=VoucherOut,
             status_code=status.HTTP_201_CREATED)
def create_handover(
    body: HandoverIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> VoucherOut:
    """توريد المندوب — نقل نقدية العهدة لخزينة الشركة (يستلمها المكتب)."""
    if current.role == RoleName.sales_rep:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden", "message": "التوريد يسجله أمين الخزينة عند الاستلام."})
    try:
        v = voucher_service.create_handover(
            db, rep_user_id=body.rep_user_id, amount=body.amount, actor_user_id=current.id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference)
    except (VoucherError, LedgerError) as exc:
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
    """سند مصروف — صرف نثريات/إيجار/مرتبات من الخزينة على حساب مصروف."""
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "المصروفات من المكتب فقط."})
    try:
        v = voucher_service.create_expense(
            db, expense_account_id=body.expense_account_id, amount=body.amount,
            actor_user_id=current.id, actor_role=current.role, treasury_id=body.treasury_id,
            voucher_date=body.voucher_date, description=body.description,
            reference=body.reference, payment_method=body.payment_method)
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
    """تحويل نقدية بين خزينتين."""
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "التحويل بين الخزائن من المكتب فقط."})
    try:
        v = voucher_service.create_cash_transfer(
            db, from_treasury_id=body.from_treasury_id, to_treasury_id=body.to_treasury_id,
            amount=body.amount, actor_user_id=current.id, voucher_date=body.voucher_date,
            description=body.description, reference=body.reference)
    except (VoucherError, TreasuryError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.get("/treasuries", response_model=list[TreasuryOut])
def list_treasuries(
    active_only: bool = Query(default=False),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[TreasuryOut]:
    treasury_service.default_treasury(db)  # adopt the legacy safe on first call
    rows = treasury_service.list_treasuries(db, active_only=active_only)
    out = [_treasury_out(db, t) for t in rows]
    db.commit()
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
            is_default=body.is_default, active=body.active)
    except TreasuryError as exc:
        raise _conflict(exc)
    db.commit()
    return _treasury_out(db, t)


@router.get("/period-lock", response_model=PeriodLockOut)
def get_period_lock(
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> PeriodLockOut:
    lock = treasury_service.current_lock(db)
    return PeriodLockOut(locked_through=lock.locked_through if lock else None,
                         note=lock.note if lock else None)


@router.post("/period-lock", response_model=PeriodLockOut,
             status_code=status.HTTP_201_CREATED)
def set_period_lock(
    body: PeriodLockIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> PeriodLockOut:
    """إقفال الفترة حتى تاريخ — يمنع أي ترحيل بتاريخ أقدم أو مساوٍ (أدمن/محاسب)."""
    if current.role not in (RoleName.system_admin, RoleName.accountant):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "forbidden", "message": "إقفال الفترة للأدمن أو المحاسب فقط."})
    lock = treasury_service.set_lock(db, through=body.locked_through,
                                     actor_user_id=current.id, note=body.note)
    db.commit()
    return PeriodLockOut(locked_through=lock.locked_through, note=lock.note)


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
    except (VoucherError, LedgerError) as exc:
        raise _conflict(exc)
    db.commit()
    return _out(v)


@router.get("/vouchers", response_model=list[VoucherOut])
def list_vouchers(
    kind: VoucherKind | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    supplier_id: int | None = Query(default=None),
    rep_id: int | None = Query(default=None),
    treasury_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[VoucherOut]:
    # A rep only ever sees the vouchers tied to his own custody/collections.
    scope_rep = current.id if current.role == RoleName.sales_rep else rep_id
    rows = voucher_service.list_vouchers(
        db, kind=kind, customer_id=customer_id, supplier_id=supplier_id,
        rep_user_id=scope_rep, treasury_id=treasury_id, date_from=date_from, date_to=date_to)
    if current.role == RoleName.sales_rep:
        rows = [v for v in rows
                if v.actor_user_id == current.id or v.rep_user_id == current.id]
    return [_out(v) for v in rows]


@router.get("/customers/{customer_id}/statement", response_model=StatementOut)
def customer_statement(
    customer_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    """كشف حساب عميل — رصيد أول المدة + الحركة + الرصيد الجاري."""
    try:
        account = voucher_service._customer_account(db, customer_id)
        s = statement_service.account_statement(
            db, account_id=account.account_id, date_from=date_from, date_to=date_to)
    except (VoucherError, StatementError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": str(exc)})
    return _statement_out(s)


@router.get("/suppliers/{supplier_id}/statement", response_model=StatementOut)
def supplier_statement(
    supplier_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    """كشف حساب مورد."""
    try:
        account = voucher_service._supplier_account(db, supplier_id)
        s = statement_service.account_statement(
            db, account_id=account.account_id, date_from=date_from, date_to=date_to)
    except (VoucherError, StatementError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": str(exc)})
    return _statement_out(s)


@router.get("/reps/{rep_user_id}/cash-statement", response_model=StatementOut)
def rep_cash_statement(
    rep_user_id: int,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> StatementOut:
    """كشف عهدة المندوب النقدية — تحصيلاته مقابل توريداته."""
    if current.role == RoleName.sales_rep and current.id != rep_user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "عهدة مندوب آخر."})
    from sqlalchemy import select

    from src.models.warehouse import Custody

    custody = db.scalar(select(Custody).where(Custody.rep_id == rep_user_id))
    if custody is None or custody.account_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المندوب ليس له عهدة بحساب نقدي."})
    s = statement_service.account_statement(
        db, account_id=custody.account_id, date_from=date_from, date_to=date_to)
    return _statement_out(s)
