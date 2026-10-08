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
from src.core.display_name import DisplayName
from src.core.money import FACTOR, MONEY, PCT, QTY
from src.models.stock import LocationKind


class ItemKind(str, enum.Enum):
    raw_material = "raw_material"
    product = "product"


class PriceTier(str, enum.Enum):
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
    name: Mapped[str] = mapped_column(DisplayName(160), nullable=False)
    kind: Mapped[ItemKind] = mapped_column(Enum(ItemKind), nullable=False)
    unit_of_measure: Mapped[str] = mapped_column(String(16), nullable=False)
    purchase_price: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    sale_price: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    piece_name: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pieces_per_unit: Mapped[object | None] = mapped_column(QTY, nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    default_discount_pct: Mapped[object] = mapped_column(
        Numeric(5, 2), default=0, nullable=False
    )
    purchase_discount_pct: Mapped[object | None] = mapped_column(Numeric(5, 2), nullable=True)
    is_serialized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    min_stock: Mapped[object | None] = mapped_column(QTY, nullable=True)
    max_stock: Mapped[object | None] = mapped_column(QTY, nullable=True)
    is_perishable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouse.id"), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class ItemPrice(Base):
    __tablename__ = "item_price"
    __table_args__ = (UniqueConstraint("item_id", "tier", name="uq_item_price_item_tier"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    tier: Mapped[PriceTier] = mapped_column(Enum(PriceTier), nullable=False)
    price: Mapped[object] = mapped_column(MONEY, nullable=False)
    discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    vat_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)


class ItemPriceHistory(Base):
    __tablename__ = "item_price_history"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    field: Mapped[str] = mapped_column(String(32), nullable=False)
    old_value: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    new_value: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )


class ItemUnit(Base):
    __tablename__ = "item_unit"
    __table_args__ = (UniqueConstraint("item_id", "name", name="uq_item_unit_item_name"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(16), nullable=False)
    factor: Mapped[object] = mapped_column(FACTOR, nullable=False)


class SerialStatus(str, enum.Enum):
    in_stock = "in_stock"
    sold = "sold"


class ItemSerial(Base):
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
    sold_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("sales_invoice.id"), nullable=True
    )


class SerialMovementKind(str, enum.Enum):
    received = "received"
    relocated = "relocated"
    sold = "sold"
    returned = "returned"


class ItemSerialMovement(Base):
    __tablename__ = "item_serial_movement"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    serial_id: Mapped[int] = mapped_column(
        ForeignKey("item_serial.id"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    serial: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[SerialMovementKind] = mapped_column(Enum(SerialMovementKind), nullable=False)
    location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    document_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class BatchMovementKind(str, enum.Enum):
    received = "received"
    consumed = "consumed"
    relocated_out = "relocated_out"
    relocated_in = "relocated_in"
    returned = "returned"


class StockBatchMovement(Base):
    __tablename__ = "stock_batch_movement"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    kind: Mapped[BatchMovementKind] = mapped_column(Enum(BatchMovementKind), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    document_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    document_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class StockBatch(Base):
    __tablename__ = "stock_batch"
    __table_args__ = (
        Index("ix_stock_batch_lookup", "item_id", "location_kind", "location_id", "expiry_date"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
