from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import FACTOR, MONEY, QTY


class ResourceKind(str, enum.Enum):
    labor = "labor"
    machine = "machine"
    overhead = "overhead"
    other = "other"


class Bom(Base):
    __tablename__ = "bom"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    output_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    components: Mapped[list[BomComponent]] = relationship(
        cascade="all, delete-orphan", back_populates="bom", order_by="BomComponent.id"
    )
    resources: Mapped[list[BomResource]] = relationship(
        cascade="all, delete-orphan", back_populates="bom", order_by="BomResource.id"
    )


class BomComponent(Base):
    __tablename__ = "bom_component"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(ForeignKey("bom.id"), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(FACTOR, default=1, nullable=False)
    stage: Mapped[str | None] = mapped_column(String(16), nullable=True)

    bom: Mapped[Bom] = relationship(back_populates="components")


class BomResource(Base):
    __tablename__ = "bom_resource"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(ForeignKey("bom.id"), nullable=False, index=True)
    kind: Mapped[ResourceKind] = mapped_column(Enum(ResourceKind), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    rate: Mapped[object] = mapped_column(MONEY, nullable=False)

    bom: Mapped[Bom] = relationship(back_populates="resources")
