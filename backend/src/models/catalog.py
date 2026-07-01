"""Catalog: one shared catalog, two item kinds (T006).

FR-001–005, FR-002a. Raw materials are purchased/consumed (purchase reference price); products are
manufactured/sold (one fixed sale price). Decimal quantities + per-item unit of measure. No quantity
is stored on the item — it lives in stock movements (per item × location).
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY
from src.models.stock import LocationKind


class ItemKind(str, enum.Enum):
    raw_material = "raw_material"
    product = "product"


class PriceTier(str, enum.Enum):
    """Five sale price tiers (007) — A5Group's تجارى/نصف تجارى/جملة/نصف جملة/مستهلك."""

    commercial = "commercial"
    semi_commercial = "semi_commercial"
    wholesale = "wholesale"
    semi_wholesale = "semi_wholesale"
    consumer = "consumer"


class Item(Base):
    __tablename__ = "item"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[ItemKind] = mapped_column(Enum(ItemKind), nullable=False)
    unit_of_measure: Mapped[str] = mapped_column(String(16), nullable=False)
    # Kind-specific reference prices (editable; never rewrite posted-document prices).
    purchase_price: Mapped[object | None] = mapped_column(MONEY, nullable=True)  # raw materials
    sale_price: Mapped[object | None] = mapped_column(MONEY, nullable=True)      # products
    # When true, the item is tracked by serial number (009); receive/sale/return require serials.
    is_serialized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Advisory reorder thresholds (011, base units); drive the reorder report, never block a sale.
    min_stock: Mapped[object | None] = mapped_column(QTY, nullable=True)
    max_stock: Mapped[object | None] = mapped_column(QTY, nullable=True)
    # When true, the item is batch-tracked by expiry (011); sold FEFO in the base unit.
    is_perishable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class ItemPrice(Base):
    """A per-item, per-tier sale price (007). A missing (item, tier) falls back to item.sale_price."""

    __tablename__ = "item_price"
    __table_args__ = (UniqueConstraint("item_id", "tier", name="uq_item_price_item_tier"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    tier: Mapped[PriceTier] = mapped_column(Enum(PriceTier), nullable=False)
    price: Mapped[object] = mapped_column(MONEY, nullable=False)


class ItemUnit(Base):
    """An alternate unit of measure for an item (008). Base unit = item.unit_of_measure (factor 1).

    factor = how many BASE units one of this unit equals (e.g. carton → 12). Stock is always tracked
    in the base unit; documents convert (entered qty × factor) at the boundary.
    """

    __tablename__ = "item_unit"
    __table_args__ = (UniqueConstraint("item_id", "name", name="uq_item_unit_item_name"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(16), nullable=False)
    factor: Mapped[object] = mapped_column(QTY, nullable=False)  # base units per one of this unit


class SerialStatus(str, enum.Enum):
    in_stock = "in_stock"
    sold = "sold"


class ItemSerial(Base):
    """A serial-numbered physical unit of a serialized item (009). Unique per item.

    Lifecycle: in_stock@location ↔ sold. Every status change is paired with a 002 quantity movement so
    the in-stock serial count at a location equals the item's derived on-hand there.
    """

    __tablename__ = "item_serial"
    __table_args__ = (UniqueConstraint("item_id", "serial", name="uq_item_serial_item_serial"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    serial: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[SerialStatus] = mapped_column(
        Enum(SerialStatus), default=SerialStatus.in_stock, nullable=False
    )
    location_kind: Mapped["LocationKind | None"] = mapped_column(
        Enum(LocationKind), nullable=True
    )
    location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Set on sale, cleared on return — scopes which invoice a serial can be returned against.
    sold_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_invoice.id"), nullable=True
    )


class ItemBarcode(Base):
    """A scan-target barcode for an item (010). Globally unique; optionally tied to a unit (008)."""

    __tablename__ = "item_barcode"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    barcode: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)  # None = base unit
