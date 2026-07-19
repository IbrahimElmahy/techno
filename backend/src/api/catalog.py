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
from src.services import barcode_service, serial_service
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
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> list[ItemOut]:
    stmt = select(Item)
    if kind is not None:
        stmt = stmt.where(Item.kind == kind)
    if category is not None:  # (v4) filter by item category
        stmt = stmt.where(Item.category == category)
    return [_out(i) for i in db.scalars(stmt).all()]


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
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
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


@router.patch("/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    body: ItemUpdate,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> ItemOut:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    # Editing reference prices never rewrites prices already snapshotted on posted documents.
    for field in ("code", "name", "purchase_price", "sale_price", "is_serialized", "active",
                  "default_warehouse_id", "category",
                  "default_discount_pct"):
        val = getattr(body, field)
        if val is not None:
            setattr(item, field, val)
    db.flush()
    db.commit()
    return _out(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_item(
    item_id: int,
    _: CurrentUser = Depends(require_capability(CAP_CATALOG_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": "Item not found"})
    item.active = False  # soft-delete: never hard-delete an item referenced by posted documents
    db.flush()
    db.commit()
