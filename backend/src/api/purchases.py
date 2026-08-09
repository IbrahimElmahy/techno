"""Purchases router (T024). FR-009–012."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PURCHASE_WRITE, CAP_RETURN_WRITE, CAP_STOCK_READ
from src.core.db import get_db
from src.models.catalog import Item
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.stock import LocationKind
from src.models.supplier import Supplier
from src.services import purchase_service
from src.services.purchase_service import PurchaseError, PurchaseLine
from src.services.stock_service import StockError

router = APIRouter(tags=["purchases"], prefix="/purchases")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class PurchaseLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    unit: str | None = None    # (008) unit of measure; None = base
    warehouse_id: int | None = None   # (030) receive this line into its own warehouse


class PurchaseCreate(BaseModel):
    supplier_id: int
    location: LocationIn
    cash_amount: Decimal
    credit_amount: Decimal
    lines: list[PurchaseLineIn]
    # (030) document fields — the supplier's own invoice number and free text.
    rep_id: int | None = None
    expense_account_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    statement1: str | None = None
    statement2: str | None = None
    statement3: str | None = None
    purchase_date: date | None = None


class ReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal


class ReturnCreate(BaseModel):
    lines: list[ReturnLineIn]
    # The day the goods went back, and why. Both were columns the payload could not reach — the
    # third document in a row to be found in that state.
    return_date: date | None = None
    notes: str | None = None


class DocOut(BaseModel):
    id: int
    document_number: str
    ledger_entry_id: int | None = None


class PurchaseListOut(BaseModel):
    id: int
    document_number: str
    supplier_id: int
    supplier_name: str | None
    total: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    created_at: str
    # (031) The day the goods arrived. `created_at` is when the row was typed, which is a different
    # question and the one nobody was asking.
    purchase_date: str | None = None
    external_document_number: str | None = None
    notes: str | None = None


class PurchaseLineOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal
    unit: str | None = None


class PurchaseReturnOut(BaseModel):
    id: int
    document_number: str
    value: Decimal
    created_at: str


class PurchaseDetailOut(PurchaseListOut):
    location_kind: str
    location_id: int
    lines: list[PurchaseLineOut]
    returns: list[PurchaseReturnOut]


class PurchaseReturnListOut(BaseModel):
    """A purchase return as its own row, for the standalone مردودات شراء register.

    A purchase return is a leaner document than a sales return: no discount, no tax, no cash
    settlement — goods go back to the supplier and what we owe them drops by the value. So this
    carries the value and the purchase it came off, and nothing invented to fill a column.
    """
    id: int
    document_number: str
    purchase_invoice_id: int
    purchase_document_number: str | None
    supplier_id: int | None
    supplier_name: str | None
    value: Decimal
    created_at: str
    # Stored and returned in the same change. The sales return and the purchase were each found
    # storing a date that came back from nothing, so the screen could write it and never see it.
    return_date: date | None = None
    notes: str | None = None


@router.get("", response_model=list[PurchaseListOut])
def list_purchases(
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[PurchaseListOut]:
    names = {s.id: s.name for s in db.scalars(select(Supplier)).all()}
    rows = db.scalars(select(PurchaseInvoice).order_by(PurchaseInvoice.id.desc())).all()
    return [
        PurchaseListOut(
            id=p.id, document_number=p.document_number, supplier_id=p.supplier_id,
            supplier_name=names.get(p.supplier_id), total=p.total, cash_amount=p.cash_amount,
            credit_amount=p.credit_amount, created_at=str(p.created_at),
            purchase_date=str(p.purchase_date) if p.purchase_date else None,
            external_document_number=p.external_document_number, notes=p.notes,
        )
        for p in rows
    ]


# Declared BEFORE `/{purchase_id}` on purpose: FastAPI matches in declaration order, and a later
# `/returns` would be swallowed by the id route and fail parsing "returns" as an int.
@router.get("/returns", response_model=list[PurchaseReturnListOut])
def list_purchase_returns(
    supplier_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[PurchaseReturnListOut]:
    """Every purchase return, newest first — the register their «مردودات شراء» opens on.

    The returns have always been recorded; they could only be seen by opening the purchase they
    came off, which answers «what came back off THIS invoice» and never «what went back to
    suppliers this month».
    """
    rows = db.scalars(select(PurchaseReturn).order_by(PurchaseReturn.id.desc())).all()
    invoices = {
        p.id: p for p in db.scalars(
            select(PurchaseInvoice).where(
                PurchaseInvoice.id.in_({r.purchase_invoice_id for r in rows})
            )
        ).all()
    } if rows else {}
    names = {s.id: s.name for s in db.scalars(select(Supplier)).all()}

    out = []
    for r in rows:
        inv = invoices.get(r.purchase_invoice_id)
        sup_id = inv.supplier_id if inv else None
        if supplier_id is not None and sup_id != supplier_id:
            continue
        out.append(PurchaseReturnListOut(
            id=r.id, document_number=r.document_number,
            purchase_invoice_id=r.purchase_invoice_id,
            purchase_document_number=inv.document_number if inv else None,
            return_date=r.return_date, notes=r.notes,
            supplier_id=sup_id, supplier_name=names.get(sup_id) if sup_id else None,
            value=r.value, created_at=str(r.created_at),
        ))
    return out


class PurchaseReturnLineOut(BaseModel):
    item_id: int
    item_name: str | None
    quantity: Decimal


class PurchaseReturnDetailOut(PurchaseReturnListOut):
    lines: list[PurchaseReturnLineOut]


# Also before `/{purchase_id}`, and two segments deep so it cannot collide with it.
@router.get("/returns/{return_id}", response_model=PurchaseReturnDetailOut)
def get_purchase_return(
    return_id: int,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> PurchaseReturnDetailOut:
    """المردود بسطوره — «رجّعنا إيه بالظبط».

    `purchase_return_line` has stored what went back since returns were built, and nothing has ever
    read it: the register could show the value of a return and never the items in it, so «رجعنا
    عشرة ولا اتنين» was answerable only from paper. The lines were there the whole time.
    """
    r = db.get(PurchaseReturn, return_id)
    if r is None:
        raise HTTPException(404, {"code": "not_found", "message": "Purchase return not found"})
    inv = db.get(PurchaseInvoice, r.purchase_invoice_id)
    supplier = db.get(Supplier, inv.supplier_id) if inv else None
    names = {
        i.id: i.name for i in db.scalars(
            select(Item).where(Item.id.in_({ln.item_id for ln in r.lines}))
        ).all()
    } if r.lines else {}
    return PurchaseReturnDetailOut(
        id=r.id, document_number=r.document_number,
        purchase_invoice_id=r.purchase_invoice_id,
        purchase_document_number=inv.document_number if inv else None,
        return_date=r.return_date, notes=r.notes,
        supplier_id=supplier.id if supplier else None,
        supplier_name=supplier.name if supplier else None,
        value=r.value, created_at=str(r.created_at),
        lines=[
            PurchaseReturnLineOut(
                item_id=ln.item_id, item_name=names.get(ln.item_id), quantity=ln.quantity)
            for ln in r.lines
        ],
    )


@router.get("/{purchase_id}", response_model=PurchaseDetailOut)
def get_purchase(
    purchase_id: int,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> PurchaseDetailOut:
    p = db.get(PurchaseInvoice, purchase_id)
    if p is None:
        raise HTTPException(404, {"code": "not_found", "message": "Purchase not found"})
    supplier = db.get(Supplier, p.supplier_id)
    returns = db.scalars(
        select(PurchaseReturn).where(PurchaseReturn.purchase_invoice_id == purchase_id)
    ).all()
    return PurchaseDetailOut(
        id=p.id, document_number=p.document_number, supplier_id=p.supplier_id,
        supplier_name=supplier.name if supplier else None, total=p.total,
        cash_amount=p.cash_amount, credit_amount=p.credit_amount, created_at=str(p.created_at),
        purchase_date=str(p.purchase_date) if p.purchase_date else None,
        external_document_number=p.external_document_number, notes=p.notes,
        location_kind=p.location_kind.value, location_id=p.location_id,
        lines=[PurchaseLineOut(item_id=ln.item_id, quantity=ln.quantity, unit_price=ln.unit_price,
                               line_total=ln.line_total, unit=ln.unit) for ln in p.lines],
        returns=[PurchaseReturnOut(id=r.id, document_number=r.document_number, value=r.value,
                                   created_at=str(r.created_at)) for r in returns],
    )


@router.post("", response_model=DocOut, status_code=status.HTTP_201_CREATED)
def create_purchase(
    body: PurchaseCreate,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> DocOut:
    try:
        inv = purchase_service.create_purchase(
            db, supplier_id=body.supplier_id, location_kind=body.location.location_kind,
            location_id=body.location.location_id, cash_amount=body.cash_amount,
            credit_amount=body.credit_amount,
            lines=[PurchaseLine(l.item_id, l.quantity, l.unit_price, l.unit, l.warehouse_id)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id,
            rep_id=body.rep_id, expense_account_id=body.expense_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            statement1=body.statement1, statement2=body.statement2, statement3=body.statement3,
            purchase_date=body.purchase_date,
        )
    except (PurchaseError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "purchase_invalid", "message": str(exc)})
    db.commit()
    return DocOut(id=inv.id, document_number=inv.document_number, ledger_entry_id=inv.ledger_entry_id)


@router.post("/{purchase_id}/returns", response_model=DocOut, status_code=status.HTTP_201_CREATED)
def return_purchase(
    purchase_id: int,
    body: ReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> DocOut:
    try:
        ret = purchase_service.return_purchase(
            db, purchase_invoice_id=purchase_id,
            lines=[(l.item_id, l.quantity) for l in body.lines],
            actor_role=current.role, actor_user_id=current.id,
            return_date=body.return_date, notes=body.notes,
        )
    except (PurchaseError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "return_invalid", "message": str(exc)})
    db.commit()
    return DocOut(id=ret.id, document_number=ret.document_number, ledger_entry_id=ret.ledger_entry_id)

class ReverseIn(BaseModel):
    """«تعديل» ولا «حذف» — الحركة واحدة والنية مختلفة."""

    reason: str = "edit"


@router.post("/{purchase_id}/reverse", response_model=DocOut,
             status_code=status.HTTP_201_CREATED)
def reverse_purchase(
    purchase_id: int,
    body: ReverseIn,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> DocOut:
    """عكس فاتورة شراء مرحّلة بالكامل — للتعديل أو للإلغاء.

    A posted purchase cannot be altered in place; the ledger is append-only and the goods are
    already on the shelf. So «تعديل» and «حذف» are the same movement — a full return of every line
    — and differ only in what the user does next.

    Separate from `/returns` for the same reason the sale's is: a supplier return is a real
    business event that belongs in مرتجعات المشتريات, and an edit is a correction that happens to
    be implemented as one. Sending both through that door made the returns register count the
    company's own typing mistakes as goods sent back to a supplier.
    """
    inv = db.get(PurchaseInvoice, purchase_id)
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "الفاتورة غير موجودة"})
    lines = [(line.item_id, line.quantity) for line in inv.lines]
    if not lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "validation", "message": "الفاتورة من غير سطور"})
    try:
        ret = purchase_service.return_purchase(
            db, purchase_invoice_id=purchase_id, lines=lines,
            actor_role=current.role, actor_user_id=current.id,
            notes=f"عكس للفاتورة {inv.document_number} ({body.reason})",
        )
    except (PurchaseError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "reverse_invalid", "message": str(exc)}) from exc
    db.commit()
    return DocOut(id=ret.id, document_number=ret.document_number,
                  ledger_entry_id=ret.ledger_entry_id)
