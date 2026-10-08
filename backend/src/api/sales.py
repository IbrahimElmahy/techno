from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from datetime import date, timedelta
from typing import Literal

from sqlalchemy import Date, case, cast, delete as sa_delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from src.lib.doc_order import newest_first
from src.auth.dependencies import CurrentUser, get_current_user, require_capability
from src.auth.rbac import (
    CAP_RETURN_WRITE,
    CAP_SALE_BONUS,
    CAP_SALE_DELETE,
    CAP_SALE_EDIT,
    CAP_SALE_WRITE,
    CAP_SALES_READ,
    CAP_SELL_BELOW_PRICE,
    CAP_SELL_BELOW_COST,
    role_has_capability,
)
from src.core import clock
from src.core.db import get_db
from src.core.money import to_money
from src.models.catalog import Item, ItemPrice, PriceTier
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import LedgerEntry, LedgerLine
from src.models.lookup import LookupOption
from src.models.loyalty import CouponType
from src.models.sales import (
    SalesInvoice,
    SalesInvoiceCoupon,
    SalesInvoiceLine,
    SalesReturn,
)
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.transfer import StockTransfer, StockTransferLine, TransferStatus
from src.models.user import User
from src.models.warehouse import Custody, Warehouse, WarehouseType
from src.lib import arabic
from src.services import (
    analytic_read, coupon_receipt_service, reconcile_service, sales_service,
)
from src.services.rep_store_service import rep_store
from src.services.coupon_receipt_service import CouponReceiptError
from src.services import coupon_custody_service
from src.services.coupon_custody_service import CouponCustodyError
from src.services.sales_service import ReturnLine, SaleLine, SalesError
from src.services import document_edit_service
from src.services.document_edit_service import DocumentEditError
from src.services.account_resolver import AccountResolutionError
from src.services.stock_service import StockError
from src.auth import branch_scope

router = APIRouter(tags=["sales"], prefix="/sales")


def _reject_non_trader(db: Session, customer_id: int) -> None:
    cust = db.get(Customer, customer_id)
    if cust is not None and (cust.customer_type or "") == "plumber":
        raise HTTPException(422, {"code": "validation",
                                  "message": "ليس للسباك فواتير بيع — عمله معاينات وكوبونات ونقاط"})


class LocationIn(BaseModel):
    location_kind: LocationKind
    location_id: int


class SaleLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    tier: PriceTier | None = None
    unit_price: Decimal | None = None
    unit: str | None = None
    serials: list[str] | None = None
    discount_pct: Decimal | None = None
    fixed_discount_pct: Decimal | None = None
    variable_discount_pct: Decimal | None = None
    warehouse_id: int | None = None


class InvoiceExpenseIn(BaseModel):
    account_id: int
    amount: Decimal
    kind: str = "billed"
    description: str | None = None


class InvoiceCouponIn(BaseModel):
    coupon_kind: str | None = None
    coupon_type_id: int | None = None
    count: int | None = None
    serial_from: str | None = None
    serial_to: str | None = None


class InvoiceCouponOut(InvoiceCouponIn):
    id: int
    coupon_type_name: str | None = None


class SaleCreate(BaseModel):
    customer_id: int
    origin: LocationIn
    cash_account_id: int | None = None
    variable_discount_pct: Decimal = Decimal("0")
    cash_amount: Decimal
    credit_amount: Decimal | None = None
    lines: list[SaleLineIn]
    rep_id: int | None = None
    revenue_account_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    cost_center_id: int | None = None
    cost_center_distribution: dict[str, Decimal] | None = None
    statement1: str | None = None
    statement2: str | None = None
    statement3: str | None = None
    coupon_serial_from: str | None = None
    coupon_serial_to: str | None = None
    coupon_count: int | None = None
    coupons: list[InvoiceCouponIn] = []
    invoice_date: date | None = None
    prior_balance: Decimal | None = None
    other_family_balance: Decimal | None = None
    other_family: str | None = None
    expenses: list[InvoiceExpenseIn] = []
    family: str | None = None
    client_uuid: str | None = None
    is_bonus: bool = False
    bonus_for_invoice_id: int | None = None
    bonus_for_client_uuid: str | None = None


class ReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    serials: list[str] | None = None
    expiry_date: date | None = None


class ReturnCreate(BaseModel):
    lines: list[ReturnLineIn]


class StandaloneReturnLineIn(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    unit: str | None = None
    discount_pct: Decimal | None = None
    fixed_discount_pct: Decimal | None = None
    variable_discount_pct: Decimal | None = None
    warehouse_id: int | None = None
    serials: list[str] | None = None


class ReturnedCouponIn(BaseModel):
    serial_from: str
    serial_to: str | None = None
    count: int | None = None


class StandaloneReturnCreate(BaseModel):
    customer_id: int
    family: str | None = None
    origin: LocationIn
    variable_discount_pct: Decimal = Decimal("0")
    cash_refund: Decimal = Decimal("0")
    credit_reduction: Decimal = Decimal("0")
    lines: list[StandaloneReturnLineIn]
    cash_account_id: int | None = None
    rep_id: int | None = None
    revenue_account_id: int | None = None
    external_document_number: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=500)
    cost_center_id: int | None = None
    cost_center_distribution: dict[str, Decimal] | None = None
    statement1: str | None = Field(default=None, max_length=200)
    statement2: str | None = Field(default=None, max_length=200)
    statement3: str | None = Field(default=None, max_length=200)
    return_date: date | None = None
    returned_coupons: list[ReturnedCouponIn] = []


class SalesInvoiceOut(BaseModel):
    id: int
    document_number: str
    customer_id: int
    gross: Decimal
    combined_pct: Decimal
    line_discount: Decimal = Decimal("0")
    gross_before_line_discount: Decimal = Decimal("0")
    net: Decimal
    cash_amount: Decimal
    credit_amount: Decimal
    cash_account_id: int
    ledger_entry_id: int | None = None
    payment_state: str | None = None
    payment_state_label: str | None = None
    residual: Decimal | None = None
    created_at: str | None = None
    rep_id: int | None = None
    external_document_number: str | None = None
    notes: str | None = None
    cost_center_id: int | None = None
    cost_center_distribution: dict[str, Decimal] | None = None
    revenue_account_id: int | None = None
    coupon_serial_from: str | None = None
    coupon_serial_to: str | None = None
    coupon_count: int | None = None
    coupons: list[InvoiceCouponOut] = []
    invoice_date: date | None = None
    customer_name: str | None = None
    rep_name: str | None = None
    customer_type: str | None = None
    family: str | None = None
    prior_balance: Decimal | None = None
    other_family_balance: Decimal | None = None
    other_family: str | None = None
    expenses_billed: Decimal | None = None
    expenses_operating: Decimal | None = None
    is_bonus: bool = False
    bonus_for_invoice_id: int | None = None
    bonus_for_number: str | None = None
    statement1: str | None = None


class InvoiceLineOut(BaseModel):
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal | None = None
    fixed_discount_pct: Decimal | None = None
    variable_discount_pct: Decimal | None = None
    line_total: Decimal
    price_tier: PriceTier | None = None
    unit: str | None = None
    unit_factor: Decimal | None = None
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
    cost_center_id: int | None = None
    cost_center_distribution: dict[str, Decimal] | None = None
    prior_balance: Decimal | None = None
    other_family_balance: Decimal | None = None
    other_family: str | None = None
    customer_name: str | None = None
    rep_id: int | None = None
    rep_name: str | None = None
    family: str | None = None
    invoice_date: date | None = None
    external_document_number: str | None = None
    notes: str | None = None
    statement1: str | None = None
    statement2: str | None = None
    statement3: str | None = None
    fixed_discount_pct: Decimal | None = None
    variable_discount_pct: Decimal | None = None
    is_bonus: bool = False
    bonus_for_invoice_id: int | None = None
    bonus_for_number: str | None = None
    lines: list[InvoiceLineOut]
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
            "message": "ليس لديك عهدة ولا مخزن مسجّل — تواصل مع المخزن قبل البيع."})
    if (origin.location_kind, origin.location_id) != store:
        raise HTTPException(403, {
            "code": "forbidden",
            "message": "يجب أن تبيع من مخزنك أنت."})


def _line_locations_check(db: Session, current: CurrentUser, body) -> None:
    from src.models.warehouse import Warehouse

    line_whs = {w for w in (getattr(ln, "warehouse_id", None) for ln in body.lines) if w}
    if current.rep_id is not None:
        store = rep_store(db, current.rep_id)
        own = store[1] if store and getattr(store[0], "value", store[0]) == "warehouse" else None
        if any(w != own for w in line_whs):
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "يجب أن تُصرف كل الأصناف من مخزنك أنت."})
        return
    branch_id = branch_scope.visible_branch_id(current)
    if branch_id is None:
        return
    whs = set(line_whs)
    if getattr(body.origin.location_kind, "value", body.origin.location_kind) == "warehouse":
        whs.add(body.origin.location_id)
    for wid in whs:
        wh = db.get(Warehouse, wid)
        if wh is None:
            raise HTTPException(422, {"code": "validation", "message": f"المخزن رقم {wid} غير موجود."})
        if wh.branch_id is not None and wh.branch_id != branch_id:
            raise HTTPException(403, {"code": "forbidden",
                                      "message": f"«{wh.name}» ليس في فرعك — لا يمكنك البيع منه."})


def _rep_treasuries(db: Session, rep_id: int) -> list[dict]:
    from src.models.ledger import Account

    rows = db.execute(
        select(Custody, Account)
        .join(Account, Account.id == Custody.account_id)
        .where(Custody.rep_id == rep_id, Custody.active.is_(True))
        .order_by(Custody.family.is_(None), Custody.family, Custody.id)
    ).all()
    return [
        {
            "custody_id": c.id,
            "account_id": acc.id,
            "family": c.family,
            "name": acc.name or "",
            "code": acc.code or "",
        }
        for c, acc in rows
    ]


def _scoped_warehouses(current: CurrentUser):
    stmt = select(Warehouse).where(Warehouse.active.is_(True))
    if not current.is_admin and current.branch_id is not None:
        stmt = stmt.where(
            (Warehouse.branch_id == current.branch_id)
            | (Warehouse.warehouse_type == WarehouseType.central)
        )
    return stmt.order_by(Warehouse.name)


@router.get("/rep-bundle", response_model=dict)
def rep_bundle(
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    if current.rep_id is None:
        raise HTTPException(403, {"code": "forbidden", "message": "هذه الشاشة للمناديب."})
    store = rep_store(db, current.rep_id)
    if store is None:
        raise HTTPException(404, {
            "code": "not_found", "message": "ليس لديك عهدة ولا مخزن مسجّل."})
    store_kind, store_id = store

    customers = db.scalars(
        select(Customer).where(Customer.rep_id == current.rep_id, Customer.active.is_(True))
        .order_by(Customer.name)
    ).all()

    from src.services import chart_service

    _ZERO = Decimal("0")

    from src.models.lookup import LookupOption

    cat_rows = db.execute(
        select(LookupOption.value, LookupOption.label, LookupOption.parent_value,
               LookupOption.hidden_in_price_sheet)
        .where(LookupOption.category == "item_category")).all()
    cat_label = {r[0]: r[1] for r in cat_rows}
    hidden_vals = {r[0] for r in cat_rows if r[3]}
    price_sheet_hidden = sorted(
        r[1] for r in cat_rows if r[0] in hidden_vals or r[2] in hidden_vals)

    acct_balance = chart_service.bulk_balances(db)
    accounts_by_customer: dict[int, list[CustomerAccount]] = {}
    if customers:
        for acc in db.scalars(
            select(CustomerAccount).where(
                CustomerAccount.customer_id.in_([c.id for c in customers]))
        ).all():
            accounts_by_customer.setdefault(acc.customer_id, []).append(acc)

    signed = case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    )
    held = db.execute(
        select(Item.id, Item.name, Item.unit_of_measure, Item.default_discount_pct,
               Item.sale_price, func.coalesce(func.sum(signed), 0).label("qty"),
               Item.category)
        .join(StockMovement, StockMovement.item_id == Item.id)
        .where(StockMovement.location_kind == store_kind,
               StockMovement.location_id == store_id,
               Item.active.is_(True))
        .group_by(Item.id, Item.name, Item.unit_of_measure, Item.default_discount_pct,
                  Item.sale_price, Item.category)
        .order_by(arabic.sort_key(Item.name), Item.name)
    ).all()
    on_hand = {r[0]: Decimal(str(r[5] or 0)) for r in held}

    pending_out: dict[int, Decimal] = {}
    _pending_q = (
        select(StockTransfer.id, StockTransfer.item_id, StockTransfer.quantity)
        .where(StockTransfer.status == TransferStatus.pending,
               StockTransfer.source_location_kind == store_kind,
               StockTransfer.source_location_id == store_id)
    )
    _pending_rows = db.execute(_pending_q).all()
    if _pending_rows:
        _ids = [r[0] for r in _pending_rows]
        _lines_by_transfer: dict[int, list[tuple[int, Decimal]]] = {}
        for ln in db.scalars(
            select(StockTransferLine).where(StockTransferLine.transfer_id.in_(_ids))
        ).all():
            _lines_by_transfer.setdefault(ln.transfer_id, []).append(
                (ln.item_id, Decimal(str(ln.quantity))))
        for tid, item_id, qty in _pending_rows:
            rows = _lines_by_transfer.get(tid) or [(item_id, Decimal(str(qty or 0)))]
            for line_item, line_qty in rows:
                if line_item is None:
                    continue
                pending_out[line_item] = pending_out.get(line_item, Decimal("0")) + line_qty

    live = [r for r in held if on_hand[r[0]] > 0]

    scoped = db.scalars(_scoped_warehouses(current)).all()
    warehouse_items: dict[str, list[dict]] = {}
    if scoped:
        wh_rows = db.execute(
            select(StockMovement.location_id, Item.id, Item.name,
                   Item.unit_of_measure, Item.category,
                   func.coalesce(func.sum(signed), 0).label("qty"))
            .join(Item, Item.id == StockMovement.item_id)
            .where(StockMovement.location_kind == LocationKind.warehouse,
                   StockMovement.location_id.in_([w.id for w in scoped]),
                   Item.active.is_(True))
            .group_by(StockMovement.location_id, Item.id, Item.name,
                      Item.unit_of_measure, Item.category)
            .order_by(arabic.sort_key(Item.name), Item.name)
        ).all()
        for wid, item_id, name, unit, category, qty in wh_rows:
            if Decimal(str(qty or 0)) <= 0:
                continue
            warehouse_items.setdefault(str(wid), []).append({
                "item_id": item_id, "name": name, "unit": unit,
                "category": cat_label.get(category, category),
            })

    catalog = db.execute(
        select(Item.id, Item.name, Item.unit_of_measure, Item.category,
               Item.sale_price, Item.default_discount_pct)
        .where(Item.active.is_(True))
        .order_by(arabic.sort_key(Item.name), Item.name)
    ).all()

    tiers: dict[int, dict[str, str]] = {}
    _priced = {r[0] for r in live} | {c[0] for c in catalog}
    if _priced:
        for row in db.scalars(
            select(ItemPrice).where(ItemPrice.item_id.in_(_priced))
        ).all():
            tiers.setdefault(row.item_id, {})[row.tier.value] = str(row.price)

    coupon_custody, coupon_custody_kinds = coupon_custody_service.rep_bundle(
        db, current.rep_id)

    from src.services import costing_service

    min_prices = costing_service.average_cost_bulk(db, [r[0] for r in live]) if live else {}

    return {
        "rep_id": current.rep_id,
        "coupon_custody": coupon_custody,
        "coupon_custody_kinds": coupon_custody_kinds,
        "can_sell_below_price": current.can(CAP_SELL_BELOW_PRICE),
        "can_sell_below_cost": current.can(CAP_SELL_BELOW_COST),
        "store_kind": store_kind.value,
        "store_id": store_id,
        "custody_id": store_id if store_kind == LocationKind.custody else None,
        "warehouses": [
            {"id": w.id, "name": w.name, "kind": w.warehouse_type.value}
            for w in scoped
        ],
        "warehouse_items": warehouse_items,
        "treasuries": _rep_treasuries(db, current.rep_id),
        "recent_invoices": _rep_recent_invoices(db, current.rep_id),
        "customers": [
            {
                "id": c.id, "name": c.name, "phone": c.phone, "address": c.address,
                "price_tier": c.default_price_tier.value if c.default_price_tier else None,
                "customer_type": c.customer_type,
                "families": sorted(
                    {a.family for a in accounts_by_customer.get(c.id, []) if a.family}),
                "family_balances": {
                    a.family: str(acct_balance.get(a.account_id, _ZERO))
                    for a in accounts_by_customer.get(c.id, []) if a.family
                },
                "balance": str(sum(
                    (acct_balance.get(a.account_id, _ZERO)
                     for a in accounts_by_customer.get(c.id, [])), _ZERO)),
            }
            for c in customers
        ],
        "items": [
            {
                "item_id": r[0], "name": r[1], "unit": r[2],
                "default_discount_pct": str(r[3]) if r[3] is not None else None,
                "base_price": str(r[4]) if r[4] is not None else None,
                "on_hand": str(on_hand[r[0]]),
                "pending_out": str(pending_out.get(r[0], Decimal("0"))),
                "category": cat_label.get(r[6], r[6]),
                "tier_prices": tiers.get(r[0], {}),
                "min_price": (str(min_prices[r[0]])
                              if min_prices.get(r[0], Decimal("0")) > 0 else None),
            }
            for r in live
        ],
        "catalog": [
            {
                "item_id": c[0], "name": c[1], "unit": c[2],
                "category": cat_label.get(c[3], c[3]),
                "base_price": str(c[4]) if c[4] is not None else None,
                "default_discount_pct": str(c[5]) if c[5] is not None else None,
                "tier_prices": tiers.get(c[0], {}),
            }
            for c in catalog
        ],
        "price_sheet_hidden_categories": price_sheet_hidden,
    }


def _rep_recent_invoices(db: Session, rep_id: int) -> list[dict]:
    since = date.today() - timedelta(days=60)
    rows = db.scalars(
        select(SalesInvoice)
        .options(selectinload(SalesInvoice.lines))
        .where(SalesInvoice.rep_id == rep_id,
               SalesInvoice.client_uuid.is_not(None),
               func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
               >= since)
    ).all()
    out = []
    for inv in rows:
        out.append({
            "client_uuid": inv.client_uuid,
            "id": inv.id,
            "document_number": inv.document_number,
            "cash_amount": str(inv.cash_amount or 0),
            "credit_amount": str(inv.credit_amount or 0),
            "total": str(inv.net or 0),
            "prior_balance": str(inv.prior_balance) if inv.prior_balance is not None else None,
            "lines": [
                {
                    "item_id": ln.item_id,
                    "quantity": str(ln.quantity),
                    "unit_price": str(ln.unit_price),
                    "discount_pct": str(ln.discount_pct or 0),
                    "fixed_discount_pct": str(ln.fixed_discount_pct or 0),
                    "variable_discount_pct": str(ln.variable_discount_pct or 0),
                    "line_total": str(ln.line_total or 0),
                }
                for ln in inv.lines
            ],
        })
    return out


_AR_FOLD = (("ة", "ه"), ("ى", "ي"), ("أ", "ا"), ("إ", "ا"), ("آ", "ا"))


def _fold_sql(col):
    expr = func.lower(func.coalesce(col, ""))
    for a, b in _AR_FOLD:
        expr = func.replace(expr, a, b)
    return expr


def _statement_like(model, text: str | None):
    if not text or not text.strip():
        return None
    needle = " ".join(text.split()).lower()
    for a, b in _AR_FOLD:
        needle = needle.replace(a, b)
    pat = f"%{needle}%"
    return or_(_fold_sql(model.statement1).like(pat), _fold_sql(model.statement2).like(pat),
               _fold_sql(model.statement3).like(pat))


def _is_full_discount(body: "SaleCreate") -> bool:
    if Decimal(body.variable_discount_pct or 0) >= Decimal("100"):
        return True
    if not body.lines:
        return False

    def full(ln) -> bool:
        if ln.fixed_discount_pct is not None or ln.variable_discount_pct is not None:
            f = Decimal(ln.fixed_discount_pct or 0)
            v = Decimal(ln.variable_discount_pct or 0)
            return f >= 100 or v >= 100 or (1 - f / 100) * (1 - v / 100) <= 0
        return Decimal(ln.discount_pct or 0) >= Decimal("100")
    return all(full(ln) for ln in body.lines)


def _build_sale(
    db: Session, body: "SaleCreate", current: CurrentUser, *,
    replace_invoice_id: int | None = None,
    keep_costs: dict[int, Decimal] | None = None,
) -> SalesInvoice:
    _rep_scope_check(db, current, body.customer_id, body.origin)
    _line_locations_check(db, current, body)
    _reject_non_trader(db, body.customer_id)
    bonus_for = body.bonus_for_invoice_id
    if not body.is_bonus and _is_full_discount(body):
        body.is_bonus = True
    if body.is_bonus:
        if not current.can(CAP_SALE_BONUS):
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "ليس لديك صلاحية «إصدار فاتورة بونص»."})
        if bonus_for is None and body.bonus_for_client_uuid:
            bonus_for = db.scalar(select(SalesInvoice.id).where(
                SalesInvoice.client_uuid == body.bonus_for_client_uuid))
        target = db.get(SalesInvoice, bonus_for) if bonus_for else None
        if target is not None and (not branch_scope.may_see(current, target) or (
                current.rep_id is not None and not (
                    target.rep_id == current.id
                    or (target.rep_id is None and target.actor_user_id == current.id)))):
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "يجب أن يكون البونص على فاتورة من فواتيرك."})
    can_sell_below = current.can(CAP_SELL_BELOW_PRICE)
    can_sell_below_cost = current.can(CAP_SELL_BELOW_COST)
    try:
        inv = sales_service.create_sale(
            db, customer_id=body.customer_id, origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id,
            variable_discount_pct=body.variable_discount_pct,
            cash_amount=body.cash_amount, credit_amount=body.credit_amount,
            lines=[SaleLine(l.item_id, l.quantity, l.tier, l.unit_price, l.unit, l.serials,
                            l.discount_pct, l.fixed_discount_pct, l.variable_discount_pct,
                            l.warehouse_id)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, family=body.family,
            cash_account_id=body.cash_account_id,
            has_coupon_rows=any(
                c.coupon_kind or c.coupon_type_id is not None or c.count
                or c.serial_from or c.serial_to for c in body.coupons),
            can_sell_below=can_sell_below,
            can_sell_below_cost=can_sell_below_cost,
            is_bonus=body.is_bonus, bonus_for_invoice_id=bonus_for,
            rep_id=body.rep_id, revenue_account_id=body.revenue_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            cost_center_id=body.cost_center_id,
            cost_center_distribution=body.cost_center_distribution,
            coupon_serial_from=body.coupon_serial_from,
            coupon_serial_to=body.coupon_serial_to, coupon_count=body.coupon_count,
            invoice_date=body.invoice_date,
            expenses=[e.model_dump() for e in body.expenses],
            statement1=body.statement1, statement2=body.statement2, statement3=body.statement3,
            client_uuid=body.client_uuid,
            replace_invoice_id=replace_invoice_id,
            keep_costs=keep_costs,
        )
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "sale_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "no_negative_stock", "message": str(exc)})
    except AccountResolutionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "account_missing", "message": str(exc)})

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
            serial_from=coupon_custody_service.ascii_digits(c.serial_from) or None,
            serial_to=coupon_custody_service.ascii_digits(c.serial_to) or None,
        ))
    db.flush()

    from types import SimpleNamespace

    custody_rows: list = list(body.coupons)
    if body.coupon_serial_from or body.coupon_serial_to:
        custody_rows.append(SimpleNamespace(
            coupon_kind=None, count=body.coupon_count,
            serial_from=body.coupon_serial_from, serial_to=body.coupon_serial_to))
    try:
        coupon_custody_service.consume_for_invoice(db, inv, inv.rep_id, custody_rows)
        if replace_invoice_id:
            coupon_custody_service.assert_received_kept(db, inv)
    except CouponCustodyError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "coupon_custody", "message": str(exc)}) from exc
    return inv


@router.put("/{sale_id}", response_model=SalesInvoiceOut)
def update_sale(
    sale_id: int,
    body: SaleCreate,
    current: CurrentUser = Depends(require_capability(CAP_SALE_EDIT)),
    db: Session = Depends(get_db),
) -> SalesInvoiceOut:
    inv = db.get(SalesInvoice, sale_id)
    if inv is None:
        raise HTTPException(404, {"code": "not_found", "message": "الفاتورة غير موجودة"})
    if not branch_scope.may_see(current, inv):
        raise HTTPException(404, {"code": "not_found", "message": "الفاتورة غير موجودة"})
    if current.rep_id is not None:
        mine = inv.rep_id == current.id or (inv.rep_id is None and inv.actor_user_id == current.id)
        if not mine:
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "هذه ليست فاتورتك — يمكنك تعديل فواتيرك أنت فقط."})
        if body.rep_id not in (None, current.id):
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "لا يمكنك تسجيل الفاتورة باسم مندوب آخر."})
    try:
        document_edit_service.assert_sale_editable(db, inv)
        kept_costs = document_edit_service.frozen_costs(db, inv)
        document_edit_service.purge_sale(db, inv)
    except DocumentEditError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "edit_blocked", "message": str(exc)})
    inv = _build_sale(db, body, current, replace_invoice_id=sale_id,
                      keep_costs=kept_costs)
    db.commit()
    return _inv_out(inv, db, payment_states=_payment_states(db, [inv]))


@router.delete("/{sale_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sale(
    sale_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALE_DELETE)),
    db: Session = Depends(get_db),
) -> None:
    inv = db.get(SalesInvoice, sale_id)
    if inv is None or not branch_scope.may_see(current, inv):
        raise HTTPException(404, {"code": "delete_blocked", "message": "الفاتورة غير موجودة"})
    bonuses = db.scalars(select(SalesInvoice.document_number).where(
        SalesInvoice.bonus_for_invoice_id == sale_id)).all()
    if bonuses:
        raise HTTPException(409, {"code": "delete_blocked",
                                  "message": f"على هذه الفاتورة بونص ({'، '.join(bonuses)}) — احذفه أولاً."})
    try:
        document_edit_service.delete_sale(
            db, invoice_id=sale_id, actor_user_id=current.id)
    except DocumentEditError as exc:
        code = 404 if any(s in str(exc) for s in ("مش موجودة", "غير موجودة", "مش موجود", "غير موجود")) else status.HTTP_409_CONFLICT
        raise HTTPException(code, {"code": "delete_blocked", "message": str(exc)})
    db.commit()


@router.post("", response_model=SalesInvoiceOut, status_code=status.HTTP_201_CREATED)
def create_sale(
    body: SaleCreate,
    current: CurrentUser = Depends(require_capability(CAP_SALE_WRITE)),
    db: Session = Depends(get_db),
) -> SalesInvoiceOut:
    if body.client_uuid:
        seen = db.scalar(select(SalesInvoice).where(
            SalesInvoice.client_uuid == body.client_uuid))
        if seen is not None:
            return _inv_out(seen, db)

    inv = _build_sale(db, body, current)
    db.commit()
    return _inv_out(inv, db, payment_states=_payment_states(db, [inv]))


def _type_labels(db: Session) -> dict[str, str]:
    return dict(db.execute(
        select(LookupOption.value, LookupOption.label)
        .where(LookupOption.category == "customer_type")).all())


def _row_names(db: Session, rows: list) -> tuple[dict[int, str], dict[int, str],
                                                 dict[int, str]]:
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


def _line_discounts(db: Session, rows: list[SalesInvoice]) -> dict[int, tuple[Decimal, Decimal]]:
    if not rows:
        return {}
    before = func.sum(SalesInvoiceLine.quantity * SalesInvoiceLine.unit_price)
    after = func.sum(SalesInvoiceLine.line_total)
    after_fixed = func.sum(SalesInvoiceLine.quantity * SalesInvoiceLine.unit_price
                           * (1 - func.coalesce(SalesInvoiceLine.fixed_discount_pct, 0) / 100))
    bonus_ids = {r.id for r in rows if getattr(r, "is_bonus", False)}
    out: dict[int, tuple[Decimal, Decimal]] = {}
    for inv_id, b, a, af in db.execute(
        select(SalesInvoiceLine.invoice_id, before, after, after_fixed)
        .where(SalesInvoiceLine.invoice_id.in_([r.id for r in rows]))
        .group_by(SalesInvoiceLine.invoice_id)
    ).all():
        if inv_id in bonus_ids:
            out[inv_id] = (to_money(Decimal(str(af or 0))), Decimal("0"))
            continue
        gross_before = Decimal(str(b or 0))
        net_lines = Decimal(str(a or 0))
        gap = gross_before - net_lines
        out[inv_id] = (gross_before, gap if gap > 0 else Decimal("0"))
    return out


def _page_coupons(db: Session, rows: list[SalesInvoice]) -> dict[int, list[InvoiceCouponOut]]:
    if not rows:
        return {}
    coupon_rows = db.scalars(
        select(SalesInvoiceCoupon)
        .where(SalesInvoiceCoupon.invoice_id.in_([r.id for r in rows]))
    ).all()
    if not coupon_rows:
        return {}
    type_names: dict[int, str] = {}
    ids = [r.coupon_type_id for r in coupon_rows if r.coupon_type_id]
    if ids:
        type_names = dict(db.execute(
            select(CouponType.id, CouponType.name).where(CouponType.id.in_(ids))
        ).all())
    out: dict[int, list[InvoiceCouponOut]] = {}
    for r in coupon_rows:
        out.setdefault(r.invoice_id, []).append(InvoiceCouponOut(
            id=r.id, coupon_kind=r.coupon_kind, coupon_type_id=r.coupon_type_id,
            count=r.count, serial_from=r.serial_from, serial_to=r.serial_to,
            coupon_type_name=type_names.get(r.coupon_type_id),
        ))
    return out


def _payment_states(db: Session, rows) -> dict[int, tuple[str | None, Decimal]]:
    entry_ids = [r.ledger_entry_id for r in rows if r.ledger_entry_id]
    if not entry_ids:
        return {}
    entries = db.scalars(
        select(LedgerEntry).options(selectinload(LedgerEntry.lines))
        .where(LedgerEntry.id.in_(entry_ids))
    ).all()
    out: dict[int, tuple[str | None, Decimal]] = {}
    for entry in entries:
        residual = sum(
            (Decimal(str(ln.amount_residual)) for ln in entry.lines
             if ln.amount_residual is not None), Decimal("0.00"))
        out[entry.id] = (entry.payment_state, residual)
    return out


def _inv_out(inv: SalesInvoice, db: Session | None = None, *,
             names: tuple[dict[int, str], dict[int, str], dict[int, str]] | None = None,
             line_disc: tuple[Decimal, Decimal] | None = None,
             coupons_in: list[InvoiceCouponOut] | None = None,
             payment_states: dict[int, tuple[str | None, Decimal]] | None = None,
             bonus_for_numbers: dict[int, str] | None = None,
             ) -> SalesInvoiceOut:
    coupons: list[InvoiceCouponOut] = coupons_in or []
    if db is not None:
        rows = db.scalars(
            select(SalesInvoiceCoupon).where(SalesInvoiceCoupon.invoice_id == inv.id)
        ).all()
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
    disc = line_disc or (Decimal("0"), Decimal("0"))
    return SalesInvoiceOut(
        gross_before_line_discount=disc[0],
        line_discount=disc[1],
        family=inv.family,
        customer_type=cust_types.get(inv.customer_id),
        customer_name=cust_names.get(inv.customer_id),
        rep_name=rep_names.get(inv.rep_id) if inv.rep_id else None,
        coupons=coupons,
        id=inv.id, document_number=inv.document_number, customer_id=inv.customer_id,
        gross=inv.gross, combined_pct=inv.combined_pct, net=inv.net, cash_amount=inv.cash_amount,
        credit_amount=inv.credit_amount, cash_account_id=inv.cash_account_id,
        ledger_entry_id=inv.ledger_entry_id,
        payment_state=(payment_states or {}).get(inv.ledger_entry_id or 0, (None, None))[0],
        payment_state_label=reconcile_service.PAYMENT_STATE_LABEL.get(
            ((payment_states or {}).get(inv.ledger_entry_id or 0, (None, None))[0]) or ""),
        residual=(payment_states or {}).get(inv.ledger_entry_id or 0, (None, None))[1],
        created_at=str(inv.created_at) if inv.created_at else None,
        rep_id=inv.rep_id, external_document_number=inv.external_document_number,
        coupon_serial_from=inv.coupon_serial_from, coupon_serial_to=inv.coupon_serial_to,
        coupon_count=inv.coupon_count, invoice_date=inv.invoice_date,
        prior_balance=getattr(inv, "prior_balance", None),
        other_family_balance=getattr(inv, "other_family_balance", None),
        other_family=getattr(inv, "other_family", None),
        expenses_billed=getattr(inv, "expenses_billed", None),
        expenses_operating=getattr(inv, "expenses_operating", None),
        notes=inv.notes,
        cost_center_id=getattr(inv, "cost_center_id", None),
        revenue_account_id=inv.revenue_account_id,
        is_bonus=bool(getattr(inv, "is_bonus", None)),
        statement1=inv.statement1,
        bonus_for_invoice_id=getattr(inv, "bonus_for_invoice_id", None),
        bonus_for_number=(
            (bonus_for_numbers or {}).get(inv.bonus_for_invoice_id)
            if bonus_for_numbers is not None and getattr(inv, "bonus_for_invoice_id", None)
            else db.scalar(select(SalesInvoice.document_number).where(
                SalesInvoice.id == inv.bonus_for_invoice_id))
            if db is not None and getattr(inv, "bonus_for_invoice_id", None) else None),
    )


def _sales_list_stmt(
    current: CurrentUser, *, q: str | None = None, customer_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None, payment: str | None = None,
    rep_id: int | None = None, family: str | None = None,
    external_document_number: str | None = None, ids: str | None = None,
    kind: str | None = None, statement: str | None = None,
):
    stmt = branch_scope.scope(select(SalesInvoice), SalesInvoice, current)
    if (cond := _statement_like(SalesInvoice, statement)) is not None:
        stmt = stmt.where(cond)
    if kind == "bonus":
        stmt = stmt.where(SalesInvoice.is_bonus.is_(True))
    elif kind == "sale":
        stmt = stmt.where(or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)))
    if ids:
        wanted = [int(x) for x in ids.split(",") if x.strip().lstrip("-").isdigit()]
        stmt = stmt.where(SalesInvoice.id.in_(wanted or [-1]))
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
        stmt = stmt.where(SalesInvoice.invoice_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(SalesInvoice.invoice_date <= date_to)
    if payment == "cash":
        stmt = stmt.where(SalesInvoice.credit_amount == 0)
    elif payment == "credit":
        stmt = stmt.where(SalesInvoice.cash_amount == 0)
    elif payment == "partial":
        stmt = stmt.where(SalesInvoice.cash_amount > 0, SalesInvoice.credit_amount > 0)
    return stmt


@router.get("", response_model=list[SalesInvoiceOut])
def list_sales(
    q: str | None = None,
    customer_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    payment: str | None = None,
    rep_id: int | None = None,
    family: str | None = None,
    external_document_number: str | None = None,
    ids: str | None = None,
    kind: str | None = None,
    statement: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> list[SalesInvoiceOut]:
    stmt = _sales_list_stmt(
        current, q=q, customer_id=customer_id, date_from=date_from, date_to=date_to,
        payment=payment, rep_id=rep_id, family=family,
        external_document_number=external_document_number, ids=ids, kind=kind,
        statement=statement)
    stmt = stmt.order_by(*newest_first(SalesInvoice, SalesInvoice.invoice_date))
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    rows = list(db.scalars(stmt).all())
    names = _row_names(db, rows)
    discs = _line_discounts(db, rows)
    coups = _page_coupons(db, rows)
    states = _payment_states(db, rows)
    target_ids = {i.bonus_for_invoice_id for i in rows if getattr(i, "bonus_for_invoice_id", None)}
    bonus_for = dict(db.execute(
        select(SalesInvoice.id, SalesInvoice.document_number)
        .where(SalesInvoice.id.in_(target_ids))).all()) if target_ids else {}
    return [_inv_out(i, names=names, line_disc=discs.get(i.id),
                     coupons_in=coups.get(i.id), payment_states=states,
                     bonus_for_numbers=bonus_for)
            for i in rows]


@router.get("/bonus-report", response_model=dict)
def bonus_report(
    date_from: date | None = None,
    date_to: date | None = None,
    group: str = "customer",
    rep_id: int | None = None,
    customer_id: int | None = None,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    qty_value = SalesInvoiceLine.quantity * SalesInvoiceLine.unit_price
    qty_cost = SalesInvoiceLine.quantity * func.coalesce(SalesInvoiceLine.unit_cost, 0)
    if group == "rep":
        key = SalesInvoice.rep_id
    elif group == "month":
        key = func.to_char(SalesInvoice.invoice_date, "YYYY-MM")
    else:
        key = SalesInvoice.customer_id
    stmt = (select(key.label("k"), func.count(func.distinct(SalesInvoice.id)),
                   func.coalesce(func.sum(qty_value), 0), func.coalesce(func.sum(qty_cost), 0))
            .join(SalesInvoiceLine, SalesInvoiceLine.invoice_id == SalesInvoice.id)
            .where(SalesInvoice.is_bonus.is_(True)))
    stmt = branch_scope.scope(stmt, SalesInvoice, current)
    if date_from is not None:
        stmt = stmt.where(SalesInvoice.invoice_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(SalesInvoice.invoice_date <= date_to)
    if rep_id is not None:
        stmt = stmt.where(SalesInvoice.rep_id == rep_id)
    if customer_id is not None:
        stmt = stmt.where(SalesInvoice.customer_id == customer_id)
    if current.rep_id is not None:
        stmt = stmt.where(SalesInvoice.rep_id == current.id)
    rows = db.execute(stmt.group_by(key).order_by(func.sum(qty_cost).desc())).all()

    names: dict = {}
    keys = [r[0] for r in rows if r[0] is not None]
    if group == "customer" and keys:
        names = dict(db.execute(select(Customer.id, Customer.name)
                                .where(Customer.id.in_(keys))).all())
    elif group == "rep" and keys:
        names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(keys))).all())
    out = [{
        "key": r[0],
        "name": (names.get(r[0]) or ("بدون مندوب" if group == "rep" else "-")) if group != "month" else r[0],
        "invoices": r[1], "value": str(to_money(r[2])), "cost": str(to_money(r[3])),
    } for r in rows]
    return {
        "group": group, "rows": out,
        "total_invoices": sum(r[1] for r in rows),
        "total_value": str(to_money(sum((Decimal(r[2]) for r in rows), Decimal(0)))),
        "total_cost": str(to_money(sum((Decimal(r[3]) for r in rows), Decimal(0)))),
    }


@router.get("/receipts-log", response_model=dict)
def receipts_log(
    customer_id: int | None = Query(None),
    rep_id: int | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    family: str | None = Query(None),
    statement: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(500, le=2000),
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    from src.models.voucher import Voucher, VoucherKind
    from src.auth import branch_scope as _bs

    users = dict(db.execute(select(User.id, User.full_name)).all())
    wh_names = dict(db.execute(select(Warehouse.id, Warehouse.name)).all())
    cu_names = {cid: f"عهدة {users.get(rid) or ''}".strip()
                for cid, rid in db.execute(select(Custody.id, Custody.rep_id)).all()}

    def loc_name(kind, loc_id):
        if loc_id is None:
            return None
        k = getattr(kind, "value", kind)
        return (cu_names if k == "custody" else wh_names).get(loc_id)

    store_cache: dict[int, str | None] = {}

    def store_of_rep(uid):
        if not uid:
            return None
        if uid not in store_cache:
            st = rep_store(db, uid)
            store_cache[uid] = loc_name(st[0], st[1]) if st else None
        return store_cache[uid]

    inv_stmt = _bs.scope(select(SalesInvoice), SalesInvoice, current).where(
        SalesInvoice.cash_amount > 0,
        or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)))
    v_stmt = _bs.scope(select(Voucher), Voucher, current).where(
        Voucher.kind == VoucherKind.receipt, Voucher.customer_id.is_not(None))
    inv_day = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    if customer_id:
        inv_stmt = inv_stmt.where(SalesInvoice.customer_id == customer_id)
        v_stmt = v_stmt.where(Voucher.customer_id == customer_id)
    if rep_id:
        inv_stmt = inv_stmt.where(SalesInvoice.rep_id == rep_id)
        v_stmt = v_stmt.where(or_(Voucher.rep_user_id == rep_id,
                                  (Voucher.rep_user_id.is_(None)
                                   & Voucher.client_uuid.is_not(None)
                                   & (Voucher.actor_user_id == rep_id))))
    if date_from:
        inv_stmt = inv_stmt.where(inv_day >= date_from)
        v_stmt = v_stmt.where(Voucher.voucher_date >= date_from)
    if date_to:
        inv_stmt = inv_stmt.where(inv_day <= date_to)
        v_stmt = v_stmt.where(Voucher.voucher_date <= date_to)
    if family:
        inv_stmt = inv_stmt.where(SalesInvoice.family == family)
        v_stmt = v_stmt.where(Voucher.family == family)
    if (cond := _statement_like(SalesInvoice, statement)) is not None:
        inv_stmt = inv_stmt.where(cond)
        needle = " ".join(statement.split()).lower()
        for a, b in _AR_FOLD:
            needle = needle.replace(a, b)
        v_stmt = v_stmt.where(or_(_fold_sql(Voucher.statement1).like(f"%{needle}%"),
                                  _fold_sql(Voucher.description).like(f"%{needle}%")))
    if q and q.strip():
        pat = f"%{q.strip()}%"
        named = select(Customer.id).where(Customer.name.like(pat))
        inv_stmt = inv_stmt.where(SalesInvoice.document_number.like(pat))
        v_stmt = v_stmt.where(or_(Voucher.document_number.like(pat),
                                  Voucher.external_document_number.like(pat),
                                  Voucher.reference.like(pat),
                                  Voucher.customer_id.in_(named)))

    def _agg(stmt, col):
        sub = stmt.subquery()
        n, s = db.execute(select(func.count(), func.coalesce(func.sum(sub.c[col]), 0))
                          .select_from(sub)).one()
        return int(n or 0), to_money(Decimal(str(s or 0)))

    n_inv, total_inv = _agg(inv_stmt, "cash_amount")
    n_v, total_v = _agg(v_stmt, "amount")

    invs = db.scalars(inv_stmt.order_by(inv_day.desc(), SalesInvoice.id.desc()).limit(limit)).all()
    vouchers = db.scalars(v_stmt.order_by(Voucher.voucher_date.desc(), Voucher.id.desc())
                          .limit(limit)).all()
    cust_ids = {r.customer_id for r in invs} | {v.customer_id for v in vouchers}
    custs = dict(db.execute(select(Customer.id, Customer.name)
                            .where(Customer.id.in_(cust_ids))).all()) if cust_ids else {}
    from src.models.cost_center import CostCenter
    from src.services.voucher_service import cash_labeler, invoice_cash_accounts
    inv_cash = {r.id: r.cash_account_id for r in invs if r.cash_account_id}
    inv_cash.update({k: v for k, v in invoice_cash_accounts(
        db, [r for r in invs if not r.cash_account_id], direction="debit").items()})
    cash_label = cash_labeler(
        db, treasury_ids={v.treasury_id for v in vouchers},
        account_ids=set(inv_cash.values()) | {v.cash_account_id for v in vouchers})
    cc_ids = {x.cost_center_id for x in [*invs, *vouchers] if x.cost_center_id}
    ccs = dict(db.execute(select(CostCenter.id, CostCenter.name)
                          .where(CostCenter.id.in_(cc_ids))).all()) if cc_ids else {}

    def _iso(t):
        return t.isoformat() if t else None

    rows = []
    for r in invs:
        rows.append({
            "key": f"inv-{r.id}", "kind": "invoice", "id": r.id,
            "date": str(r.invoice_date or r.created_at)[:10],
            "document_number": r.document_number,
            "customer_id": r.customer_id, "customer_name": custs.get(r.customer_id),
            "party_id": r.customer_id, "party_name": custs.get(r.customer_id),
            "rep_id": r.rep_id, "rep_name": users.get(r.rep_id),
            "store": loc_name(r.origin_location_kind, r.origin_location_id),
            "amount": str(r.cash_amount), "family": r.family,
            "source": "app" if r.client_uuid else "system",
            "treasury": cash_label(None, inv_cash.get(r.id)), "payment_method": "cash",
            "statement": r.statement1 or r.notes or f"نقدي مع الفاتورة {r.document_number}",
            "notes": r.notes, "description": None,
            "external_document_number": r.external_document_number, "reference": None,
            "actor_name": users.get(r.actor_user_id), "created_at": _iso(r.created_at),
            "cost_center": ccs.get(r.cost_center_id),
            "invoice_total": str(to_money(Decimal(r.net or 0) + Decimal(r.tax_amount or 0))),
            "credit_amount": str(r.credit_amount),
        })
    for v in vouchers:
        rep = v.rep_user_id or (v.actor_user_id if v.client_uuid else None)
        rows.append({
            "key": f"rcv-{v.id}", "kind": "voucher", "id": v.id,
            "date": str(v.voucher_date)[:10],
            "document_number": v.document_number,
            "customer_id": v.customer_id, "customer_name": custs.get(v.customer_id),
            "party_id": v.customer_id, "party_name": custs.get(v.customer_id),
            "rep_id": rep, "rep_name": users.get(rep),
            "store": store_of_rep(rep),
            "amount": str(v.amount), "family": v.family,
            "on_total": v.family is None,
            "source": "app" if v.client_uuid else "system",
            "treasury": cash_label(v.treasury_id, v.cash_account_id),
            "payment_method": v.payment_method or "cash",
            "statement": v.statement1 or v.description or "تحصيل من عميل",
            "notes": v.description,
            "description": v.description,
            "external_document_number": v.external_document_number, "reference": v.reference,
            "actor_name": users.get(v.actor_user_id), "created_at": _iso(v.created_at),
            "cost_center": ccs.get(v.cost_center_id),
            "invoice_total": None, "credit_amount": None,
        })
    rows.sort(key=lambda x: (x["date"], x["key"]), reverse=True)
    return {"rows": rows, "total_on_invoice": str(total_inv), "total_payments": str(total_v),
            "total": str(total_inv + total_v),
            "count_on_invoice": n_inv, "count_payments": n_v, "count": n_inv + n_v}


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
    statement: str | None = None,
    ids: str | None = None,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
    inv = _sales_list_stmt(
        current, q=q, customer_id=customer_id, date_from=date_from, date_to=date_to,
        payment=payment, rep_id=rep_id, family=family,
        external_document_number=external_document_number, ids=ids, kind="sale",
        statement=statement)
    ret = branch_scope.scope(select(SalesReturn), SalesReturn, current).where(
        SalesReturn.customer_id.isnot(None), SalesReturn.reversed_at.is_(None))
    if (c1 := _statement_like(SalesReturn, statement)) is not None:
        ret = ret.where(c1)
    if rep_id is not None:
        ret = ret.where(SalesReturn.rep_id == rep_id)
    if family:
        ret = ret.where(SalesReturn.family == family)
    if current.rep_id is not None:
        ret = ret.where(SalesReturn.customer_id.in_(
            select(Customer.id).where(Customer.rep_id == current.rep_id)))
    if q:
        ret = ret.where(SalesReturn.document_number.like(f"%{q.strip()}%"))
    if customer_id is not None:
        ret = ret.where(SalesReturn.customer_id == customer_id)
    if date_from is not None:
        ret = ret.where(SalesReturn.created_at >= clock.day_start_utc(date_from))
    if date_to is not None:
        ret = ret.where(SalesReturn.created_at < clock.day_end_utc(date_to))
    if ids:
        ret = ret.where(SalesReturn.id.in_([-1]))

    def totals(stmt, *cols):
        sub = stmt.subquery()
        row = db.execute(select(func.count(), *[func.coalesce(func.sum(sub.c[c]), 0)
                                                for c in cols])
                         .select_from(sub)).one()
        return row

    inv_sub = inv.subquery()
    line_sum = (select(SalesInvoiceLine.invoice_id.label("iid"),
                       func.sum(SalesInvoiceLine.quantity * SalesInvoiceLine.unit_price)
                       .label("before"))
                .where(SalesInvoiceLine.invoice_id.in_(select(inv_sub.c.id)))
                .group_by(SalesInvoiceLine.invoice_id).subquery())
    inv_count, inv_net, inv_credit, inv_cash, inv_before = db.execute(
        select(func.count(),
               func.coalesce(func.sum(inv_sub.c.net), 0),
               func.coalesce(func.sum(inv_sub.c.credit_amount), 0),
               func.coalesce(func.sum(inv_sub.c.cash_amount), 0),
               func.coalesce(func.sum(func.coalesce(line_sum.c.before, inv_sub.c.gross)), 0))
        .select_from(inv_sub.outerjoin(line_sum, line_sum.c.iid == inv_sub.c.id))).one()
    ret_count, ret_net, ret_credit, ret_cash = totals(
        ret, "value", "credit_reduction", "cash_refund")

    bonus_ids = _sales_list_stmt(
        current, q=q, customer_id=customer_id, date_from=date_from, date_to=date_to,
        payment=payment, rep_id=rep_id, family=family,
        external_document_number=external_document_number, ids=ids, kind="bonus",
        statement=statement).with_only_columns(SalesInvoice.id).subquery()
    bonus_count = db.scalar(select(func.count()).select_from(bonus_ids)) or 0
    bonus_gross = db.scalar(
        select(func.coalesce(func.sum(
            SalesInvoiceLine.quantity * SalesInvoiceLine.unit_price
            * (1 - func.coalesce(SalesInvoiceLine.fixed_discount_pct, 0) / 100)), 0))
        .where(SalesInvoiceLine.invoice_id.in_(select(bonus_ids.c.id)))) or 0

    from src.services import financial_reports_service as fin
    outstanding = sum(
        (row.total for row in fin.receivables_aging(
            db, branch_id=branch_scope.visible_branch_id(current))
         if row.total > 0),
        Decimal("0.00"))

    return {
        "sales_count": inv_count, "sales_net": inv_net,
        "sales_gross": to_money(Decimal(str(inv_before))),
        "sales_discount": to_money(Decimal(str(inv_before)) - Decimal(str(inv_net))),
        "sales_cash": to_money(Decimal(str(inv_cash))),
        "sales_credit": to_money(Decimal(str(inv_credit))),
        "returns_count": ret_count, "returns_net": ret_net,
        "returns_cash": to_money(Decimal(str(ret_cash))),
        "returns_credit": to_money(Decimal(str(ret_credit))),
        "net_sales": inv_net - ret_net,
        "credit_outstanding": outstanding,
        "credit_sold": inv_credit - ret_credit,
        "bonus_count": bonus_count,
        "bonus_gross": to_money(Decimal(str(bonus_gross))),
    }


def _standalone_return_out(r: SalesReturn, db: Session | None = None, *,
                           names: tuple[dict[int, str], dict[int, str],
                                        dict[int, str]] | None = None) -> dict:
    invoice_no = None
    if db is not None and r.sales_invoice_id:
        inv = db.get(SalesInvoice, r.sales_invoice_id)
        invoice_no = inv.document_number if inv else None
    cust_names, cust_types, rep_names = names or ({}, {}, {})
    return {
        "customer_name": cust_names.get(r.customer_id),
        "customer_type": cust_types.get(r.customer_id),
        "rep_name": rep_names.get(r.rep_id) if r.rep_id else None,
        "id": r.id, "document_number": r.document_number, "customer_id": r.customer_id,
        "gross": str(r.gross), "combined_pct": str(r.combined_pct), "net": str(r.value),
        "tax_amount": str(r.tax_amount), "cash_refund": str(r.cash_refund),
        "credit_reduction": str(r.credit_reduction), "ledger_entry_id": r.ledger_entry_id,
        "created_at": str(r.created_at) if r.created_at else None,
        "sales_invoice_id": r.sales_invoice_id, "invoice_document_number": invoice_no,
        "return_date": str(r.return_date) if r.return_date else None,
        "rep_id": r.rep_id, "revenue_account_id": r.revenue_account_id,
        "external_document_number": r.external_document_number, "notes": r.notes,
        "statement1": r.statement1, "statement2": r.statement2, "statement3": r.statement3,
        "family": getattr(r, "family", None),
    }


@router.get("/customer-item-history", response_model=dict)
def customer_item_history(
    customer_id: int,
    item_id: int,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> dict:
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
    statement: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    current: CurrentUser = Depends(require_capability(CAP_SALES_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    stmt = branch_scope.scope(select(SalesReturn), SalesReturn, current).where(
        SalesReturn.customer_id.isnot(None), SalesReturn.reversed_at.is_(None))
    if (cond := _statement_like(SalesReturn, statement)) is not None:
        stmt = stmt.where(cond)
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
    stmt = stmt.order_by(*newest_first(SalesReturn, SalesReturn.return_date))
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
    _line_locations_check(db, current, body)
    _reject_non_trader(db, body.customer_id)
    try:
        ret = sales_service.create_standalone_return(
            db, customer_id=body.customer_id, origin_location_kind=body.origin.location_kind,
            origin_location_id=body.origin.location_id,
            variable_discount_pct=body.variable_discount_pct,
            cash_refund=body.cash_refund, credit_reduction=body.credit_reduction,
            cash_account_id=body.cash_account_id,
            lines=[ReturnLine(l.item_id, l.quantity, l.unit_price, l.unit, l.discount_pct,
                              l.warehouse_id, serials=l.serials,
                              fixed_discount_pct=l.fixed_discount_pct,
                              variable_discount_pct=l.variable_discount_pct)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, family=body.family,
            rep_id=body.rep_id, revenue_account_id=body.revenue_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            cost_center_id=body.cost_center_id,
            cost_center_distribution=body.cost_center_distribution,
            statement1=body.statement1, statement2=body.statement2, statement3=body.statement3,
            return_date=body.return_date,
        )
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
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "coupon_invalid", "message": str(exc)}) from exc
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "return_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "no_negative_stock", "message": str(exc)})
    except AccountResolutionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "account_missing", "message": str(exc)})
    db.commit()
    return _standalone_return_out(ret)


@router.put("/returns/{return_id}", response_model=dict)
def update_standalone_return(
    return_id: int,
    body: StandaloneReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    ret = db.get(SalesReturn, return_id)
    if ret is None:
        raise HTTPException(404, {"code": "not_found", "message": "المرتجع غير موجود"})
    if not branch_scope.may_see(current, ret):
        raise HTTPException(404, {"code": "not_found", "message": "المرتجع غير موجود"})
    _rep_scope_check(db, current, body.customer_id, body.origin)
    _line_locations_check(db, current, body)
    _reject_non_trader(db, body.customer_id)
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
            cash_account_id=body.cash_account_id,
            lines=[ReturnLine(l.item_id, l.quantity, l.unit_price, l.unit, l.discount_pct,
                              l.warehouse_id, serials=l.serials,
                              fixed_discount_pct=l.fixed_discount_pct,
                              variable_discount_pct=l.variable_discount_pct)
                   for l in body.lines],
            actor_role=current.role, actor_user_id=current.id, family=body.family,
            rep_id=body.rep_id, revenue_account_id=body.revenue_account_id,
            external_document_number=body.external_document_number, notes=body.notes,
            statement1=body.statement1, statement2=body.statement2,
            statement3=body.statement3, return_date=body.return_date,
            cost_center_id=body.cost_center_id,
            cost_center_distribution=body.cost_center_distribution,
            replace_return_id=return_id,
        )
    except SalesError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "return_invalid", "message": str(exc)})
    except StockError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "no_negative_stock", "message": str(exc)})
    except AccountResolutionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"code": "account_missing", "message": str(exc)})
    db.commit()
    return _standalone_return_out(ret, db)


@router.delete("/returns/{return_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sales_return(
    return_id: int,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    try:
        document_edit_service.delete_sales_return(
            db, return_id=return_id, actor_user_id=current.id)
    except DocumentEditError as exc:
        code = 404 if any(s in str(exc) for s in ("مش موجود", "غير موجود")) else status.HTTP_409_CONFLICT
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
        raise HTTPException(404, {"code": "not_found", "message": "المرتجع غير موجود"})
    out = _standalone_return_out(r)
    out["origin_location_kind"] = r.origin_location_kind.value if r.origin_location_kind else None
    out["origin_location_id"] = r.origin_location_id
    out["lines"] = [
        {
            "item_id": ln.item_id, "quantity": str(ln.quantity),
            "unit_price": str(ln.unit_price) if ln.unit_price is not None else None,
            "discount_pct": str(ln.discount_pct), "unit": ln.unit,
            "fixed_discount_pct": (str(ln.fixed_discount_pct)
                                   if ln.fixed_discount_pct is not None else None),
            "variable_discount_pct": (str(ln.variable_discount_pct)
                                      if ln.variable_discount_pct is not None else None),
            "line_total": str(ln.line_total) if ln.line_total is not None else None,
            "warehouse_id": ln.location_id,
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
        cost_center_id=getattr(inv, "cost_center_id", None),
        cost_center_distribution=analytic_read.distribution_of_entry(
            db, inv.ledger_entry_id),
        customer_id=inv.customer_id,
        gross=inv.gross,
        combined_pct=inv.combined_pct,
        net=inv.net,
        cash_amount=inv.cash_amount,
        credit_amount=inv.credit_amount,
        cash_account_id=inv.cash_account_id,
        ledger_entry_id=inv.ledger_entry_id,
        prior_balance=getattr(inv, "prior_balance", None),
        other_family_balance=getattr(inv, "other_family_balance", None),
        other_family=getattr(inv, "other_family", None),
        customer_name=(db.get(Customer, inv.customer_id).name
                       if inv.customer_id else None),
        rep_id=inv.rep_id,
        rep_name=((db.get(User, inv.rep_id).full_name
                   or db.get(User, inv.rep_id).username) if inv.rep_id else None),
        family=inv.family,
        invoice_date=inv.invoice_date,
        external_document_number=inv.external_document_number,
        notes=inv.notes,
        statement1=inv.statement1,
        statement2=inv.statement2,
        statement3=inv.statement3,
        fixed_discount_pct=inv.fixed_discount_pct,
        variable_discount_pct=inv.variable_discount_pct,
        is_bonus=bool(getattr(inv, "is_bonus", None)),
        bonus_for_invoice_id=getattr(inv, "bonus_for_invoice_id", None),
        bonus_for_number=(db.scalar(select(SalesInvoice.document_number).where(
            SalesInvoice.id == inv.bonus_for_invoice_id))
            if getattr(inv, "bonus_for_invoice_id", None) else None),
        lines=[
            InvoiceLineOut(
                item_id=line.item_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount_pct=line.discount_pct,
                fixed_discount_pct=line.fixed_discount_pct,
                variable_discount_pct=line.variable_discount_pct,
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
    reason: Literal["edit", "delete"]


@router.post("/{sale_id}/returns", response_model=dict, status_code=status.HTTP_201_CREATED)
def return_sale(
    sale_id: int,
    body: ReturnCreate,
    current: CurrentUser = Depends(require_capability(CAP_RETURN_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    inv = db.get(SalesInvoice, sale_id)
    if inv is None or not branch_scope.may_see(current, inv):
        raise HTTPException(404, {"code": "not_found", "message": "الفاتورة غير موجودة"})
    if current.rep_id is not None and not (
            inv.rep_id == current.id or (inv.rep_id is None and inv.actor_user_id == current.id)):
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "هذه ليست فاتورتك — يمكنك الإرجاع على فواتيرك أنت فقط."})
    serials: dict[int, list[str]] = {}
    for l in body.lines:
        if l.serials:
            serials.setdefault(l.item_id, []).extend(l.serials)
    try:
        ret = sales_service.return_sale(
            db, sales_invoice_id=sale_id, lines=[(l.item_id, l.quantity) for l in body.lines],
            actor_user_id=current.id,
            serials=serials,
            expiry_dates={l.item_id: l.expiry_date for l in body.lines if l.expiry_date},
        )
    except (SalesError, StockError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "return_invalid", "message": str(exc)})
    db.commit()
    return {"id": ret.id, "document_number": ret.document_number,
            "cash_refund": str(ret.cash_refund), "credit_reduction": str(ret.credit_reduction),
            "family": getattr(ret, "family", None),
            "ledger_entry_id": ret.ledger_entry_id}
