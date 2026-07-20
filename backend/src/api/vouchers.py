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
from src.models.voucher import VoucherKind
from src.services import statement_service, voucher_service
from src.services.ledger_service import LedgerError
from src.services.statement_service import StatementError
from src.services.voucher_service import VoucherError

router = APIRouter(tags=["vouchers"])


class ReceiptIn(BaseModel):
    customer_id: int
    amount: Decimal
    voucher_date: date | None = None
    description: str | None = Field(default=None, max_length=255)
    reference: str | None = Field(default=None, max_length=80)
    payment_method: str | None = Field(default=None, max_length=32)


class PaymentIn(BaseModel):
    supplier_id: int
    amount: Decimal
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


class VoucherOut(BaseModel):
    id: int
    document_number: str
    kind: VoucherKind
    amount: Decimal
    customer_id: int | None
    supplier_id: int | None
    rep_user_id: int | None
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
        voucher_date=v.voucher_date, payment_method=v.payment_method, reference=v.reference,
        description=v.description, ledger_entry_id=v.ledger_entry_id,
        is_reversal=v.reverses_id is not None,
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
            actor_role=current.role, voucher_date=body.voucher_date,
            description=body.description, reference=body.reference,
            payment_method=body.payment_method)
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
            actor_role=current.role, voucher_date=body.voucher_date,
            description=body.description, reference=body.reference,
            payment_method=body.payment_method)
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
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[VoucherOut]:
    # A rep only ever sees the vouchers tied to his own custody/collections.
    scope_rep = current.id if current.role == RoleName.sales_rep else rep_id
    rows = voucher_service.list_vouchers(
        db, kind=kind, customer_id=customer_id, supplier_id=supplier_id,
        rep_user_id=scope_rep, date_from=date_from, date_to=date_to)
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
