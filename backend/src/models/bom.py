"""Bill of materials (BOM / recipe) — 012-manufacturing-bom.

A recipe binds a product to the raw materials it consumes. A manufacturing order (see
`manufacturing.ManufacturingOrder`) loads the product's active recipe, consumes the components
(scaled to the produced quantity) and produces the product — one linked, reversible document.

Money boundary is preserved: recipes carry quantities only. Cost is derived at order time from each
raw material's `item.purchase_price` and stored on the order (never posted to the ledger).
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class ResourceKind(str, enum.Enum):
    """A non-material production input (014). Costed as quantity × rate; no stock effect."""

    labor = "labor"        # عمالة (hours)
    machine = "machine"    # تشغيل ماكينة (hours)
    overhead = "overhead"  # أعباء غير مباشرة
    other = "other"


class Bom(Base):
    """A recipe for one product. At most one active recipe per product (enforced in the service)."""

    __tablename__ = "bom"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    # How many base units of the product one batch of this recipe yields (components are per batch).
    output_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    components: Mapped[list[BomComponent]] = relationship(
        cascade="all, delete-orphan", back_populates="bom"
    )
    resources: Mapped[list[BomResource]] = relationship(
        cascade="all, delete-orphan", back_populates="bom"
    )


class BomComponent(Base):
    """One raw-material input of a recipe. `quantity` is base units consumed per recipe batch."""

    __tablename__ = "bom_component"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(ForeignKey("bom.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)

    bom: Mapped[Bom] = relationship(back_populates="components")


class BomResource(Base):
    """A standard non-material input of a recipe (014): labor/machine/overhead per recipe batch.

    Costed at order time as `quantity × rate` (scaled by the produced quantity). No stock effect.
    """

    __tablename__ = "bom_resource"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(ForeignKey("bom.id"), nullable=False, index=True)
    kind: Mapped[ResourceKind] = mapped_column(Enum(ResourceKind), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # hours/units per recipe batch
    rate: Mapped[object] = mapped_column(MONEY, nullable=False)    # cost per hour/unit

    bom: Mapped[Bom] = relationship(back_populates="resources")
