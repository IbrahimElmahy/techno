"""Customers router (T050). FR-018–021, FR-020a. No loyalty schema (After-Sales owns it)."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CUSTOMER_READ, CAP_CUSTOMER_REASSIGN, CAP_CUSTOMER_WRITE
from src.core.db import get_db
from src.models.catalog import PriceTier
from src.models.contact import PhoneOwner
from src.models.customer import Customer, CustomerAccount
from src.models.role import Role, RoleName
from src.models.user import User
from src.services import (
    audit_service,
    contact_service,
    customer_profile_service,
    customer_service,
    ledger_service,
)
from src.services.customer_service import CustomerError

router = APIRouter(tags=["customers"], prefix="/customers")


# The card fields read off their العملاء form (031). Shared by create and update so the two can
# never drift apart — a field you can set on creation and not afterwards is a field that quietly
# becomes uneditable.
class _CustomerCard(BaseModel):
    branch_id: int | None = None
    email: str | None = None
    tax_number: str | None = None
    commercial_register: str | None = None
    # NULL is «nothing agreed»; 0 is «agreed, and it is zero». Keeping them distinct is the whole
    # point of leaving these nullable.
    discount_pct: Decimal | None = None
    vat_pct: Decimal | None = None
    is_cash: bool | None = None


class CustomerCreate(_CustomerCard):
    name: str
    customer_type: str  # free string (013) — validated against the lookup list, not an enum
    rep_id: int
    territory_id: int
    phone: str | None = None
    default_price_tier: PriceTier | None = None
    governorate_id: int | None = None     # (v4) detailed address
    markaz: str | None = None
    address: str | None = None
    phones: list[str] | None = None       # (v4) extra numbers


class CustomerUpdate(_CustomerCard):
    name: str | None = None
    phone: str | None = None
    customer_type: str | None = None
    default_price_tier: PriceTier | None = None
    active: bool | None = None
    governorate_id: int | None = None
    markaz: str | None = None
    address: str | None = None
    phones: list[str] | None = None


class CustomerOut(BaseModel):
    id: int
    code: str
    name: str
    customer_type: str
    phone: str | None
    rep_id: int
    territory_id: int
    default_price_tier: PriceTier | None = None
    active: bool
    governorate_id: int | None = None
    markaz: str | None = None
    address: str | None = None
    phones: list[str] = []
    # Card fields (031) — their العملاء form.
    branch_id: int | None = None
    email: str | None = None
    tax_number: str | None = None
    commercial_register: str | None = None
    discount_pct: Decimal | None = None
    vat_pct: Decimal | None = None
    is_cash: bool = False
    # Receivable balance — filled on the list endpoint (one grouped query, not per row).
    balance: Decimal | None = None


class CustomerCreated(CustomerOut):
    duplicate_phone_customer_ids: list[int] = []


class CustomerReassign(BaseModel):
    new_rep_id: int
    new_territory_id: int


class CustomerAccountOut(BaseModel):
    id: int
    customer_id: int
    account_id: int
    balance: Decimal
    balance_derived: bool = True


def _out(c: Customer, db: Session | None = None) -> CustomerOut:
    extra = contact_service.phone_values(db, PhoneOwner.customer, c.id) if db is not None else []
    return CustomerOut(
        id=c.id, code=c.code, name=c.name, customer_type=c.customer_type,
        phone=c.phone, rep_id=c.rep_id, territory_id=c.territory_id,
        default_price_tier=c.default_price_tier, active=c.active,
        governorate_id=c.governorate_id, markaz=c.markaz, address=c.address, phones=extra,
        branch_id=c.branch_id, email=c.email, tax_number=c.tax_number,
        commercial_register=c.commercial_register, discount_pct=c.discount_pct,
        vat_pct=c.vat_pct, is_cash=c.is_cash,
    )


def _apply_card(c: Customer, body: _CustomerCard) -> None:
    """Copy the العملاء card fields onto the customer, skipping the ones not sent.

    Omitted stays omitted: a PATCH that names only the phone must not blank the tax number. That
    does mean these fields cannot be cleared back to NULL through this route — clearing a
    negotiated discount is a different act from not mentioning it, and it deserves its own
    deliberate call rather than being a side effect of leaving a box empty.
    """
    for field in ("branch_id", "email", "tax_number", "commercial_register",
                  "discount_pct", "vat_pct", "is_cash"):
        val = getattr(body, field)
        if val is not None:
            setattr(c, field, val)


def _scope_filter(stmt, current: CurrentUser):
    if current.is_admin:
        return stmt
    if current.rep_id is not None:  # Sales Rep -> only own customers (FR-009)
        return stmt.where(Customer.rep_id == current.rep_id)
    if current.branch_id is not None:  # branch-scoped -> own branch via territory
        from src.models.org import Territory

        branch_territories = select(Territory.id).where(Territory.branch_id == current.branch_id)
        return stmt.where(Customer.territory_id.in_(branch_territories))
    return stmt


@router.get("", response_model=list[CustomerOut])
def list_customers(
    rep_id: int | None = None,
    territory_id: int | None = None,
    q: str | None = None,
    customer_type: str | None = None,
    governorate_id: int | None = None,
    active: bool | None = None,
    balance_filter: str | None = None,  # all | debtors | settled | credit
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> list[CustomerOut]:
    """List customers with search + filters, each carrying its receivable balance.

    `q` matches code/name/phone/markaz/address partially. Balances come from ONE grouped
    query, so filtering by debt costs the same as listing.
    """
    stmt = customer_profile_service.apply_filters(
        _scope_filter(select(Customer), current),
        q=q, customer_type=customer_type, rep_id=rep_id, territory_id=territory_id,
        governorate_id=governorate_id, active=active,
    )
    rows = list(db.scalars(stmt.order_by(Customer.id.desc())).all())
    balances = customer_profile_service.bulk_balances(db, [c.id for c in rows])
    rows = customer_profile_service.filter_by_balance(rows, balances, balance_filter)
    out = []
    for c in rows:
        item = _out(c, db)
        item.balance = balances.get(c.id, Decimal("0.00"))
        out.append(item)
    return out


@router.post("", response_model=CustomerCreated, status_code=status.HTTP_201_CREATED)
def create_customer(
    body: CustomerCreate,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_WRITE)),
    db: Session = Depends(get_db),
) -> CustomerCreated:
    try:
        result = customer_service.create_customer(
            db,
            name=body.name,
            customer_type=body.customer_type,
            rep_id=body.rep_id,
            territory_id=body.territory_id,
            phone=body.phone,
            actor_user_id=current.id,
        )
    except CustomerError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    c = result.customer
    if body.default_price_tier is not None:  # (007)
        c.default_price_tier = body.default_price_tier
    # (v4) detailed address + extra phone numbers
    c.governorate_id = body.governorate_id
    c.markaz = body.markaz
    c.address = body.address
    _apply_card(c, body)
    db.flush()
    contact_service.set_phones(db, PhoneOwner.customer, c.id, body.phones)
    db.commit()
    base = _out(c, db)
    return CustomerCreated(**base.model_dump(),
                           duplicate_phone_customer_ids=result.duplicate_phone_customer_ids)


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_WRITE)),
    db: Session = Depends(get_db),
) -> CustomerOut:
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    if current.rep_id is not None and c.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    if body.name is not None:
        c.name = body.name
    if body.phone is not None:
        c.phone = body.phone
    if body.customer_type is not None:
        try:  # (v4) plumber must stay with an after-sales rep
            customer_service.assert_rep_matches_type(
                db, customer_type=body.customer_type, rep_id=c.rep_id)
        except CustomerError as exc:
            raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
        c.customer_type = body.customer_type
    if body.default_price_tier is not None:  # (007) set the customer's default sale tier
        c.default_price_tier = body.default_price_tier
    if body.active is not None:
        c.active = body.active
    for field in ("governorate_id", "markaz", "address"):  # (v4)
        val = getattr(body, field)
        if val is not None:
            setattr(c, field, val)
    _apply_card(c, body)
    contact_service.set_phones(db, PhoneOwner.customer, c.id, body.phones)
    db.flush()
    audit_service.record(db, action="customer.update", actor_user_id=current.id,
                         entity_type="customer", entity_id=c.id)
    db.commit()
    return _out(c, db)


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_customer(
    customer_id: int,
    hard: bool = False,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """Deactivate the customer; `hard=true` deletes him outright — but only if he never moved."""
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    if current.rep_id is not None and c.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    if hard:
        try:
            customer_service.delete_customer(db, customer=c, actor_user_id=current.id)
        except CustomerError as exc:
            raise HTTPException(409, {"code": "has_history", "message": str(exc)}) from exc
        db.commit()
        return
    c.active = False
    db.flush()
    audit_service.record(db, action="customer.deactivate", actor_user_id=current.id,
                         entity_type="customer", entity_id=c.id)
    db.commit()


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> CustomerOut:
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    if current.rep_id is not None and c.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    return _out(c, db)


@router.post("/{customer_id}/reassign", response_model=CustomerOut)
def reassign_customer(
    customer_id: int,
    body: CustomerReassign,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_REASSIGN)),
    db: Session = Depends(get_db),
) -> CustomerOut:
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    customer_service.reassign_customer(
        db, customer=c, new_rep_id=body.new_rep_id,
        new_territory_id=body.new_territory_id, actor_user_id=current.id,
    )
    db.commit()
    return _out(c)


class CustomerBulkAssign(BaseModel):
    """Assign a batch of customers to one rep — «عملاء المندوب» from the rep's side."""

    rep_id: int
    customer_ids: list[int]
    # Left out, each customer keeps the territory he already had. A rep's round is not the same
    # thing as a customer's area, and moving a hundred customers onto the rep's territory as a
    # side effect of naming their rep would quietly rewrite the sales geography.
    territory_id: int | None = None


@router.post("/assign-rep", response_model=list[CustomerOut])
def assign_customers_to_rep(
    body: CustomerBulkAssign,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_REASSIGN)),
    db: Session = Depends(get_db),
) -> list[CustomerOut]:
    """Point several customers at one rep in a single call.

    All or nothing. Assigning ninety of a hundred customers and failing on the ninety-first
    leaves nobody able to say which ninety moved — so an unknown id, a user who is not a sales
    rep, or a customer type the rep may not hold rejects the whole batch before anything is
    written.
    """
    rep = db.get(User, body.rep_id)
    if rep is None:
        raise HTTPException(404, {"code": "not_found", "message": "Rep not found"})
    role = db.get(Role, rep.role_id)
    if role is None or role.name != RoleName.sales_rep:
        raise HTTPException(422, {"code": "validation", "message": "User is not a sales rep"})

    customers = list(db.scalars(select(Customer).where(Customer.id.in_(body.customer_ids))).all())
    found = {c.id for c in customers}
    missing = [cid for cid in body.customer_ids if cid not in found]
    if missing:
        raise HTTPException(404, {"code": "not_found",
                                  "message": f"Customers not found: {missing}"})

    # (v4) a plumber must stay with an after-sales rep — checked for every customer up front.
    for c in customers:
        try:
            customer_service.assert_rep_matches_type(
                db, customer_type=c.customer_type, rep_id=body.rep_id)
        except CustomerError as exc:
            raise HTTPException(422, {"code": "validation",
                                      "message": f"«{c.name}»: {exc}"}) from exc

    for c in customers:
        customer_service.reassign_customer(
            db, customer=c, new_rep_id=body.rep_id,
            new_territory_id=body.territory_id or c.territory_id,
            actor_user_id=current.id,
        )
    db.commit()
    return [_out(c, db) for c in customers]


class ProfileDocOut(BaseModel):
    id: int
    document_number: str
    doc_date: str | None = None
    amount: Decimal
    detail: str = ""


class CustomerProfileOut(BaseModel):
    """ملف العميل — every movement tied to one customer, in one call."""

    customer: CustomerOut
    account_id: int | None
    balance: Decimal
    points_balance: Decimal
    total_sales: Decimal
    total_returns: Decimal
    total_receipts: Decimal
    invoice_count: int
    last_invoice_date: str | None = None
    invoices: list[ProfileDocOut] = []
    returns: list[ProfileDocOut] = []
    receipts: list[ProfileDocOut] = []
    cheques: list[dict] = []
    coupons: list[dict] = []


def _doc_out(d) -> ProfileDocOut:
    return ProfileDocOut(id=d.id, document_number=d.document_number,
                         doc_date=str(d.doc_date) if d.doc_date else None,
                         amount=d.amount, detail=d.detail)


@router.get("/{customer_id}/profile", response_model=CustomerProfileOut)
def customer_profile(
    customer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> CustomerProfileOut:
    """The customer's full file: balance, invoices, returns, receipts, cheques, visits, points."""
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    if current.rep_id is not None and c.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    p = customer_profile_service.profile(db, customer_id)
    base = _out(c, db)
    base.balance = p.balance
    return CustomerProfileOut(
        customer=base, account_id=p.account_id, balance=p.balance,
        points_balance=p.points_balance, total_sales=p.total_sales,
        total_returns=p.total_returns, total_receipts=p.total_receipts,
        invoice_count=p.invoice_count,
        last_invoice_date=str(p.last_invoice_date) if p.last_invoice_date else None,
        invoices=[_doc_out(d) for d in p.invoices],
        returns=[_doc_out(d) for d in p.returns],
        receipts=[_doc_out(d) for d in p.receipts],
        cheques=p.cheques, coupons=p.coupons,
    )


@router.get("/{customer_id}/records/{kind}/{record_id}")
def customer_record_detail(
    customer_id: int,
    kind: str,
    record_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """Full detail of one row in the customer's file — invoice, return, receipt, cheque,
    inspection, coupon or ledger entry — in a uniform shape the UI renders generically."""
    c = db.get(Customer, customer_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Customer not found"})
    if current.rep_id is not None and c.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    try:
        return customer_profile_service.record_detail(db, customer_id, kind, record_id)
    except customer_profile_service.CustomerProfileError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc


@router.get("/{customer_id}/account", response_model=CustomerAccountOut)
def customer_account(
    customer_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> CustomerAccountOut:
    acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer_id))
    if acc is None:
        raise HTTPException(404, {"code": "not_found", "message": "Account not found"})
    return CustomerAccountOut(
        id=acc.id, customer_id=acc.customer_id, account_id=acc.account_id,
        balance=ledger_service.balance_of(db, acc.account_id),
    )
