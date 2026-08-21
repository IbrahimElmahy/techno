"""Sales router (T037). FR-017–021, FR-026/028. Rep → own custody origin + own customers."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from datetime import date
from typing import Literal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user, require_capability
from src.auth.rbac import (
    CAP_RETURN_WRITE,
    CAP_SALE_DELETE,
    CAP_SALE_EDIT,
    CAP_SALE_WRITE,
    CAP_SELL_BELOW_PRICE,
    role_has_capability,
)
from src.core import clock
from src.core.db import get_db
from src.models.catalog import Item, ItemPrice, PriceTier
from src.models.customer import Customer
from src.models.loyalty import CouponType
from src.models.sales import SalesInvoice, SalesInvoiceCoupon, SalesReturn
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Custody
from src.services import coupon_receipt_service, sales_service
from src.services.rep_store_service import rep_store
from src.services.coupon_receipt_service import CouponReceiptError
from src.services.sales_service import ReturnLine, SaleLine, SalesError
from src.services.stock_service import StockError

router = APIRouter(tags=["sales"], prefix="/sales")


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class SaleLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    tier: PriceTier | None = None          # (007) override the customer's default tier per line
    unit_price: Decimal | None = None      # (007) manual price; below tier needs sell.below_price
    unit: str | None = None                # (008) unit of measure; None = base
    serials: list[str] | None = None       # (009) serials for a serialized item
    discount_pct: Decimal | None = None    # (027) per-line discount; None = item's fixed default
    # (030) serve this line from its own warehouse; None = the document's location
    warehouse_id: int | None = None


class InvoiceExpenseIn(BaseModel):
    account_id: int
    amount: Decimal
    kind: str = "billed"
    description: str | None = None


class InvoiceCouponIn(BaseModel):
    coupon_type_id: int | None = None
    count: int | None = None
    serial_from: str | None = None
    serial_to: str | None = None


class InvoiceCouponOut(InvoiceCouponIn):
    id: int
    # Resolved on read so a printed invoice can name the kind rather than showing an id.
    coupon_type_name: str | None = None


class SaleCreate(BaseModel):
    customer_id: int
    origin: LocationIn
    variable_discount_pct: Decimal = Decimal("0")
    cash_amount: Decimal
    credit_amount: Decimal
    lines: list[SaleLineIn]
    # (030) document fields — who sold it, where revenue posts, the customer's paper number,
    # and free text. All optional: an existing client that sends none behaves exactly as before.
    rep_id: int | None = None
    revenue_account_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    statement1: str | None = None
    statement2: str | None = None
    statement3: str | None = None
    # Coupons handed to the customer with this invoice, as a serial range off the book.
    coupon_serial_from: str | None = None
    coupon_serial_to: str | None = None
    coupon_count: int | None = None
    # …or as one entry per KIND, which is what a counter handing out gold and silver together
    # actually did. The three fields above stay for a hand-over that names no kind.
    coupons: list[InvoiceCouponIn] = []
    # The day the sale happened — dates the document and its ledger entry alike.
    invoice_date: date | None = None
    # مصروفات الفاتورة — billed (على العميل، بتزيد الصافي) أو operating (على الشركة).
    expenses: list[InvoiceExpenseIn] = []
    # (031) أبيض ولا بولي — which of the customer's accounts this invoice posts to.
    family: str | None = None
    # (033) رقم الجهاز — بيخلّي إعادة الرفع ترجّع نفس الفاتورة بدل ما تكتب واحدة تانية.
    client_uuid: str | None = None


class ReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    serials: list[str] | None = None       # (009) serials being returned (serialized items)
    # (011) expiry of the perishable goods coming back — required for a perishable item, since a
    # sale does not record which lot each unit came from.
    expiry_date: date | None = None


class ReturnCreate(BaseModel):
    lines: list[ReturnLineIn]


class StandaloneReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal                    # refunded price per unit (defaults to last sold price)
    unit: str | None = None                # (008) unit of measure; None = base
    discount_pct: Decimal | None = None    # (027) per-line discount; None = 0
    warehouse_id: int | None = None        # (030) this line returns into its own warehouse


class ReturnedCouponIn(BaseModel):
    serial_from: str
    serial_to: str | None = None
    count: int | None = None


class StandaloneReturnCreate(BaseModel):
    customer_id: int
    # (031) أبيض ولا بولي. The service has always accepted it and this payload dropped it, so a
    # return for a customer holding two accounts was refused — «لازم تحدد النوع» — with no field
    # anywhere to say which.
    family: str | None = None
    origin: LocationIn
    variable_discount_pct: Decimal = Decimal("0")
    cash_refund: Decimal = Decimal("0")
    credit_reduction: Decimal = Decimal("0")
    lines: list[StandaloneReturnLineIn]
    # (031) The same document fields the invoice takes. `SalesReturn` has carried the columns
    # since 030 and this payload dropped them, so nothing could ever fill them.
    rep_id: int | None = None
    revenue_account_id: int | None = None
    external_document_number: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)
    statement1: str | None = Field(default=None, max_length=200)
    statement2: str | None = Field(default=None, max_length=200)
    statement3: str | None = Field(default=None, max_length=200)
    return_date: date | None = None
    # (031) Coupons coming back with the goods. Each entry names a book the customer was issued;
    # the serials are expanded and taken in through the same receipt path the استلام الكوبونات
    # screen uses, so the same three refusals apply — unknown, already received, wrong customer.
    returned_coupons: list[ReturnedCouponIn] = []


class SalesInvoiceOut(BaseModel):
    id: int
    document_number: str
    customer_id: int
    gross: Decimal
    combined_pct: Decimal
    net: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    cash_account_id: int
    ledger_entry_id: int
    created_at: str | None = None
    # (030)
    rep_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    # «الحساب الفرعي» on their invoice list — the account this sale is posted to. Set on every
    # invoice since 030 and never returned, so the column that names where the money landed could
    # not be shown beside the money.
    revenue_account_id: int | None = None
    # The coupon range issued with this invoice — the mobile app reads it when the customer
    # brings the coupons back, to check a serial belongs to a sale that really happened.
    coupon_serial_from: str | None = None
    coupon_serial_to: str | None = None
    coupon_count: int | None = None
    coupons: list[InvoiceCouponOut] = []
    invoice_date: date | None = None
    expenses_billed: Decimal | None = None
    expenses_operating: Decimal | None = None


class InvoiceLineOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal | None = None
    line_total: Decimal
    price_tier: PriceTier | None = None
    unit: str | None = None
    unit_factor: Decimal | None = None
    # (030) the warehouse this line was served from, and the cost of goods frozen at sale time
    warehouse_id: int | None = None
    unit_cost: Decimal | None = None


class SalesInvoiceDetail(BaseModel):
    id: int
    document_number: str
    customer_id: int
    gross: Decimal
    combined_pct: Decimal
    net: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    cash_account_id: int
    ledger_entry_id: int
    lines: list[InvoiceLineOut]
    # The coupon books handed over, one row per kind — read back so the printed invoice can name
    # them instead of showing a bare range.
    coupons: list[InvoiceCouponOut] = []


def _rep_scope_check(db: Session, current: CurrentUser, customer_id: int, origin: LocationIn) -> None:
    if current.rep_id is None:
        return
    cust = db.get(Customer, customer_id)
    if cust is None or cust.rep_id != current.rep_id:
        raise HTTPException(403, {"code": "forbidden", "message": "Not your customer"})
    store = rep_store(db, current.rep_id)
    if store is None:
        raise HTTPException(403, {
            "code": "forbidden",
            "message": "مالكش عهدة ولا مخزن مسجّل — كلّم المخزن قبل ما تبيع."})
    # مكانه هو بالظبط. الشرط لسه بيرفض البيع من مخزن حد تاني — اللي اتوسّع هو **نوع**
    # المكان اللي ممكن يبقى بتاعه، مش مين صاحبه.
    if (origin.location_kind, origin.location_id) != store:
        raise HTTPException(403, {
            "code": "forbidden",
            "message": "لازم تبيع من مخزنك انت."})


@router.get("/rep-bundle", response_model=dict)
def rep_bundle(
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """كل اللي المندوب محتاجه عشان يبيع وهو من غير شبكة — في نداء واحد.

    التطبيق بيشتغل offline: بيسحب مرة وهو في مكان فيه شبكة، وبعدها بيكتب فواتير في الشارع.
    اللي بيحتاجه تلات حاجات مربوطة ببعض — عهدته، وعملاءه، واللي في العربية بسعره — ولو كل
    واحدة فيهم نداء لوحدها، المندوب اللي شبكته بتقطع بيقف في نص السحب ويفضل بنص بيانات:
    عملاء من غير أصناف، أو أصناف من غير أرصدة. نداء واحد يا بيوصل يا لأ.

    **والأرصدة والأسعار جاية من نفس المكان اللي البيع بيتحسب منه.** العهدة بترجع بالكمية
    المشتقّة من الحركات مش برقم متخزّن، والسعر بيرجع بكل الفئات عشان الجهاز يحسب نفس الرقم
    اللي السيرفر هيحسبه للعميل ده — الورقة اللي في إيد العميل والقيد في الدفتر لازم يقولوا
    نفس الرقم.
    """
    if current.rep_id is None:
        raise HTTPException(403, {"code": "forbidden", "message": "الشاشة دي للمناديب."})
    # نفس الدالة اللي البيع بيتقاس عليها — مش نسخة تانية من نفس القاعدة هنا.
    store = rep_store(db, current.rep_id)
    if store is None:
        raise HTTPException(404, {
            "code": "not_found", "message": "مالكش عهدة ولا مخزن مسجّل."})
    store_kind, store_id = store

    # عملاء المندوب هو بس — نفس الشرط اللي في كل مكان تاني، مش نسخة تانية منه هنا.
    customers = db.scalars(
        select(Customer).where(Customer.rep_id == current.rep_id, Customer.active.is_(True))
        .order_by(Customer.name)
    ).all()

    # اللي في العربية دلوقتي: مجموع الداخل ناقص الخارج على العهدة دي.
    signed = case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    )
    held = db.execute(
        select(Item.id, Item.name, Item.unit_of_measure, Item.default_discount_pct,
               Item.sale_price, func.coalesce(func.sum(signed), 0).label("qty"))
        .join(StockMovement, StockMovement.item_id == Item.id)
        .where(StockMovement.location_kind == store_kind,
               StockMovement.location_id == store_id)
        .group_by(Item.id, Item.name, Item.unit_of_measure, Item.default_discount_pct,
                  Item.sale_price)
        .order_by(Item.name)
    ).all()
    on_hand = {r[0]: Decimal(str(r[5] or 0)) for r in held}
    live = [r for r in held if on_hand[r[0]] > 0]

    # أسعار الفئات للأصناف اللي معاه بس — استعلام واحد، مش واحد لكل صنف.
    tiers: dict[int, dict[str, str]] = {}
    if live:
        for row in db.scalars(
            select(ItemPrice).where(ItemPrice.item_id.in_([r[0] for r in live]))
        ).all():
            tiers.setdefault(row.item_id, {})[row.tier.value] = str(row.price)

    return {
        "rep_id": current.rep_id,
        # التطبيق بيبعت المكان ده زي ما هو وقت الترحيل، فبينزل بنوعه مش برقمه بس:
        # مندوب على عهدة ومندوب على مخزن بيبعتوا `location_kind` مختلف.
        "store_kind": store_kind.value,
        "store_id": store_id,
        # الاسم القديم فاضل للنسخ اللي لسه ما اتحدّثتش من التطبيق.
        "custody_id": store_id if store_kind == LocationKind.custody else None,
        "customers": [
            {
                "id": c.id, "name": c.name, "phone": c.phone, "address": c.address,
                # الفئة بتقرّر السعر، فلازم تنزل مع العميل عشان الجهاز يسعّر زي السيرفر.
                "price_tier": c.default_price_tier.value if c.default_price_tier else None,
            }
            for c in customers
        ],
        "items": [
            {
                "item_id": r[0], "name": r[1], "unit": r[2],
                "default_discount_pct": str(r[3]) if r[3] is not None else None,
                "base_price": str(r[4]) if r[4] is not None else None,
                "on_hand": str(on_hand[r[0]]),
                "tier_prices": tiers.get(r[0], {}),
            }
            for r in live
        ],
    }


@router.post("", response_model=SalesInvoiceOut, status_code=status.HTTP_201_CREATED)
def create_sale(
    body: SaleCreate,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> SalesInvoiceOut:
    # الفاتورة اللي اتكتبت خلاص بترجع زي ما هي — مابتتكتبش تاني.
    #
    # ده اللي بيخلّي تطبيق المندوب يقدر يعيد الرفع من غير خوف: الجهاز مابيعرفش الفرق بين
    # «السيرفر ماستلمش» و«استلم والرد ضاع»، فبيعيد المحاولة. من غير الشرط ده، الإعادة
    # بتكتب فاتورة تانية بنفس البضاعة على نفس العميل.
    if body.client_uuid:
        seen = db.scalar(select(SalesInvoice).where(
            SalesInvoice.client_uuid == body.client_uuid))
        if seen is not None:
            return _inv_out(seen, db)

    _rep_scope_check(db, current, body.customer_id, body.origin)
    can_sell_below = role_has_capability(current.role, CAP_SELL_BELOW_PRICE)
    try:
        inv = sales_service.create_sale(
            db, customer_id=body.customer_id, origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id, variable_discount_pct=body.variable_discount_pct,
            cash_amount=body.cash_amount, credit_amount=body.credit_amount,
            lines=[SaleLine(l.item_id, l.quantity, l.tier, l.unit_price, l.unit, l.serials,
                            l.discount_pct, l.warehouse_id)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, family=body.family,
            can_sell_below=can_sell_below,
            rep_id=body.rep_id, revenue_account_id=body.revenue_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            coupon_serial_from=body.coupon_serial_from,
            coupon_serial_to=body.coupon_serial_to, coupon_count=body.coupon_count,
            invoice_date=body.invoice_date,
            expenses=[e.model_dump() for e in body.expenses],
            statement1=body.statement1, statement2=body.statement2, statement3=body.statement3,
            client_uuid=body.client_uuid,
        )
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": "sale_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "no_negative_stock", "message": str(exc)})
    # Written after the sale so they hang off a document that exists. A row with nothing in it at
    # all is dropped rather than stored: an empty coupon line is one somebody started and left, and
    # keeping it would read as a hand-over of nothing.
    for c in body.coupons:
        if c.coupon_type_id is None and not c.count and not c.serial_from and not c.serial_to:
            continue
        db.add(SalesInvoiceCoupon(
            invoice_id=inv.id, coupon_type_id=c.coupon_type_id, count=c.count,
            serial_from=c.serial_from, serial_to=c.serial_to,
        ))
    db.flush()
    db.commit()
    return _inv_out(inv, db)


def _inv_out(inv: SalesInvoice, db: Session | None = None) -> SalesInvoiceOut:
    coupons: list[InvoiceCouponOut] = []
    if db is not None:
        rows = db.scalars(
            select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.invoice_id == inv.id)
        ).all()
        names = {}
        ids = [r.coupon_type_id for r in rows if r.coupon_type_id]
        if ids:
            names = dict(db.execute(
                select(CouponType.id, CouponType.name).where(CouponType.id.in_(ids))
            ).all())
        coupons = [
            InvoiceCouponOut(
                id=r.id, coupon_type_id=r.coupon_type_id, count=r.count,
                serial_from=r.serial_from, serial_to=r.serial_to,
                coupon_type_name=names.get(r.coupon_type_id),
            )
            for r in rows
        ]
    return SalesInvoiceOut(
        coupons=coupons,
        id=inv.id, document_number=inv.document_number, customer_id=inv.customer_id,
        gross=inv.gross, combined_pct=inv.combined_pct, net=inv.net, cash_amount=inv.cash_amount,
        credit_amount=inv.credit_amount, cash_account_id=inv.cash_account_id,
        ledger_entry_id=inv.ledger_entry_id,
        created_at=str(inv.created_at) if inv.created_at else None,
        rep_id=inv.rep_id, external_document_number=inv.external_document_number,
        coupon_serial_from=inv.coupon_serial_from, coupon_serial_to=inv.coupon_serial_to,
        coupon_count=inv.coupon_count, invoice_date=inv.invoice_date,
        expenses_billed=getattr(inv, "expenses_billed", None),
        expenses_operating=getattr(inv, "expenses_operating", None),
        notes=inv.notes,
        revenue_account_id=inv.revenue_account_id,
    )


@router.get("", response_model=list[SalesInvoiceOut])
def list_sales(
    q: str | None = None,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    payment: str | None = None,   # cash | credit | partial
    rep_id: int | None = None,            # (030)
    external_document_number: str | None = None,  # (030)
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> list[SalesInvoiceOut]:
    """List sales invoices with search + filters, newest first."""
    stmt = select(SalesInvoice)
    if rep_id is not None:
        stmt = stmt.where(SalesInvoice.rep_id == rep_id)
    if external_document_number:
        stmt = stmt.where(SalesInvoice.external_document_number.like(
            f"%{external_document_number.strip()}%"))
    if current.rep_id is not None:
        stmt = stmt.where(SalesInvoice.customer_id.in_(
            select(Customer.id).where(Customer.rep_id == current.rep_id)
        ))
    if q:
        stmt = stmt.where(SalesInvoice.document_number.like(f"%{q.strip()}%"))
    if customer_id is not None:
        stmt = stmt.where(SalesInvoice.customer_id == customer_id)
    if date_from is not None:
        stmt = stmt.where(SalesInvoice.created_at >= clock.day_start_utc(date_from))
    if date_to is not None:
        stmt = stmt.where(SalesInvoice.created_at < clock.day_end_utc(date_to))
    if payment == "cash":       # fully paid (nothing on credit)
        stmt = stmt.where(SalesInvoice.credit_amount == 0)
    elif payment == "credit":   # fully on credit (nothing paid)
        stmt = stmt.where(SalesInvoice.cash_amount == 0)
    elif payment == "partial":  # a mix
        stmt = stmt.where(SalesInvoice.cash_amount > 0, SalesInvoice.credit_amount > 0)
    return [_inv_out(i) for i in db.scalars(stmt.order_by(SalesInvoice.id.desc())).all()]


# --- Standalone returns (028): "return like a sale, reversed" ---------------------------------
# Declared BEFORE /{sale_id} so the literal "returns"/"customer-item-history" paths win over the
# int path param.

def _standalone_return_out(r: SalesReturn, db: Session | None = None) -> dict:
    # «الفاتورة رقم» on their مردود مبيعات list — the sale this came back from. The link has always
    # been stored; the number was never returned, so the column that says WHICH sale a return
    # undoes could not be shown beside it.
    invoice_no = None
    if db is not None and r.sales_invoice_id:
        inv = db.get(SalesInvoice, r.sales_invoice_id)
        invoice_no = inv.document_number if inv else None
    return {
        "id": r.id, "document_number": r.document_number, "customer_id": r.customer_id,
        "gross": str(r.gross), "combined_pct": str(r.combined_pct), "net": str(r.value),
        "tax_amount": str(r.tax_amount), "cash_refund": str(r.cash_refund),
        "credit_reduction": str(r.credit_reduction), "ledger_entry_id": r.ledger_entry_id,
        "created_at": str(r.created_at) if r.created_at else None,
        "sales_invoice_id": r.sales_invoice_id, "invoice_document_number": invoice_no,
        # (031) The document fields, so the list can show the columns their مردود مبيعات has —
        # مندوب · الحساب الفرعي · مستند رقم · ملاحظات — instead of leaving them out for want of
        # a source.
        "return_date": str(r.return_date) if r.return_date else None,
        "rep_id": r.rep_id, "revenue_account_id": r.revenue_account_id,
        "external_document_number": r.external_document_number, "notes": r.notes,
        "statement1": r.statement1, "statement2": r.statement2, "statement3": r.statement3,
        # Which debt the refund reduced. A field that goes in and never comes back is a field
        # nobody can act on — the same reason the invoice returns it.
        "family": getattr(r, "family", None),
    }


@router.get("/customer-item-history", response_model=dict)
def customer_item_history(
    customer_id: int,
    item_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """Last price this customer paid for this item + short purchase history (028). Empty if never
    bought — the return line then just keeps its typed price."""
    data = sales_service.last_sold_price(db, customer_id=customer_id, item_id=item_id)
    return data or {"last_price": None, "history": []}


@router.get("/returns", response_model=list[dict])
def list_standalone_returns(
    q: str | None = None,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List standalone sales returns (customer-based), newest first.

    والمعكوس مابيظهرش — زي سجل مردودات الشرا بالظبط. السند اللي اتعكس أثره اتشال بالكامل:
    البضاعة خرجت تاني والقيد اتعكس، فعرضه في سجل بيتجمع بيخلّي مجموع المرتجعات يعدّ حاجة
    مالهاش وجود. الصف نفسه بيفضل في الداتا برقمه وقيده المضاد لأي مراجعة.
    """
    stmt = select(SalesReturn).where(
        SalesReturn.customer_id.isnot(None), SalesReturn.reversed_at.is_(None))
    if current.rep_id is not None:
        stmt = stmt.where(SalesReturn.customer_id.in_(
            select(Customer.id).where(Customer.rep_id == current.rep_id)
        ))
    if q:
        stmt = stmt.where(SalesReturn.document_number.like(f"%{q.strip()}%"))
    if customer_id is not None:
        stmt = stmt.where(SalesReturn.customer_id == customer_id)
    if date_from is not None:
        stmt = stmt.where(SalesReturn.created_at >= clock.day_start_utc(date_from))
    if date_to is not None:
        stmt = stmt.where(SalesReturn.created_at < clock.day_end_utc(date_to))
    return [_standalone_return_out(r, db)
            for r in db.scalars(stmt.order_by(SalesReturn.id.desc())).all()]


@router.post("/returns", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_standalone_return(
    body: StandaloneReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    _rep_scope_check(db, current, body.customer_id, body.origin)
    try:
        ret = sales_service.create_standalone_return(
            db, customer_id=body.customer_id, origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id,
            variable_discount_pct=body.variable_discount_pct,
            cash_refund=body.cash_refund, credit_reduction=body.credit_reduction,
            lines=[ReturnLine(l.item_id, l.quantity, l.unit_price, l.unit, l.discount_pct,
                              l.warehouse_id)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, family=body.family,
            rep_id=body.rep_id, revenue_account_id=body.revenue_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            statement1=body.statement1, statement2=body.statement2, statement3=body.statement3,
            return_date=body.return_date,
        )
        # The coupons are a second document, deliberately: a coupon receipt is what the mobile app
        # and the counter both already write, and giving the return its own private path would be
        # a second place that decides whether a coupon is real.
        if body.returned_coupons:
            serials: list[str] = []
            for c in body.returned_coupons:
                serials.extend(coupon_receipt_service.expand_range(c.serial_from, c.serial_to))
            coupon_receipt_service.create_receipt(
                db, serials=serials, actor_user_id=current.id,
                customer_id=body.customer_id,
                notes=f"مع مردود المبيعات {ret.document_number}",
            )
    except CouponReceiptError as exc:
        # Refused as a whole — the goods and the coupons are one act at the counter, and taking
        # the goods back while rejecting the coupons leaves the customer holding paper nobody will
        # now accept.
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "coupon_invalid", "message": str(exc)}) from exc
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "return_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "no_negative_stock", "message": str(exc)})
    db.commit()
    return _standalone_return_out(ret)


@router.post("/returns/{return_id}/reverse", response_model=dict)
def reverse_sales_return_endpoint(
    return_id: int,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """عكس مرتجع مبيعات مرحّل.

    المرتجع المرحّل ماينفعش يتعدّل في مكانه — البضاعة رجعت المخزن والقيد اتكتب — فالتعديل
    والحذف الاتنين معناهم نفس الحركة: عكس كامل. والفرق بينهم هو اللي بيحصل بعده.

    مُعلن قبل `/returns/{return_id}` عشان المسار الحرفي يكسب. ونفس ترتيب مردود الشرا
    بالظبط، لأن الشاشتين نسخة من بعض والسيرفر المفروض يبقى كده كمان.
    """
    try:
        ret = sales_service.reverse_sales_return(
            db, return_id=return_id, actor_user_id=current.id)
    except SalesError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    db.commit()
    return {"id": ret.id, "document_number": ret.document_number,
            "reversed_at": ret.reversed_at.isoformat() if ret.reversed_at else None,
            "reversal_entry_id": ret.reversal_entry_id}


@router.get("/returns/{return_id}", response_model=dict)
def get_standalone_return(
    return_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(SalesReturn, return_id)
    if r is None:
        raise HTTPException(404, {"code": "not_found", "message": "Return not found"})
    out = _standalone_return_out(r)
    out["origin_location_kind"] = r.origin_location_kind.value if r.origin_location_kind else None
    out["origin_location_id"] = r.origin_location_id
    out["lines"] = [
        {
            "item_id": ln.item_id, "quantity": str(ln.quantity),
            "unit_price": str(ln.unit_price) if ln.unit_price is not None else None,
            "discount_pct": str(ln.discount_pct), "unit": ln.unit,
            "line_total": str(ln.line_total) if ln.line_total is not None else None,
            "warehouse_id": ln.location_id,   # (030)
        }
        for ln in r.lines
    ]
    return out


@router.get("/{sale_id}", response_model=SalesInvoiceDetail)
def get_sale(
    sale_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> SalesInvoiceDetail:
    inv = db.get(SalesInvoice, sale_id)
    if inv is None:
        raise HTTPException(404, {"code": "not_found", "message": "Sale not found"})
    return SalesInvoiceDetail(
        coupons=_inv_out(inv, db).coupons,
        id=inv.id,
        document_number=inv.document_number,
        customer_id=inv.customer_id,
        gross=inv.gross,
        combined_pct=inv.combined_pct,
        net=inv.net,
        cash_amount=inv.cash_amount,
        credit_amount=inv.credit_amount,
        cash_account_id=inv.cash_account_id,
        ledger_entry_id=inv.ledger_entry_id,
        lines=[
            InvoiceLineOut(
                item_id=line.item_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount_pct=line.discount_pct,
                line_total=line.line_total,
                price_tier=line.price_tier,
                unit=line.unit,
                unit_factor=line.unit_factor,
                warehouse_id=line.location_id,
                unit_cost=line.unit_cost,
            )
            for line in inv.lines
        ],
    )


@router.get("/{sale_id}/returns", response_model=list[dict])
def list_sale_returns(
    sale_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(
        select(SalesReturn).where(SalesReturn.sales_invoice_id == sale_id)
        .order_by(SalesReturn.id.desc())
    ).all()
    return [
        {
            "id": r.id, "document_number": r.document_number, "value": str(r.value),
            "cash_refund": str(r.cash_refund), "credit_reduction": str(r.credit_reduction),
            "created_at": str(r.created_at),
            "lines": [{"item_id": ln.item_id, "quantity": str(ln.quantity)} for ln in r.lines],
        }
        for r in rows
    ]


class ReverseIn(BaseModel):
    """ليه بنعكس الفاتورة."""
    # Which right is being exercised. Not cosmetic: «بعدّلها» and «بلغيها» are different
    # permissions, and the server cannot tell them apart from the movements alone — both post the
    # same full return.
    reason: Literal["edit", "delete"]


@router.post("/{sale_id}/reverse", response_model=dict, status_code=status.HTTP_201_CREATED)
def reverse_sale(
    sale_id: int,
    body: ReverseIn,
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """عكس فاتورة مرحّلة بالكامل — للتعديل أو للإلغاء.

    A posted invoice cannot be altered in place; the ledger is append-only. So «تعديل» and «حذف»
    both mean the same movement — a full return — and differ only in what the user does next.

    They are separate endpoints from `/returns` on purpose. A customer return is a real business
    event that belongs in مردودات المبيعات; an edit is a correction that happens to be implemented
    as one. Sending both through the same door meant the returns register counted the shop's own
    mistakes as customer returns, and it meant a salesman with `return.write` could quietly unmake
    any invoice ever posted.
    """
    needed = CAP_SALE_EDIT if body.reason == "edit" else CAP_SALE_DELETE
    if not role_has_capability(current.role, needed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "forbidden",
            "message": "مالكش صلاحية تعديل الفاتورة" if body.reason == "edit"
                       else "مالكش صلاحية إلغاء الفاتورة"})

    inv = db.get(SalesInvoice, sale_id)
    if inv is None:
        raise HTTPException(404, {"code": "not_found", "message": "الفاتورة غير موجودة"})
    if not inv.lines:
        raise HTTPException(422, {"code": "validation", "message": "الفاتورة من غير سطور"})
    try:
        # `reverse_sale`, not `return_sale`: a reversal fills in the lots and the serials from the
        # invoice itself. Calling the return path directly is what made «تعديل» fail on any
        # invoice holding a perishable or a serialized item — it demanded answers only the
        # original sale knew, and the sale had already written them down.
        ret = sales_service.reverse_sale(
            db, sales_invoice_id=sale_id, actor_user_id=current.id)
    except (SalesError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "return_invalid", "message": str(exc)})
    db.commit()
    return {"id": ret.id, "document_number": ret.document_number, "reason": body.reason}


@router.post("/{sale_id}/returns", response_model=dict, status_code=status.HTTP_201_CREATED)
def return_sale(
    sale_id: int,
    body: ReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    try:
        ret = sales_service.return_sale(
            db, sales_invoice_id=sale_id, lines=[(l.item_id, l.quantity) for l in body.lines],
            actor_user_id=current.id,
            serials={l.item_id: l.serials for l in body.lines if l.serials},
            expiry_dates={l.item_id: l.expiry_date for l in body.lines if l.expiry_date},
        )
    except (SalesError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "return_invalid", "message": str(exc)})
    db.commit()
    return {"id": ret.id, "document_number": ret.document_number,
            "cash_refund": str(ret.cash_refund), "credit_reduction": str(ret.credit_reduction),
            # Inherited off the invoice, and said out loud: the refund reduced THAT debt, and the
            # screen printing the customer's copy has to be able to name it.
            "family": getattr(ret, "family", None),
            "ledger_entry_id": ret.ledger_entry_id}
