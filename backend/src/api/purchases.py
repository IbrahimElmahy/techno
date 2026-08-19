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
from src.core.money import to_money
from src.models.catalog import Item
from src.models.ledger import Account
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
    discount_pct: Decimal | None = None   # خصم السطر؛ None = مفيش خصم متفق عليه


class PurchaseCreate(BaseModel):
    supplier_id: int
    # خصم الفاتورة المتغيّر. الثابت بيتقرا من الإعدادات زي البيع.
    variable_discount_pct: Decimal = Decimal("0")
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
    # نفس اللي فاتورة البيع بترجّعه ساعة الإنشاء: الشاشة محتاجة ترسم إجمالي المشتري يقدر يراجعه،
    # ونداء تاني عشان تقراه معناه لحظة الفاتورة فيها فيه رقم على الشاشة ورقم في الدفاتر.
    gross: Decimal = Decimal("0")
    combined_pct: Decimal = Decimal("0")
    net: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    cash_amount: Decimal = Decimal("0")
    credit_amount: Decimal = Decimal("0")


class PurchaseListOut(BaseModel):
    id: int
    document_number: str
    supplier_id: int
    supplier_name: str | None
    gross: Decimal = Decimal("0")
    combined_pct: Decimal = Decimal("0")
    net: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")
    total: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    created_at: str
    # (031) The day the goods arrived. `created_at` is when the row was typed, which is a different
    # question and the one nobody was asking.
    purchase_date: str | None = None
    external_document_number: str | None = None
    notes: str | None = None
    # (٨) الأعمدة اللي سجل الشرا عند العميل بيعرضها والسجل عندنا مكانش بيرجّعها.
    #
    # `gross` و`combined_pct` و`net` و`tax_amount` كانوا **معرّفين فوق من الأول وماكانوش
    # بيتعبّوا** — الـendpoint مكانش بيمرّرهم، فالـdefault كان بيخلّيهم أصفار في كل صف. يعني
    # العقد بيوعد بأربع أرقام والسجل بيرجّعهم صفر من غير ما حاجة تزعق.
    branch_id: int | None = None
    branch_name: str | None = None
    expense_account_id: int | None = None
    expense_account_name: str | None = None
    #  قيمة الخصم بالجنيه — النسبة لوحدها مابتقولش كام اتخصم.
    discount_amount: Decimal = Decimal("0")
    tax_pct: Decimal = Decimal("0")


class PurchaseLineOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal | None = None
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

    # الفرع مش على الفاتورة — هو على المخزن اللي البضاعة نزلت فيه، فبيتجاب منه.
    from src.models.org import Branch
    from src.models.warehouse import Warehouse

    warehouses = {w.id: w for w in db.scalars(select(Warehouse)).all()}
    branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}
    accounts = {
        a.id: (f"{a.code} {a.name}" if a.code and a.name else (a.name or a.code))
        for a in db.scalars(select(Account)).all()
    }

    out = []
    for p in rows:
        warehouse = (warehouses.get(p.location_id)
                     if p.location_kind == LocationKind.warehouse else None)
        branch_id = warehouse.branch_id if warehouse else None
        gross = to_money(p.gross or 0)
        net = to_money(p.net or 0)
        out.append(PurchaseListOut(
            id=p.id, document_number=p.document_number, supplier_id=p.supplier_id,
            supplier_name=names.get(p.supplier_id), total=p.total, cash_amount=p.cash_amount,
            credit_amount=p.credit_amount, created_at=str(p.created_at),
            purchase_date=str(p.purchase_date) if p.purchase_date else None,
            external_document_number=p.external_document_number, notes=p.notes,
            gross=gross, combined_pct=p.combined_pct or 0, net=net,
            tax_amount=to_money(p.tax_amount or 0),
            branch_id=branch_id, branch_name=branches.get(branch_id) if branch_id else None,
            expense_account_id=p.expense_account_id,
            expense_account_name=accounts.get(p.expense_account_id),
            # الخصم بالجنيه = قبل الخصم ناقص بعده. مشتق مش محفوظ، فمافيش رقمين يختلفوا.
            discount_amount=to_money(gross - net),
            # الضريبة كنسبة من الصافي — الصافي صفر يعني مفيش نسبة، مش قسمة على صفر.
            tax_pct=(to_money(to_money(p.tax_amount or 0) / net * 100) if net else Decimal("0")),
        ))
    return out


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
    # المعكوس مابيظهرش: بضاعته رجعت وقيده اتعكس، فهو مستند في الدفتر ومش حركة في السجل.
    rows = db.scalars(
        select(PurchaseReturn)
        .where(PurchaseReturn.reversed_at.is_(None))
        .order_by(PurchaseReturn.id.desc())
    ).all()
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
                               discount_pct=ln.discount_pct,
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
            lines=[PurchaseLine(l.item_id, l.quantity, l.unit_price, l.unit, l.warehouse_id,
                                l.discount_pct)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id,
            rep_id=body.rep_id, expense_account_id=body.expense_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            statement1=body.statement1, statement2=body.statement2, statement3=body.statement3,
            purchase_date=body.purchase_date,
            variable_discount_pct=body.variable_discount_pct,
        )
    except (PurchaseError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "purchase_invalid", "message": str(exc)})
    db.commit()
    return DocOut(
        id=inv.id, document_number=inv.document_number, ledger_entry_id=inv.ledger_entry_id,
        gross=inv.gross, combined_pct=inv.combined_pct, net=inv.net,
        tax_amount=inv.tax_amount, total=inv.total,
        cash_amount=inv.cash_amount, credit_amount=inv.credit_amount,
    )


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


@router.post("/returns/{return_id}/reverse", response_model=dict)
def reverse_purchase_return(
    return_id: int,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """عكس مردود شراء مرحّل — للتعديل أو للإلغاء.

    زي الفاتورة بالظبط: المردود المرحّل ماينفعش يتعدّل في مكانه لأن البضاعة اتحركت والقيد اتكتب،
    فالتعديل عكس كامل وكتابة من جديد.

    Declared BEFORE `/{purchase_id}/reverse` on purpose: FastAPI matches in declaration order, and
    the id route would swallow "returns" and fail parsing it as an int.
    """
    try:
        ret = purchase_service.reverse_purchase_return(
            db, return_id=return_id, actor_user_id=current.id)
    except PurchaseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "reverse_invalid", "message": str(exc)}) from exc
    db.commit()
    return {"id": ret.id, "document_number": ret.document_number,
            "purchase_invoice_id": ret.purchase_invoice_id, "reversed": True}


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
    # What is LEFT to reverse. Sending the full quantity on an invoice that already had a partial
    # supplier return exceeded what remained and was refused outright — the same defect the sale
    # had, where «تعديل» on a partly-returned invoice failed instead of reversing the remainder.
    prior = purchase_service._already_returned(db, purchase_id)
    lines = []
    for line in inv.lines:
        remaining = Decimal(line.quantity) - prior.get(line.item_id, Decimal("0"))
        if remaining > 0:
            lines.append((line.item_id, remaining))
    if not inv.lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "validation", "message": "الفاتورة من غير سطور"})
    if not lines:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "reverse_invalid",
                             "message": "الفاتورة دي اترجّعت بالكامل قبل كده — مفيش حاجة تتعكس."})
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
