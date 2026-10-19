from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_VOUCHER_READ, CAP_VOUCHER_WRITE
from src.core.db import get_db
from src.models.customer import Customer
from src.models.ledger import Account
from src.models.role import RoleName
from src.models.settlement_discount import SettlementDiscount
from src.models.supplier import Supplier
from src.services import settlement_discount_service as svc
from src.services.ledger_service import LedgerError
from src.services.settlement_discount_service import DiscountError

router = APIRouter(tags=["settlement-discounts"], prefix="/settlement-discounts")


class DiscountIn(BaseModel):
    kind: str = Field(pattern="^(allowed|earned)$")
    discount_date: date | None = None
    customer_id: int | None = None
    supplier_id: int | None = None
    amount: Decimal
    discount_account_id: int | None = None
    external_document_number: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)


class DiscountOut(BaseModel):
    id: int
    document_number: str
    kind: str
    discount_date: date
    branch_id: int | None = None
    customer_id: int | None = None
    supplier_id: int | None = None
    party_name: str | None = None
    discount_account_id: int
    discount_account_name: str | None = None
    amount: Decimal
    external_document_number: str | None = None
    notes: str | None = None
    ledger_entry_id: int | None = None
    created_at: str | None = None


class AccountOption(BaseModel):
    id: int
    name: str | None = None
    code: str | None = None


class AccountChoices(BaseModel):
    accounts: list[AccountOption]
    default_id: int | None = None


def _names(db: Session, docs: list[SettlementDiscount]) -> dict:
    acc_ids = {d.discount_account_id for d in docs}
    cus_ids = {d.customer_id for d in docs if d.customer_id}
    sup_ids = {d.supplier_id for d in docs if d.supplier_id}
    return {
        "accounts": {a.id: (a.name or a.code) for a in db.scalars(
            select(Account).where(Account.id.in_(acc_ids or {0}))).all()},
        "customers": {c.id: c.name for c in db.scalars(
            select(Customer).where(Customer.id.in_(cus_ids or {0}))).all()},
        "suppliers": {s.id: s.name for s in db.scalars(
            select(Supplier).where(Supplier.id.in_(sup_ids or {0}))).all()},
    }


def _out(db: Session, d: SettlementDiscount, names: dict | None = None) -> DiscountOut:
    names = names if names is not None else _names(db, [d])
    party = (names["customers"].get(d.customer_id) if d.customer_id
             else names["suppliers"].get(d.supplier_id))
    return DiscountOut(
        id=d.id, document_number=d.document_number, kind=d.kind,
        discount_date=d.discount_date, branch_id=d.branch_id, customer_id=d.customer_id,
        supplier_id=d.supplier_id, party_name=party,
        discount_account_id=d.discount_account_id,
        discount_account_name=names["accounts"].get(d.discount_account_id),
        amount=d.amount, external_document_number=d.external_document_number,
        notes=d.notes, ledger_entry_id=d.ledger_entry_id,
        created_at=str(d.created_at) if d.created_at else None)


def _refused(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT,
                         {"code": "discount_refused", "message": str(exc)})


def _office_only(current: CurrentUser) -> None:
    if current.role == RoleName.sales_rep:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "الخصومات من المكتب فقط."})


def _seen(db: Session, current: CurrentUser, doc_id: int) -> SettlementDiscount:
    d = db.get(SettlementDiscount, doc_id)
    if d is None or not branch_scope.visible(current, [d]):
        raise HTTPException(404, {"code": "not_found", "message": "مستند الخصم غير موجود."})
    return d


@router.get("", response_model=list[DiscountOut])
def list_discounts(
    kind: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[DiscountOut]:
    stmt = select(SettlementDiscount)
    if kind:
        stmt = stmt.where(SettlementDiscount.kind == kind)
    if date_from:
        stmt = stmt.where(SettlementDiscount.discount_date >= date_from)
    if date_to:
        stmt = stmt.where(SettlementDiscount.discount_date <= date_to)
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        stmt = stmt.where(SettlementDiscount.branch_id == bid)
    docs = list(db.scalars(stmt.order_by(SettlementDiscount.discount_date.desc(),
                                         SettlementDiscount.id.desc())).all())
    names = _names(db, docs)
    return [_out(db, d, names) for d in docs]


@router.get("/accounts", response_model=AccountChoices)
def discount_accounts(
    kind: str = Query(..., pattern="^(allowed|earned)$"),
    customer_id: int | None = Query(None),
    supplier_id: int | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> AccountChoices:
    try:
        party, _, branch_id = svc.party_branch(db, kind, customer_id, supplier_id)
    except DiscountError as exc:
        raise _refused(exc)
    options = svc.discount_accounts(db, kind, branch_id)
    default = svc.default_account(db, kind, branch_id, party.name)
    return AccountChoices(
        accounts=[AccountOption(id=a.id, name=a.name, code=a.code) for a in options],
        default_id=default.id if default is not None else None)


@router.get("/{doc_id}", response_model=DiscountOut)
def get_discount(
    doc_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> DiscountOut:
    return _out(db, _seen(db, current, doc_id))


@router.post("", response_model=DiscountOut, status_code=status.HTTP_201_CREATED)
def create_discount(
    body: DiscountIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> DiscountOut:
    _office_only(current)
    try:
        d = svc.create(db, kind=body.kind, customer_id=body.customer_id,
                       supplier_id=body.supplier_id, amount=body.amount,
                       discount_account_id=body.discount_account_id,
                       discount_date=body.discount_date,
                       external_document_number=body.external_document_number,
                       notes=body.notes, actor_user_id=current.id)
    except (DiscountError, LedgerError) as exc:
        db.rollback()
        raise _refused(exc)
    db.commit()
    return _out(db, d)


@router.put("/{doc_id}", response_model=DiscountOut)
def update_discount(
    doc_id: int,
    body: DiscountIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> DiscountOut:
    _office_only(current)
    d = _seen(db, current, doc_id)
    try:
        d = svc.update(db, d, customer_id=body.customer_id, supplier_id=body.supplier_id,
                       amount=body.amount, discount_account_id=body.discount_account_id,
                       discount_date=body.discount_date,
                       external_document_number=body.external_document_number,
                       notes=body.notes, actor_user_id=current.id)
    except (DiscountError, LedgerError) as exc:
        db.rollback()
        raise _refused(exc)
    db.commit()
    return _out(db, d)


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_discount(
    doc_id: int,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    _office_only(current)
    d = _seen(db, current, doc_id)
    try:
        svc.delete(db, d, actor_user_id=current.id)
    except (DiscountError, LedgerError) as exc:
        db.rollback()
        raise _refused(exc)
    db.commit()
