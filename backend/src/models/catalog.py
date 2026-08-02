"""Catalog: one shared catalog, two item kinds (T006).

FR-001–005, FR-002a. Raw materials are purchased/consumed (purchase reference price); products are
manufactured/sold (one fixed sale price). Decimal quantities + per-item unit of measure. No quantity
is stored on the item — it lives in stock movements (per item × location).
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, PCT, QTY
from src.models.stock import LocationKind


class ItemKind(str, enum.Enum):
    raw_material = "raw_material"
    product = "product"


class PriceTier(str, enum.Enum):
    """Sale price tiers (007) — تجارى/نصف تجارى/جملة/نصف جملة/مستهلك، plus سعر اللستة.

    `list_price` is the published price the company quotes from, which is not one of the five
    negotiated tiers: it is the number on the printed list, and a salesman needs to see it beside
    whatever tier the customer actually gets so he knows how far he has discounted.
    """

    commercial = "commercial"
    semi_commercial = "semi_commercial"
    wholesale = "wholesale"
    semi_wholesale = "semi_wholesale"
    consumer = "consumer"
    list_price = "list_price"


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
    # Item category (v4) — an admin-configurable lookup value (`item_category`), free text.
    category: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    # التعبئة: one selling unit contains N pieces, and the piece has its own name («قطعة»،
    # «متر»، «شيكارة»). Stored on the item because it describes the goods, not a conversion the
    # user picks per line — the multi-unit table (`item_unit`) is still what a line converts by.
    piece_name: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pieces_per_unit: Mapped[object | None] = mapped_column(QTY, nullable=True)
    # A free note on the item itself, printed nowhere and searched everywhere.
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Default line discount % for this item (v4), e.g. 10.00 = 10%. Used as the suggested discount
    # on invoice lines; the posted document always stores the ACTUAL discount charged.
    default_discount_pct: Mapped[object] = mapped_column(
        Numeric(5, 2), default=0, nullable=False
    )
    # When true, the item is tracked by serial number (009); receive/sale/return require serials.
    is_serialized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # (011) Advisory planning thresholds in BASE units, compared against total on-hand across all
    # locations. Purely advisory: they drive the reorder report, they never block a sale — only
    # No-Negative-Stock does that (Principle XI).
    min_stock: Mapped[object | None] = mapped_column(QTY, nullable=True)
    max_stock: Mapped[object | None] = mapped_column(QTY, nullable=True)
    # (011) When true the item is tracked in expiry batches: received per expiry date, sold FEFO.
    is_perishable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Default warehouse for inventory routing (014): manufacturing pulls this item from / produces
    # it into this warehouse automatically. NULL falls back to the order's chosen location.
    default_warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouse.id"), nullable=True
    )
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
    # Each tier carries its own discount and VAT rate: a wholesaler and a walk-in do not get the
    # same allowance, and putting one rate on the item would force the salesman to re-derive the
    # difference by hand on every line.
    discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    vat_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)


class ItemPriceHistory(Base):
    """Every change to an item's prices, kept forever (027).

    Posted documents already snapshot the price they charged, but nothing recorded *when* a
    price changed or *who* changed it — so "why is this item suddenly cheaper?" was
    unanswerable. Append-only: a correction is another row, never an edit.
    """

    __tablename__ = "item_price_history"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    # Which price moved: 'sale_price', 'purchase_price', 'default_discount_pct', or a tier name.
    field: Mapped[str] = mapped_column(String(32), nullable=False)
    old_value: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    new_value: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )


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
    location_kind: Mapped[LocationKind | None] = mapped_column(
        Enum(LocationKind), nullable=True
    )
    location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Set on sale, cleared on return — scopes which invoice a serial can be returned against.
    sold_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_invoice.id"), nullable=True
    )


class SerialMovementKind(str, enum.Enum):
    received = "received"       # entered stock
    relocated = "relocated"     # moved between locations with a transfer
    sold = "sold"               # left on an invoice
    returned = "returned"       # came back off that invoice


class ItemSerialMovement(Base):
    """Every time a serial changed hands — 031, «حركات سرايل».

    `ItemSerial` holds only where a unit is NOW. That answers «where is serial X?» and cannot answer
    «where has it been, and on which document?» — which is the question asked when a customer
    returns a unit claiming they never bought it, or when one turns up in a store nobody sent it to.
    The four places a serial moves each write a row here, so the trail is a record rather than
    something reconstructed later from stock quantities that do not name the unit.

    The row keeps where the serial ENDED. A sale ends nowhere, so its location is NULL — the unit
    left, and pretending it is still at the origin would put sold units in a store's list.
    """

    __tablename__ = "item_serial_movement"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    serial_id: Mapped[int] = mapped_column(
        ForeignKey("item_serial.id"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    # Copied rather than joined: a serial can be deleted from a mis-keyed receipt, and the trail of
    # what moved must survive the row it described.
    serial: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[SerialMovementKind] = mapped_column(Enum(SerialMovementKind), nullable=False)
    location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Which document did this: «sales_invoice», «transfer», «serial_receive».
    document_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class BatchMovementKind(str, enum.Enum):
    received = "received"             # a lot came into stock
    consumed = "consumed"             # drawn down by a sale, earliest expiry first
    relocated_out = "relocated_out"   # left a location on a transfer
    relocated_in = "relocated_in"     # arrived at one
    returned = "returned"             # came back off an invoice


class StockBatchMovement(Base):
    """Every draw on an expiry lot — 031, «حركات انتهاء الصلاحية».

    `StockBatch` holds what REMAINS of a lot. That answers «how much of the batch expiring in
    March is left» and cannot answer «where did the rest of it go» — the question asked when a lot
    is recalled and every unit of it has to be traced to the invoice that sold it.

    Like the serial trail, it cannot be derived afterwards: a stock movement carries a quantity and
    a date, not which expiry lot the quantity came out of. FEFO makes that choice at the moment of
    sale, and if it is not written down then it is gone.

    A relocation is two rows, out of the source and into the destination. One row with two
    locations would need a reader to know which end it was looking at.
    """

    __tablename__ = "stock_batch_movement"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    # The lot is identified by its expiry date rather than by a row id: lots merge and split as
    # goods move, and the date is what stays true about the goods themselves.
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    kind: Mapped[BatchMovementKind] = mapped_column(Enum(BatchMovementKind), nullable=False)
    # Always positive; `kind` says which way it went.
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    document_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class StockBatch(Base):
    """A lot of a perishable item sharing one expiry date at one location (011).

    Quantity is what REMAINS of the lot, in base units. The rule the whole feature rests on: for a
    perishable item at a location, the sum of its batch quantities always equals its derived
    on-hand there — receive, FEFO sale and return each move both sides together, so the batches can
    never drift away from the stock ledger.
    """

    __tablename__ = "stock_batch"
    __table_args__ = (
        # FEFO reads and the receive/return upsert both look up by this exact tuple.
        Index("ix_stock_batch_lookup", "item_id", "location_kind", "location_id", "expiry_date"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)   # remaining, base units
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
