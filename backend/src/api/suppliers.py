"""Suppliers router (T021). FR-009."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SUPPLIER_READ, CAP_SUPPLIER_WRITE
from src.core.db import get_db
from src.models.contact import PhoneOwner
from src.models.ledger import Account, AccountType, Direction
from src.models.supplier import Supplier, SupplierAccount
from src.services import (
    audit_service,
    contact_service,
    ledger_service,
    supplier_profile_service,
)

router = APIRouter(tags=["suppliers"], prefix="/suppliers")


class SupplierCreate(BaseModel):
    name: str
    phone: str | None = None
    address: str | None = None            # (v4)
    phones: list[str] | None = None       # (v4) extra numbers


class SupplierUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    active: bool | None = None
    address: str | None = None
    phones: list[str] | None = None


class SupplierOut(BaseModel):
    id: int
    code: str
    name: str
    phone: str | None
    active: bool
    address: str | None = None
    phones: list[str] = []
    # Payable balance — filled on the list endpoint (one grouped query, not per row).
    balance: Decimal | None = None


def _sup_out(s: Supplier, db: Session | None = None) -> SupplierOut:
    extra = contact_service.phone_values(db, PhoneOwner.supplier, s.id) if db is not None else []
    return SupplierOut(id=s.id, code=s.code, name=s.name, phone=s.phone, active=s.active,
                       address=s.address, phones=extra)


def _delete_supplier(db: Session, s: Supplier, actor_user_id: int) -> None:
    """Permanently remove a supplier that never moved — otherwise refuse.

    Deleting one with purchases, payments or ledger movement would orphan posted documents
    and silently change the books, so that case stays a deactivation.
    """
    from src.models.cheque import Cheque
    from src.models.ledger import LedgerLine
    from src.models.purchasing import PurchaseInvoice
    from src.models.voucher import Voucher

    blockers: list[str] = []
    checks = [
        ("فواتير شراء", select(func.count()).select_from(PurchaseInvoice)
         .where(PurchaseInvoice.supplier_id == s.id)),
        ("سندات", select(func.count()).select_from(Voucher)
         .where(Voucher.supplier_id == s.id)),
        ("شيكات", select(func.count()).select_from(Cheque)
         .where(Cheque.supplier_id == s.id)),
    ]
    for label, stmt in checks:
        if (db.scalar(stmt) or 0) > 0:
            blockers.append(label)

    link = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == s.id))
    if link is not None:
        moved = db.scalar(select(func.count()).select_from(LedgerLine)
                          .where(LedgerLine.account_id == link.account_id)) or 0
        if moved:
            blockers.append("حركات على الحساب")

    if blockers:
        raise ValueError(
            "لا يمكن حذف المورد نهائياً لوجود " + "، ".join(blockers)
            + ". يمكنك إلغاء تفعيله بدلاً من الحذف."
        )

    audit_service.record(db, action="supplier.delete", actor_user_id=actor_user_id,
                         entity_type="supplier", entity_id=s.id,
                         before={"code": s.code, "name": s.name})
    if link is not None:
        account = db.get(Account, link.account_id)
        db.delete(link)
        db.flush()
        if account is not None:
            db.delete(account)
    db.delete(s)
    db.flush()


class AccountBalanceOut(BaseModel):
    account_id: int
    balance: Decimal
    derived: bool = True


@router.get("", response_model=list[SupplierOut])
def list_suppliers(
    q: str | None = None,
    active: bool | None = None,
    balance_filter: str | None = None,  # all | due | settled | advance
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> list[SupplierOut]:
    """List suppliers with search + filters, each carrying its payable balance."""
    stmt = supplier_profile_service.apply_filters(select(Supplier), q=q, active=active)
    rows = list(db.scalars(stmt.order_by(Supplier.id.desc())).all())
    balances = supplier_profile_service.bulk_balances(db, [s.id for s in rows])
    rows = supplier_profile_service.filter_by_balance(rows, balances, balance_filter)
    out = []
    for s in rows:
        item = _sup_out(s, db)
        item.balance = balances.get(s.id, Decimal("0.00"))
        out.append(item)
    return out


@router.post("", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
def create_supplier(
    body: SupplierCreate,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_WRITE)),
    db: Session = Depends(get_db),
) -> SupplierOut:
    n = db.scalar(select(func.count()).select_from(Supplier)) or 0
    acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit)
    db.add(acc)
    db.flush()
    supplier = Supplier(code=f"SUP-{n + 1:05d}", name=body.name, phone=body.phone,
                        address=body.address)
    db.add(supplier)
    db.flush()
    sa = SupplierAccount(supplier_id=supplier.id, account_id=acc.id)
    db.add(sa)
    db.flush()
    acc.owner_ref = sa.id
    contact_service.set_phones(db, PhoneOwner.supplier, supplier.id, body.phones)
    db.commit()
    return _sup_out(supplier, db)


@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> SupplierOut:
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    return _sup_out(s, db)


@router.patch("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    current: CurrentUser = Depends(require_capability(CAP_SUPPLIER_WRITE)),
    db: Session = Depends(get_db),
) -> SupplierOut:
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    if body.name is not None:
        s.name = body.name
    if body.phone is not None:
        s.phone = body.phone
    if body.active is not None:
        s.active = body.active
    if body.address is not None:
        s.address = body.address
    contact_service.set_phones(db, PhoneOwner.supplier, s.id, body.phones)
    db.flush()
    audit_service.record(db, action="supplier.update", actor_user_id=current.id,
                         entity_type="supplier", entity_id=s.id)
    db.commit()
    return _sup_out(s, db)


class ProfileDocOut(BaseModel):
    id: int
    document_number: str
    doc_date: str | None = None
    amount: Decimal
    detail: str = ""


class SupplierProfileOut(BaseModel):
    """ملف المورد — every movement tied to one supplier, in one call."""

    supplier: SupplierOut
    account_id: int | None
    balance: Decimal
    total_purchases: Decimal
    total_returns: Decimal
    total_payments: Decimal
    invoice_count: int
    last_invoice_date: str | None = None
    purchases: list[ProfileDocOut] = []
    returns: list[ProfileDocOut] = []
    payments: list[ProfileDocOut] = []
    cheques: list[dict] = []


def _doc_out(d) -> ProfileDocOut:
    return ProfileDocOut(id=d.id, document_number=d.document_number,
                         doc_date=str(d.doc_date) if d.doc_date else None,
                         amount=d.amount, detail=d.detail)


@router.get("/{supplier_id}/profile", response_model=SupplierProfileOut)
def supplier_profile(
    supplier_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> SupplierProfileOut:
    """The supplier's full file: balance, purchases, returns, payments, cheques."""
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    p = supplier_profile_service.profile(db, supplier_id)
    base = _sup_out(s, db)
    base.balance = p.balance
    return SupplierProfileOut(
        supplier=base, account_id=p.account_id, balance=p.balance,
        total_purchases=p.total_purchases, total_returns=p.total_returns,
        total_payments=p.total_payments, invoice_count=p.invoice_count,
        last_invoice_date=str(p.last_invoice_date) if p.last_invoice_date else None,
        purchases=[_doc_out(d) for d in p.purchases],
        returns=[_doc_out(d) for d in p.returns],
        payments=[_doc_out(d) for d in p.payments],
        cheques=p.cheques,
    )


@router.get("/{supplier_id}/records/{kind}/{record_id}")
def supplier_record_detail(
    supplier_id: int,
    kind: str,
    record_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """Full detail of one row in the supplier's file — purchase, return, payment, cheque, entry."""
    if db.get(Supplier, supplier_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    try:
        return supplier_profile_service.record_detail(db, supplier_id, kind, record_id)
    except supplier_profile_service.SupplierProfileError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_supplier(
    supplier_id: int,
    hard: bool = False,
    current: CurrentUser = Depends(require_capability(CAP_SUPPLIER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """Deactivate the supplier; `hard=true` deletes him outright — only if he never moved."""
    s = db.get(Supplier, supplier_id)
    if s is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier not found"})
    if hard:
        try:
            _delete_supplier(db, s, current.id)
        except ValueError as exc:
            raise HTTPException(409, {"code": "has_history", "message": str(exc)}) from exc
        db.commit()
        return
    s.active = False
    db.flush()
    audit_service.record(db, action="supplier.deactivate", actor_user_id=current.id,
                         entity_type="supplier", entity_id=s.id)
    db.commit()


@router.get("/{supplier_id}/account", response_model=AccountBalanceOut)
def supplier_account(
    supplier_id: int,
    _: CurrentUser = Depends(require_capability(CAP_SUPPLIER_READ)),
    db: Session = Depends(get_db),
) -> AccountBalanceOut:
    sa = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id))
    if sa is None:
        raise HTTPException(404, {"code": "not_found", "message": "Supplier account not found"})
    return AccountBalanceOut(account_id=sa.account_id, balance=ledger_service.balance_of(db, sa.account_id))
