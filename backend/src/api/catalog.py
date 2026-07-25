"""Catalog router (T008). FR-001–005. System-generated editable code; kind/price validation."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import (
    CAP_CATALOG_READ,
    CAP_CATALOG_WRITE,
    CAP_PURCHASE_WRITE,
    CAP_STOCK_READ,
)
from src.core.db import get_db
from src.core.money import to_money, to_qty
from src.models.catalog import (
    Item,
    ItemBarcode,
    ItemKind,
    ItemPrice,
    ItemSerial,
    ItemUnit,
    PriceTier,
    SerialStatus,
)
from src.models.stock import LocationKind
from src.services import audit_service, barcode_service, item_profile_service, serial_service
from src.services.barcode_service import BarcodeError, BarcodeInput
from src.services.serial_service import SerialError

router = APIRouter(tags=["catalog"], prefix="/items")
# Barcode lookup lives at /barcodes/{code} (outside the /items prefix).
lookup_router = APIRouter(tags=["catalog"])


class ItemCreate(BaseModel):
    name: str
    kind: ItemKind
    unit_of_measure: str
    purchase_price: Decimal | None = None
    sale_price: Decimal | None = None
    is_serialized: bool = False
    default_warehouse_id: int | None = None
    category: str | None = None
    default_discount_pct: Decimal | None = None


class ItemUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    purchase_price: Decimal | None = None
    sale_price: Decimal | None = None
    is_serialized: bool | None = None
    active: bool | None = None
    default_warehouse_id: int | None = None
    category: str | None = None
    default_discount_pct: Decimal | None = None


class ItemOut(BaseModel):
    id: int
    code: str
    name: str
    kind: ItemKind
    unit_of_measure: str
    purchase_price: Decimal | None
    sale_price: Decimal | None
    is_serialized: bool
    active: bool
    default_warehouse_id: int | None = None
    category: str | None = None
    default_discount_pct: Decimal | None = None
    # Total on-hand across all locations — filled on the list endpoint (one grouped query).
    on_hand: Decimal | None = None


def _out(it: Item) -> ItemOut:
    return ItemOut(
        id=it.id, code=it.code, name=it.name, kind=it.kind,
        unit_of_measure=it.unit_of_measure, purchase_price=it.purchase_price,
        sale_price=it.sale_price, is_serialized=it.is_serialized, active=it.active,
        default_warehouse_id=it.default_warehouse_id, category=it.category,
        default_discount_pct=it.default_discount_pct,
    )


def _next_code(db: Session, kind: ItemKind) -> str:
    prefix = "RM" if kind == ItemKind.raw_material else "PR"
    n = db.scalar(select(func.count()).select_from(Item).where(Item.kind == kind)) or 0
    return f"{prefix}-{n + 1:06d}"


@router.get("", response_model=list[ItemOut])
def list_items(
    kind: ItemKind | None = None,
    category: str | None = None,
    q: str | None = None,
    active: bool | None = None,
    warehouse_id: int | None = None,
    stock_filter: str | None = None,  # all | in_stock | out_of_stock | negative
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> list[ItemOut]:
    """List items with search + filters; each row carries its total on-hand quantity.

    On-hand comes from ONE grouped query over the movements, so filtering by stock costs the
    same as listing.
    """
    stmt = item_profile_service.apply_filters(
        select(Item), q=q, kind=kind.value if kind else None, category=category,
        active=active, warehouse_id=warehouse_id,
    )
    rows = list(db.scalars(stmt).all())
    on_hand = item_profile_service.bulk_on_hand(db, [i.id for i in rows])
    rows = item_profile_service.filter_by_stock(rows, on_hand, stock_filter)
    out = []
    for i in rows:
        o = _out(i)
        o.on_hand = on_hand.get(i.id, Decimal("0.000"))
        out.append(o)
    return out


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    body: ItemCreate,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> ItemOut:
    if body.kind == ItemKind.raw_material and body.sale_price is not None:
        raise HTTPException(422, {"code": "validation", "message": "raw material has no sale price"})
    if body.kind == ItemKind.product and body.purchase_price is not None:
        raise HTTPException(422, {"code": "validation", "message": "product has no purchase price"})
    item = Item(
        code=_next_code(db, body.kind),
        name=body.name,
        kind=body.kind,
        unit_of_measure=body.unit_of_measure,
        purchase_price=body.purchase_price,
        sale_price=body.sale_price,
        is_serialized=body.is_serialized,
        default_warehouse_id=body.default_warehouse_id, category=body.category,
        default_discount_pct=body.default_discount_pct or 0,
    )
    db.add(item)
    db.flush()
    db.commit()
    return _out(item)


class TierPrice(BaseModel):
    tier: PriceTier
    price: Decimal


class ItemPricesOut(BaseModel):
    item_id: int
    base_sale_price: Decimal | None
    tiers: list[TierPrice]


class ItemPricesSet(BaseModel):
    tiers: list[TierPrice]


def _prices_out(db: Session, item: Item) -> ItemPricesOut:
    rows = db.scalars(select(ItemPrice).where(ItemPrice.item_id == item.id)).all()
    return ItemPricesOut(
        item_id=item.id, base_sale_price=item.sale_price,
        tiers=[TierPrice(tier=r.tier, price=r.price) for r in rows],
    )


@router.get("/{item_id}/prices", response_model=ItemPricesOut)
def get_item_prices(
    item_id: int,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> ItemPricesOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    return _prices_out(db, item)


@router.put("/{item_id}/prices", response_model=ItemPricesOut)
def set_item_prices(
    item_id: int,
    body: ItemPricesSet,
    current: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> ItemPricesOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    if item.kind != ItemKind.product:
        raise HTTPException(422, {"code": "validation", "message": "only products have sale prices"})
    for tp in body.tiers:
        if tp.price < 0:
            raise HTTPException(422, {"code": "validation", "message": "price must be ≥ 0"})
    # Upsert each provided tier (omitted tiers are left unchanged).
    for tp in body.tiers:
        row = db.scalar(
            select(ItemPrice).where(ItemPrice.item_id == item.id, ItemPrice.tier == tp.tier)
        )
        # Log the move BEFORE writing it, so the history keeps the previous price (027).
        item_profile_service.record_price_change(
            db, item_id=item.id, field_name=tp.tier.value,
            old_value=row.price if row is not None else None,
            new_value=to_money(tp.price), actor_user_id=current.id)
        if row is None:
            db.add(ItemPrice(item_id=item.id, tier=tp.tier, price=to_money(tp.price)))
        else:
            row.price = to_money(tp.price)
    db.flush()
    db.commit()
    return _prices_out(db, item)


class UnitOut(BaseModel):
    name: str
    factor: Decimal
    is_base: bool


class ItemUnitsOut(BaseModel):
    item_id: int
    base_unit: str
    units: list[UnitOut]


class UnitIn(BaseModel):
    name: str
    factor: Decimal


class ItemUnitsSet(BaseModel):
    units: list[UnitIn]


def _units_out(db: Session, item: Item) -> ItemUnitsOut:
    rows = db.scalars(select(ItemUnit).where(ItemUnit.item_id == item.id)).all()
    units = [UnitOut(name=item.unit_of_measure, factor=Decimal("1.000"), is_base=True)]
    units += [UnitOut(name=r.name, factor=r.factor, is_base=False) for r in rows]
    return ItemUnitsOut(item_id=item.id, base_unit=item.unit_of_measure, units=units)


@router.get("/{item_id}/units", response_model=ItemUnitsOut)
def get_item_units(
    item_id: int,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> ItemUnitsOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    return _units_out(db, item)


@router.put("/{item_id}/units", response_model=ItemUnitsOut)
def set_item_units(
    item_id: int,
    body: ItemUnitsSet,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> ItemUnitsOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    seen = {item.unit_of_measure}
    for u in body.units:
        if u.factor <= 0:
            raise HTTPException(422, {"code": "validation", "message": "factor must be > 0"})
        if u.name in seen:
            raise HTTPException(422, {"code": "validation",
                                      "message": f"duplicate unit name '{u.name}'"})
        seen.add(u.name)
    # Replace the full alternate set.
    db.execute(delete(ItemUnit).where(ItemUnit.item_id == item.id))
    for u in body.units:
        db.add(ItemUnit(item_id=item.id, name=u.name, factor=to_qty(u.factor)))
    db.flush()
    db.commit()
    return _units_out(db, item)


class SerialOut(BaseModel):
    id: int
    item_id: int
    serial: str
    status: str
    location_kind: str | None
    location_id: int | None


class ReceiveSerials(BaseModel):
    location_kind: LocationKind
    location_id: int
    serials: list[str]


def _serial_out(s: ItemSerial) -> SerialOut:
    return SerialOut(
        id=s.id, item_id=s.item_id, serial=s.serial, status=s.status.value,
        location_kind=s.location_kind.value if s.location_kind else None,
        location_id=s.location_id,
    )


@router.get("/{item_id}/serials", response_model=list[SerialOut])
def list_serials(
    item_id: int,
    status_filter: str | None = Query(default=None, alias="status"),
    location_kind: LocationKind | None = None,
    location_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[SerialOut]:
    stmt = select(ItemSerial).where(ItemSerial.item_id == item_id)
    if status_filter is not None:
        stmt = stmt.where(ItemSerial.status == SerialStatus(status_filter))
    if location_kind is not None:
        stmt = stmt.where(ItemSerial.location_kind == location_kind)
    if location_id is not None:
        stmt = stmt.where(ItemSerial.location_id == location_id)
    return [_serial_out(s) for s in db.scalars(stmt.order_by(ItemSerial.serial)).all()]


@router.post("/{item_id}/serials/receive", response_model=list[SerialOut],
             status_code=status.HTTP_201_CREATED)
def receive_serials(
    item_id: int,
    body: ReceiveSerials,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> list[SerialOut]:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    try:
        rows = serial_service.receive(
            db, item=item, location_kind=body.location_kind, location_id=body.location_id,
            serials=body.serials, actor_user_id=current.id,
        )
    except SerialError as exc:
        raise HTTPException(422, {"code": "serial_invalid", "message": str(exc)})
    db.commit()
    return [_serial_out(s) for s in rows]


class BarcodeIn(BaseModel):
    barcode: str
    unit: str | None = None


class BarcodesSet(BaseModel):
    barcodes: list[BarcodeIn]


class BarcodeLookupOut(BaseModel):
    item_id: int
    code: str
    name: str
    unit: str | None
    factor: Decimal
    base_sale_price: Decimal | None


@router.get("/{item_id}/barcodes", response_model=list[BarcodeIn])
def get_item_barcodes(
    item_id: int,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> list[BarcodeIn]:
    rows = db.scalars(select(ItemBarcode).where(ItemBarcode.item_id == item_id)).all()
    return [BarcodeIn(barcode=r.barcode, unit=r.unit) for r in rows]


@router.put("/{item_id}/barcodes", response_model=list[BarcodeIn])
def set_item_barcodes(
    item_id: int,
    body: BarcodesSet,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> list[BarcodeIn]:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    try:
        rows = barcode_service.set_barcodes(
            db, item=item, barcodes=[BarcodeInput(b.barcode, b.unit) for b in body.barcodes]
        )
    except BarcodeError as exc:
        raise HTTPException(422, {"code": "barcode_invalid", "message": str(exc)})
    db.commit()
    return [BarcodeIn(barcode=r.barcode, unit=r.unit) for r in rows]


@lookup_router.get("/barcodes/{code}", response_model=BarcodeLookupOut)
def lookup_barcode(
    code: str,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> BarcodeLookupOut:
    res = barcode_service.lookup(db, code)
    if res is None:
        raise HTTPException(404, {"code": "not_found", "message": "Unknown barcode"})
    return BarcodeLookupOut(
        item_id=res.item_id, code=res.code, name=res.name, unit=res.unit,
        factor=res.factor, base_sale_price=res.base_sale_price,
    )


class ItemProfileOut(BaseModel):
    """ملف الصنف — stock, sales, purchases, movements and price history in one call."""

    item: ItemOut
    on_hand: Decimal
    stock_by_location: list[dict] = []
    sold_quantity: Decimal
    sold_value: Decimal
    purchased_quantity: Decimal
    purchased_value: Decimal
    avg_sale_price: Decimal
    avg_purchase_price: Decimal
    sales: list[dict] = []
    purchases: list[dict] = []
    movements: list[dict] = []
    price_history: list[dict] = []
    tier_prices: list[dict] = []


@router.get("/{item_id}/profile", response_model=ItemProfileOut)
def item_profile(
    item_id: int,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> ItemProfileOut:
    """Everything the system knows about one item — the product file."""
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    try:
        p = item_profile_service.profile(db, item_id)
    except item_profile_service.ItemProfileError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    base = _out(item)
    base.on_hand = p.on_hand
    return ItemProfileOut(
        item=base, on_hand=p.on_hand, stock_by_location=p.stock_by_location,
        sold_quantity=p.sold_quantity, sold_value=p.sold_value,
        purchased_quantity=p.purchased_quantity, purchased_value=p.purchased_value,
        avg_sale_price=p.avg_sale_price, avg_purchase_price=p.avg_purchase_price,
        sales=p.sales, purchases=p.purchases, movements=p.movements,
        price_history=p.price_history, tier_prices=p.tier_prices,
    )


@router.patch("/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    body: ItemUpdate,
    current: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    # Editing reference prices never rewrites prices already snapshotted on posted documents.
    # Price moves are logged (027) so «why did this get cheaper?» has an answer.
    PRICE_FIELDS = {"purchase_price", "sale_price", "default_discount_pct"}
    for field in ("code", "name", "purchase_price", "sale_price", "is_serialized", "active",
                  "default_warehouse_id", "category",
                  "default_discount_pct"):
        val = getattr(body, field)
        if val is None:
            continue
        if field in PRICE_FIELDS:
            item_profile_service.record_price_change(
                db, item_id=item.id, field_name=field, old_value=getattr(item, field),
                new_value=val, actor_user_id=current.id)
        setattr(item, field, val)
    db.flush()
    db.commit()
    return _out(item)


def _delete_item(db: Session, item: Item, actor_user_id: int) -> None:
    """Permanently remove an item that never moved — otherwise refuse.

    Deleting an item that appears on a posted invoice, a stock movement or a recipe would
    orphan those documents, so that case must stay a deactivation.
    """
    from src.models.bom import BomComponent
    from src.models.manufacturing import ManufacturingOrder
    from src.models.purchasing import PurchaseInvoiceLine
    from src.models.sales import SalesInvoiceLine
    from src.models.stock import StockMovement

    blockers: list[str] = []
    checks = [
        ("حركات مخزون", select(func.count()).select_from(StockMovement)
         .where(StockMovement.item_id == item.id)),
        ("سطور فواتير بيع", select(func.count()).select_from(SalesInvoiceLine)
         .where(SalesInvoiceLine.item_id == item.id)),
        ("سطور فواتير شراء", select(func.count()).select_from(PurchaseInvoiceLine)
         .where(PurchaseInvoiceLine.item_id == item.id)),
        ("وصفات تصنيع", select(func.count()).select_from(BomComponent)
         .where(BomComponent.item_id == item.id)),
        ("أوامر تصنيع", select(func.count()).select_from(ManufacturingOrder)
         .where(ManufacturingOrder.product_id == item.id)),
    ]
    for label, stmt in checks:
        if (db.scalar(stmt) or 0) > 0:
            blockers.append(label)

    if blockers:
        raise ValueError(
            "لا يمكن حذف الصنف نهائياً لوجود " + "، ".join(blockers)
            + ". يمكنك إلغاء تفعيله بدلاً من الحذف."
        )

    from src.models.catalog import ItemBarcode, ItemPriceHistory, ItemSerial, ItemUnit
    from src.models.loyalty import ProductPointValue

    audit_service.record(db, action="item.delete", actor_user_id=actor_user_id,
                         entity_type="item", entity_id=item.id,
                         before={"code": item.code, "name": item.name})
    # Owned rows carry no history of their own once the item is gone.
    for model in (ItemPrice, ItemUnit, ItemBarcode, ItemSerial, ItemPriceHistory,
                  ProductPointValue):
        db.execute(delete(model).where(model.item_id == item.id))
    db.delete(item)
    db.flush()


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_item(
    item_id: int,
    hard: bool = False,
    current: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """Deactivate the item; `hard=true` deletes it outright — only if it never moved."""
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    if hard:
        try:
            _delete_item(db, item, current.id)
        except ValueError as exc:
            raise HTTPException(409, {"code": "has_history", "message": str(exc)}) from exc
        db.commit()
        return
    item.active = False  # soft-delete: never hard-delete an item referenced by posted documents
    db.flush()
    db.commit()
