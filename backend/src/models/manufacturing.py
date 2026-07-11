"""Manufacturing (T027, extended by 012-manufacturing-bom).

Two layers coexist:
- `ManufacturingOp` (consume/produce) — the original decoupled primitive, kept as a *manual*
  adjustment for anything outside a recipe (FR-013–016). No linkage, no money.
- `ManufacturingOrder` (+ consumptions) — a linked, recipe-driven document: it consumes the
  product's BOM components and produces the product in one reversible transaction, storing the
  derived cost. Stock movements remain quantity-only; the order posts no ledger entry.
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY
from src.models.stock import LocationKind


class ManufactureOpType(str, enum.Enum):
    consume = "consume"
    produce = "produce"


class ManufacturingOp(Base):
    __tablename__ = "manufacturing_op"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    op_type: Mapped[ManufactureOpType] = mapped_column(Enum(ManufactureOpType), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # Nullable so the doc can be inserted before its movement exists (Postgres FK enforcement).
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)
    # Set when this op is itself a reversal of another op (reverse-once at op level).
    reverses_op_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturing_op.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class ManufacturingOrder(Base):
    """A recipe-driven production document: consume BOM components + produce the product.

    Posts one product `production_in` movement and one `consumption_out` movement per component
    (all tagged source_doc_type="manufacturing_order"). Reversible once as a whole via a mirror
    order that swaps every movement's direction. Cost is derived (Σ component qty × raw
    purchase_price) and stored — no ledger entry (Q4 money boundary preserved).
    """

    __tablename__ = "manufacturing_order"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    bom_id: Mapped[int | None] = mapped_column(ForeignKey("bom.id"), nullable=True)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # base units of product produced
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False)   # total_cost / quantity
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # material_cost + resource_cost
    # Cost breakdown (014): materials (Σ component line cost) vs resources (labor/machine/overhead).
    material_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    resource_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    # The product's in-movement id (for reverse). Component out-movements are on the consumption rows.
    # Nullable so the doc can be inserted before its movement exists (Postgres FK enforcement).
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)
    # Set when this order is itself the reversal of another (reverse-once at order level).
    reverses_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturing_order.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    consumptions: Mapped[list[ManufacturingOrderConsumption]] = relationship(
        cascade="all, save-update", back_populates="order"
    )
    resources: Mapped[list[ManufacturingOrderResource]] = relationship(
        cascade="all, save-update", back_populates="order"
    )


class ManufacturingOrderConsumption(Base):
    """One raw-material line consumed by a manufacturing order (snapshot of qty + cost)."""

    __tablename__ = "manufacturing_order_consumption"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_order.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # base units consumed
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # raw purchase_price snapshot
    line_cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # quantity × unit_cost
    # Portion of the consumed quantity that was scrap/waste (014); feeds the wastage report.
    waste_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    # Warehouse the material was actually pulled from (014 routing); mirrors the stock movement.
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    # Nullable so the doc can be inserted before its movement exists (Postgres FK enforcement).
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)

    order: Mapped[ManufacturingOrder] = relationship(back_populates="consumptions")


class ManufacturingOrderResource(Base):
    """A non-material input actually consumed by an order (014): labor/machine/overhead.

    Seeded from the recipe's `BomResource` (scaled to the produced quantity) and editable per order.
    Costed as `quantity × rate`; contributes to `resource_cost` — no stock movement, no ledger entry.
    """

    __tablename__ = "manufacturing_order_resource"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_order.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # ResourceKind value
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    rate: Mapped[object] = mapped_column(MONEY, nullable=False)
    cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # quantity × rate

    order: Mapped[ManufacturingOrder] = relationship(back_populates="resources")
