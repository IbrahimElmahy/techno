from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_VOUCHER_READ, CAP_VOUCHER_WRITE
from src.core.db import get_db
from src.models.expense_bill import ExpenseBill
from src.models.ledger import Account
from src.models.role import RoleName
from src.models.supplier import Supplier
from src.services import expense_bill_service
from src.services.expense_bill_service import BillLineInput, ExpenseBillError
from src.services.ledger_service import LedgerError

router = APIRouter(tags=["expense-bills"], prefix="/expense-bills")


class BillLineIn(BaseModel):
    account_id: int
    amount: Decimal
    description: str | None = Field(default=None, max_length=240)
    cost_center_id: int | None = None


class BillIn(BaseModel):
    bill_date: date | None = None
    supplier_id: int | None = None
    creditor_account_id: int | None = None
    lines: list[BillLineIn]
    cash_amount: Decimal = Decimal("0")
    treasury_id: int | None = None
    external_document_number: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)


class BillLineOut(BaseModel):
    id: int
    account_id: int
    account_name: str | None = None
    amount: Decimal
    description: str | None = None
    cost_center_id: int | None = None


class BillOut(BaseModel):
    id: int
    document_number: str
    bill_date: date
    branch_id: int | None = None
    supplier_id: int | None = None
    creditor_account_id: int
    creditor_name: str | None = None
    total: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    treasury_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    ledger_entry_id: int | None = None
    created_at: str | None = None
    lines: list[BillLineOut] = []


def _out(db: Session, b: ExpenseBill, names: dict | None = None) -> BillOut:
    names = names if names is not None else _names(db, [b])
    creditor = (names["suppliers"].get(b.supplier_id) if b.supplier_id
                else names["accounts"].get(b.creditor_account_id))
    return BillOut(
        id=b.id, document_number=b.document_number, bill_date=b.bill_date,
        branch_id=b.branch_id, supplier_id=b.supplier_id,
        creditor_account_id=b.creditor_account_id, creditor_name=creditor,
        total=b.total, cash_amount=b.cash_amount, credit_amount=b.credit_amount,
        treasury_id=b.treasury_id, external_document_number=b.external_document_number,
        notes=b.notes, ledger_entry_id=b.ledger_entry_id,
        created_at=str(b.created_at) if b.created_at else None,
        lines=[BillLineOut(id=ln.id, account_id=ln.account_id,
                           account_name=names["accounts"].get(ln.account_id),
                           amount=ln.amount, description=ln.description,
                           cost_center_id=ln.cost_center_id) for ln in b.lines],
    )


def _names(db: Session, bills: list[ExpenseBill]) -> dict:
    acc_ids = {b.creditor_account_id for b in bills} | {ln.account_id for b in bills
                                                        for ln in b.lines}
    sup_ids = {b.supplier_id for b in bills if b.supplier_id}
    accounts = {a.id: (a.name or a.code) for a in db.scalars(
        select(Account).where(Account.id.in_(acc_ids or {0}))).all()}
    suppliers = {s.id: s.name for s in db.scalars(
        select(Supplier).where(Supplier.id.in_(sup_ids or {0}))).all()}
    return {"accounts": accounts, "suppliers": suppliers}


def _refused(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT,
                         {"code": "expense_bill_refused", "message": str(exc)})


def _office_only(current: CurrentUser) -> None:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "فواتير المصروفات من المكتب فقط."})


def _seen(db: Session, current: CurrentUser, bill_id: int) -> ExpenseBill:
    b = db.get(ExpenseBill, bill_id)
    if b is None or not branch_scope.visible(current, [b]):
        raise HTTPException(404, {"code": "not_found", "message": "فاتورة المصروف غير موجودة."})
    return b


def _inputs(body: BillIn) -> dict:
    return {
        "lines": [BillLineInput(account_id=ln.account_id, amount=ln.amount,
                                description=ln.description, cost_center_id=ln.cost_center_id)
                  for ln in body.lines],
        "supplier_id": body.supplier_id, "creditor_account_id": body.creditor_account_id,
        "cash_amount": body.cash_amount, "treasury_id": body.treasury_id,
        "bill_date": body.bill_date,
        "external_document_number": body.external_document_number, "notes": body.notes,
    }


@router.get("", response_model=list[BillOut])
def list_bills(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    supplier_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[BillOut]:
    stmt = select(ExpenseBill).options(selectinload(ExpenseBill.lines))
    if date_from:
        stmt = stmt.where(ExpenseBill.bill_date >= date_from)
    if date_to:
        stmt = stmt.where(ExpenseBill.bill_date <= date_to)
    if supplier_id:
        stmt = stmt.where(ExpenseBill.supplier_id == supplier_id)
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        stmt = stmt.where(ExpenseBill.branch_id == bid)
    bills = list(db.scalars(stmt.order_by(ExpenseBill.bill_date.desc(),
                                          ExpenseBill.id.desc())).all())
    names = _names(db, bills)
    return [_out(db, b, names) for b in bills]


@router.get("/{bill_id}", response_model=BillOut)
def get_bill(
    bill_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> BillOut:
    return _out(db, _seen(db, current, bill_id))


@router.post("", response_model=BillOut, status_code=status.HTTP_201_CREATED)
def create_bill(
    body: BillIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> BillOut:
    _office_only(current)
    try:
        b = expense_bill_service.create(db, **_inputs(body), actor_user_id=current.id,
                                        actor_role=current.role)
    except (ExpenseBillError, LedgerError) as exc:
        db.rollback()
        raise _refused(exc)
    db.commit()
    return _out(db, b)


@router.put("/{bill_id}", response_model=BillOut)
def update_bill(
    bill_id: int,
    body: BillIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> BillOut:
    _office_only(current)
    b = _seen(db, current, bill_id)
    try:
        b = expense_bill_service.update(db, b, **_inputs(body), actor_user_id=current.id,
                                        actor_role=current.role)
    except (ExpenseBillError, LedgerError) as exc:
        db.rollback()
        raise _refused(exc)
    db.commit()
    return _out(db, b)


@router.delete("/{bill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bill(
    bill_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    _office_only(current)
    b = _seen(db, current, bill_id)
    try:
        expense_bill_service.delete(db, b, actor_user_id=current.id)
    except (ExpenseBillError, LedgerError) as exc:
        db.rollback()
        raise _refused(exc)
    db.commit()
