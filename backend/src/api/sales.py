"""Sales router (T037). FR-017–021, FR-026/028. Rep → own custody origin + own customers."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from datetime import date
from typing import Literal

from sqlalchemy import case, delete as sa_delete, func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user, require_capability
from src.auth.rbac import (
    CAP_RETURN_WRITE,
    CAP_SALE_DELETE,
    CAP_SALE_EDIT,
    CAP_SALE_WRITE,
    CAP_SALES_READ,
    CAP_SELL_BELOW_PRICE,
    role_has_capability,
)
from src.core import clock
from src.core.db import get_db
from src.models.catalog import Item, ItemPrice, PriceTier
from src.models.customer import Customer, CustomerAccount
from src.models.lookup import LookupOption
from src.models.loyalty import CouponType
from src.models.sales import SalesInvoice, SalesInvoiceCoupon, SalesReturn
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.user import User
from src.models.warehouse import Custody, Warehouse
from src.services import coupon_receipt_service, sales_service
from src.services.rep_store_service import rep_store
from src.services.coupon_receipt_service import CouponReceiptError
from src.services.sales_service import ReturnLine, SaleLine, SalesError
from src.services import document_edit_service
from src.services.document_edit_service import DocumentEditError
from src.services.stock_service import StockError
from src.auth import branch_scope

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
    # فئة الدفتر — عادي/فضي/ذهبي/ماسي، قيمة من قائمة «فئات الكوبونات».
    coupon_kind: str | None = None
    # كتالوج استبدال النقاط. مش فئة الورقة، وسايب للتوافق مع اللي كان بيبعته.
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
    # سيبه فاضي والسيرفر يحسبه: المستحق ناقص النقدي. الشاشة بتحسب صافي السطور
    # وبس، والمستحق فيه الضريبة ومصروفات العميل — فمقارنة الرقمين كانت بترفض
    # فواتير سليمة.
    credit_amount: Decimal | None = None
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
    # (009) المرتجع الحر — سيريالات الأصناف المسلسلة المرتجعة.
    serials: list[str] | None = None


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
    ledger_entry_id: int | None = None
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
    # الاسم بيتبعت مع الصف مش بيتحل في الشاشة.
    #
    # كانت الشاشة بتحمّل كشف العملاء والمناديب وتدوّر على الـid جوّاه. بعد نقل داتا a5 بقى
    # الكشف 1327 عميل و2640 صنف، والتحميل ده بيقع على الشبكة — فالجدول كان بيعرض
    # «عميل #1841» و«-» مكان المندوب، مع إن الصف نفسه سليم.
    customer_name: str | None = None
    rep_name: str | None = None
    # «النوع» في جدول المبيعات = تصنيف العميل (تاجر / سباك / معرض / شركة)، بالاسم العربي
    # زي ما هو في «أنواع العملاء». بيتبعت مع الصف عشان الجدول مايحتاجش يحمّل كشف العملاء
    # كله عشان يعرف كلمة واحدة.
    customer_type: str | None = None
    # عائلة الفاتورة — أبيض ولا تكنو. مش «النوع»: دي بتقول الفاتورة على أنهي حساب، والنوع
    # بيقول العميل ده إيه. الفلتر في الشريط بيشتغل عليها.
    family: str | None = None
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
    ledger_entry_id: int | None = None
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
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
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

    # حسابات العملاء دول — استعلام واحد، مش واحد لكل عميل.
    accounts_by_customer: dict[int, list[CustomerAccount]] = {}
    if customers:
        for acc in db.scalars(
            select(CustomerAccount).where(
                CustomerAccount.customer_id.in_([c.id for c in customers]))
        ).all():
            accounts_by_customer.setdefault(acc.customer_id, []).append(acc)

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
        # المخازن — عشان المندوب يقدر يطلب تحويل من التطبيق.
        #
        # الإذن محتاج مصدر ووجهة، والتطبيق شغّال offline فمينفعش يسألهم وقت الكتابة.
        # بيتحمّلوا مع الحزمة، والإذن بيتكتب على الجهاز وبيترفع لما الشبكة ترجع — وبيوصل
        # «معلّق» عشان المسؤول يراجعه.
        "warehouses": [
            {"id": w.id, "name": w.name, "kind": w.warehouse_type.value}
            for w in db.scalars(
                select(Warehouse).where(Warehouse.active.is_(True))
                .order_by(Warehouse.name)
            ).all()
        ],
        "customers": [
            {
                "id": c.id, "name": c.name, "phone": c.phone, "address": c.address,
                # الفئة بتقرّر السعر، فلازم تنزل مع العميل عشان الجهاز يسعّر زي السيرفر.
                "price_tier": c.default_price_tier.value if c.default_price_tier else None,
                # التصنيف — «الملّاك» وغيره. قائمة حرة، فبينزل زي ما هو من غير ما نعدّه هنا.
                "customer_type": c.customer_type,
                # خطوط المنتجات اللي للعميل حساب عليها («أبيض»، «بولي»).
                #
                # العميل الواحد ممكن يبقى مديون على خطين بحسابين منفصلين، والمندوب لازم يقول
                # الفاتورة دي على أنهي واحد فيهم — زي ما بيحصل في النظام بالظبط. من غير
                # القايمة دي التطبيق مش هيعرف يسأل، والفاتورة بتنزل على المديونية الغلط.
                "families": sorted(
                    {a.family for a in accounts_by_customer.get(c.id, []) if a.family}),
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


def _build_sale(
    db: Session, body: "SaleCreate", current: CurrentUser, *,
    replace_invoice_id: int | None = None,
) -> SalesInvoice:
    """بيبني الفاتورة من الجسم — سواء جديدة أو مكان واحدة موجودة.

    الإنشاء والتعديل نفس البناء بالظبط: نفس التحقق، ونفس التسعير، ونفس حركة المخزون،
    ونفس القيد. الفرق الوحيد إن التعديل بيتم على صف موجود. لو الاتنين اتكتبوا كل واحد
    لوحده، أول حقل يتضاف للفاتورة هيتحط في واحد وينسى في التاني.
    """
    _rep_scope_check(db, current, body.customer_id, body.origin)
    can_sell_below = role_has_capability(current.role, CAP_SELL_BELOW_PRICE)
    try:
        inv = sales_service.create_sale(
            db, customer_id=body.customer_id, origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id,
            variable_discount_pct=body.variable_discount_pct,
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
            replace_invoice_id=replace_invoice_id,
        )
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "sale_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "no_negative_stock", "message": str(exc)})

    # Written after the sale so they hang off a document that exists. A row with nothing in it at
    # all is dropped rather than stored: an empty coupon line is one somebody started and left,
    # and keeping it would read as a hand-over of nothing.
    if replace_invoice_id:
        db.execute(sa_delete(SalesInvoiceCoupon).where(
            SalesInvoiceCoupon.invoice_id == inv.id))
    for c in body.coupons:
        if (not c.coupon_kind and c.coupon_type_id is None and not c.count
                and not c.serial_from and not c.serial_to):
            continue
        db.add(SalesInvoiceCoupon(
            invoice_id=inv.id, coupon_kind=c.coupon_kind,
            coupon_type_id=c.coupon_type_id, count=c.count,
            serial_from=c.serial_from, serial_to=c.serial_to,
        ))
    db.flush()
    return inv


@router.put("/{sale_id}", response_model=SalesInvoiceOut)
def update_sale(
    sale_id: int,
    body: SaleCreate,
    current: CurrentUser = Depends(require_capability(CAP_SALE_EDIT)),
    db: Session = Depends(get_db),
) -> SalesInvoiceOut:
    """تعديل فاتورة بيع — بتتحفظ مكان القديمة، من غير مرتجع ولا قيد عكسي.

    الطريقة القديمة كانت بتعكس الفاتورة وتكتب واحدة جديدة، فتصليح سعر كان بيسيب وراه
    مرتجع محدش رجّعه ورقم فاتورة جديد على ورقة العميل القديمة. دلوقتي الأثر القديم بيتشال
    والفاتورة بتتبني تاني بنفس رقمها — زي أي شاشة تعديل في أي نظام.
    """
    inv = db.get(SalesInvoice, sale_id)
    if inv is None:
        raise HTTPException(404, {"code": "not_found", "message": "الفاتورة غير موجودة"})
    if not branch_scope.may_see(current, inv):
        raise HTTPException(404, {"code": "not_found", "message": "الفاتورة غير موجودة"})
    try:
        document_edit_service.assert_sale_editable(db, inv)
        document_edit_service.purge_sale(db, inv)
    except DocumentEditError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "edit_blocked", "message": str(exc)})
    inv = _build_sale(db, body, current, replace_invoice_id=sale_id)
    db.commit()
    return _inv_out(inv, db)


@router.delete("/{sale_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sale(
    sale_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_DELETE)),
    db: Session = Depends(get_db),
) -> None:
    """حذف فاتورة بيع — بتروح هي وأثرها، مش بتتعكس."""
    try:
        document_edit_service.delete_sale(
            db, invoice_id=sale_id, actor_user_id=current.id)
    except DocumentEditError as exc:
        code = 404 if "مش موجودة" in str(exc) else status.HTTP_409_CONFLICT
        raise HTTPException(code, {"code": "delete_blocked", "message": str(exc)})
    db.commit()


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

    inv = _build_sale(db, body, current)
    db.commit()
    return _inv_out(inv, db)


def _type_labels(db: Session) -> dict[str, str]:
    """كود التصنيف → اسمه العربي. الجدول بيعرض «تاجر» مش «trader»."""
    return dict(db.execute(
        select(LookupOption.value, LookupOption.label)
        .where(LookupOption.category == "customer_type")).all())


def _row_names(db: Session, rows: list) -> tuple[dict[int, str], dict[int, str],
                                                 dict[int, str]]:
    """اسم العميل وتصنيفه واسم المندوب لصفوف الصفحة — نداءات مجمّعة مش نداء لكل صف."""
    cust_ids = {r.customer_id for r in rows if r.customer_id}
    rep_ids = {r.rep_id for r in rows if getattr(r, "rep_id", None)}
    custs, types = {}, {}
    if cust_ids:
        labels = _type_labels(db)
        for cid, name, ctype in db.execute(
                select(Customer.id, Customer.name, Customer.customer_type)
                .where(Customer.id.in_(cust_ids))).all():
            custs[cid] = name
            if ctype:
                types[cid] = labels.get(ctype, ctype)
    reps = dict(db.execute(select(User.id, User.full_name)
                           .where(User.id.in_(rep_ids))).all()) if rep_ids else {}
    return custs, types, {k: v for k, v in reps.items() if v}


def _inv_out(inv: SalesInvoice, db: Session | None = None, *,
             names: tuple[dict[int, str], dict[int, str], dict[int, str]] | None = None
             ) -> SalesInvoiceOut:
    coupons: list[InvoiceCouponOut] = []
    if db is not None:
        rows = db.scalars(
            select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.invoice_id == inv.id)
        ).all()
        # اسم متغيّر مستقل عن البارامتر `names`. كان بينده عليه `names` كمان، فالفاتورة
        # اللي فيها كوبونات كانت بتدهس أسماء العملاء وتنهار عند التفكيك تحت.
        type_names: dict[int, str] = {}
        ids = [r.coupon_type_id for r in rows if r.coupon_type_id]
        if ids:
            type_names = dict(db.execute(
                select(CouponType.id, CouponType.name).where(CouponType.id.in_(ids))
            ).all())
        coupons = [
            InvoiceCouponOut(
                id=r.id, coupon_kind=r.coupon_kind,
                coupon_type_id=r.coupon_type_id, count=r.count,
                serial_from=r.serial_from, serial_to=r.serial_to,
                coupon_type_name=type_names.get(r.coupon_type_id),
            )
            for r in rows
        ]
    cust_names, cust_types, rep_names = names or ({}, {}, {})
    return SalesInvoiceOut(
        family=inv.family,
        customer_type=cust_types.get(inv.customer_id),
        customer_name=cust_names.get(inv.customer_id),
        rep_name=rep_names.get(inv.rep_id) if inv.rep_id else None,
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
    family: str | None = None,
    external_document_number: str | None = None,  # (030)
    limit: int | None = None,
    offset: int = 0,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> list[SalesInvoiceOut]:
    """List sales invoices with search + filters, newest first.

    `limit` بيتساب فاضي افتراضياً عشان اللي بيندهه دلوقتي مايتقطعش عليه الرد في صمت.
    الشاشة بتبعته: ٦١٦٣ فاتورة = ٢.٩ ميجا، والشبكة بتاخد ٤٧ ثانية توصّلها فالشاشة بتفصل
    قبلها وبتقول «فشل الاتصال». الإجماليات بقت من `/sales/summary` عشان الصفحة الواحدة
    ماتخليش الأرقام تكدب.
    """
    stmt = branch_scope.scope(select(SalesInvoice), SalesInvoice, current)
    if rep_id is not None:
        stmt = stmt.where(SalesInvoice.rep_id == rep_id)
    if family:
        stmt = stmt.where(SalesInvoice.family == family)
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
    stmt = stmt.order_by(SalesInvoice.id.desc())
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    rows = list(db.scalars(stmt).all())
    # مرة واحدة للصفحة كلها — كانت جوّه الحلقة، يعني نداء لكل صف.
    names = _row_names(db, rows)
    return [_inv_out(i, names=names) for i in rows]


@router.get("/summary", response_model=dict)
def sales_summary(
    q: str | None = None,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    payment: str | None = None,
    rep_id: int | None = None,
    family: str | None = None,
    external_document_number: str | None = None,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """إجماليات شاشة المبيعات — محسوبة على السيرفر بنفس فلاتر القايمة.

    كانت بتتحسب في الشاشة بجمع الصفوف اللي اتحمّلت، وده كان بيلزم إن الصفوف **كلها**
    تتحمّل: ٦١٦٣ فاتورة = ٢.٩ ميجا في كل فتحة، ٤٧ ثانية على الشبكة، والشاشة بتفصل قبلها.
    الجمع هنا بيخلّي القايمة تجيب صفحة والأرقام تفضل صح.
    """
    inv = branch_scope.scope(select(SalesInvoice), SalesInvoice, current)
    ret = branch_scope.scope(select(SalesReturn), SalesReturn, current).where(
        SalesReturn.customer_id.isnot(None), SalesReturn.reversed_at.is_(None))

    if rep_id is not None:
        inv = inv.where(SalesInvoice.rep_id == rep_id)
        ret = ret.where(SalesReturn.rep_id == rep_id)
    if family:
        inv = inv.where(SalesInvoice.family == family)
        ret = ret.where(SalesReturn.family == family)
    if external_document_number:
        inv = inv.where(SalesInvoice.external_document_number.like(
            f"%{external_document_number.strip()}%"))
    if current.rep_id is not None:
        mine = select(Customer.id).where(Customer.rep_id == current.rep_id)
        inv = inv.where(SalesInvoice.customer_id.in_(mine))
        ret = ret.where(SalesReturn.customer_id.in_(mine))
    if q:
        inv = inv.where(SalesInvoice.document_number.like(f"%{q.strip()}%"))
        ret = ret.where(SalesReturn.document_number.like(f"%{q.strip()}%"))
    if customer_id is not None:
        inv = inv.where(SalesInvoice.customer_id == customer_id)
        ret = ret.where(SalesReturn.customer_id == customer_id)
    if date_from is not None:
        inv = inv.where(SalesInvoice.created_at >= clock.day_start_utc(date_from))
        ret = ret.where(SalesReturn.created_at >= clock.day_start_utc(date_from))
    if date_to is not None:
        inv = inv.where(SalesInvoice.created_at < clock.day_end_utc(date_to))
        ret = ret.where(SalesReturn.created_at < clock.day_end_utc(date_to))
    if payment == "cash":
        inv = inv.where(SalesInvoice.credit_amount == 0)
    elif payment == "credit":
        inv = inv.where(SalesInvoice.cash_amount == 0)
    elif payment == "partial":
        inv = inv.where(SalesInvoice.cash_amount > 0, SalesInvoice.credit_amount > 0)

    def totals(stmt, *cols):
        sub = stmt.subquery()
        row = db.execute(select(func.count(), *[func.coalesce(func.sum(sub.c[c]), 0)
                                                for c in cols])
                         .select_from(sub)).one()
        return row

    inv_count, inv_net, inv_credit = totals(inv, "net", "credit_amount")
    ret_count, ret_net, ret_credit = totals(ret, "value", "credit_reduction")
    return {
        "sales_count": inv_count, "sales_net": inv_net,
        "returns_count": ret_count, "returns_net": ret_net,
        "net_sales": inv_net - ret_net,
        "credit_outstanding": inv_credit - ret_credit,
    }


# --- Standalone returns (028): "return like a sale, reversed" ---------------------------------
# Declared BEFORE /{sale_id} so the literal "returns"/"customer-item-history" paths win over the
# int path param.

def _standalone_return_out(r: SalesReturn, db: Session | None = None, *,
                           names: tuple[dict[int, str], dict[int, str],
                                        dict[int, str]] | None = None) -> dict:
    # «الفاتورة رقم» on their مردود مبيعات list — the sale this came back from. The link has always
    # been stored; the number was never returned, so the column that says WHICH sale a return
    # undoes could not be shown beside it.
    invoice_no = None
    if db is not None and r.sales_invoice_id:
        inv = db.get(SalesInvoice, r.sales_invoice_id)
        invoice_no = inv.document_number if inv else None
    cust_names, cust_types, rep_names = names or ({}, {}, {})
    return {
        # الاسم مع الصف — نفس سبب فاتورة البيع: الشاشة ماتحتاجش تحمّل كشف العملاء كله
        # عشان تعرف اسم واحد، والكشف ده هو اللي كان بيقع فتظهر الأكواد.
        "customer_name": cust_names.get(r.customer_id),
        "customer_type": cust_types.get(r.customer_id),
        "rep_name": rep_names.get(r.rep_id) if r.rep_id else None,
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
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
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
    rep_id: int | None = None,
    family: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List standalone sales returns (customer-based), newest first."""
    stmt = branch_scope.scope(select(SalesReturn), SalesReturn, current).where(
        SalesReturn.customer_id.isnot(None), SalesReturn.reversed_at.is_(None))
    if rep_id is not None:
        stmt = stmt.where(SalesReturn.rep_id == rep_id)
    if family:
        stmt = stmt.where(SalesReturn.family == family)
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
    stmt = stmt.order_by(SalesReturn.id.desc())
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    rows = list(db.scalars(stmt).all())
    names = _row_names(db, rows)
    return [_standalone_return_out(r, db, names=names) for r in rows]


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
                              l.warehouse_id, serials=l.serials)
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


@router.put("/returns/{return_id}", response_model=dict)
def update_standalone_return(
    return_id: int,
    body: StandaloneReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """تعديل مرتجع — بيتحفظ مكان القديم بنفس رقمه، من غير قيد عكسي."""
    ret = db.get(SalesReturn, return_id)
    if ret is None:
        raise HTTPException(404, {"code": "not_found", "message": "المرتجع غير موجود"})
    if not branch_scope.may_see(current, ret):
        raise HTTPException(404, {"code": "not_found", "message": "المرتجع مش موجود"})
    _rep_scope_check(db, current, body.customer_id, body.origin)
    try:
        document_edit_service.purge_sales_return(db, ret)
    except DocumentEditError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "edit_blocked", "message": str(exc)})
    try:
        ret = sales_service.create_standalone_return(
            db, customer_id=body.customer_id,
            origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id,
            variable_discount_pct=body.variable_discount_pct,
            cash_refund=body.cash_refund, credit_reduction=body.credit_reduction,
            lines=[ReturnLine(l.item_id, l.quantity, l.unit_price, l.unit, l.discount_pct,
                              l.warehouse_id, serials=l.serials)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, family=body.family,
            rep_id=body.rep_id, revenue_account_id=body.revenue_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            statement1=body.statement1, statement2=body.statement2,
            statement3=body.statement3, return_date=body.return_date,
            replace_return_id=return_id,
        )
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "return_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "no_negative_stock", "message": str(exc)})
    db.commit()
    return _standalone_return_out(ret, db)


@router.delete("/returns/{return_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sales_return(
    return_id: int,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """حذف مرتجع مبيعات — بيروح هو وأثره، مش بيتعكس.

    مُعلن قبل `/returns/{return_id}` بتاع القراية عشان الطريقين مايتلخبطوش، ومن غير قيد
    عكسي: المرتجع اللي اتكتب غلط بيتمسح، والفاتورة بتاعته بترجع قابلة للتعديل تاني.
    """
    try:
        document_edit_service.delete_sales_return(
            db, return_id=return_id, actor_user_id=current.id)
    except DocumentEditError as exc:
        code = 404 if "مش موجود" in str(exc) else status.HTTP_409_CONFLICT
        raise HTTPException(code, {"code": "delete_blocked", "message": str(exc)})
    db.commit()


@router.get("/returns/{return_id}", response_model=dict)
def get_standalone_return(
    return_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    r = db.get(SalesReturn, return_id)
    if r is None:
        raise HTTPException(404, {"code": "not_found", "message": "Return not found"})
    if not branch_scope.may_see(current, r):
        raise HTTPException(404, {"code": "not_found", "message": "المرتجع مش موجود"})
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
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> SalesInvoiceDetail:
    inv = db.get(SalesInvoice, sale_id)
    if inv is None:
        raise HTTPException(404, {"code": "not_found", "message": "Sale not found"})
    if not branch_scope.may_see(current, inv):
        raise HTTPException(404, {"code": "not_found", "message": "الفاتورة غير موجودة"})
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
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
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
