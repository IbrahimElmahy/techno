from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import FACTOR, MONEY, QTY
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
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)
    reverses_op_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturing_op.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class ManufacturingOrder(Base):
    __tablename__ = "manufacturing_order"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    bom_id: Mapped[int | None] = mapped_column(ForeignKey("bom.id"), nullable=True)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False)
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False)
    material_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    resource_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)
    reverses_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturing_order.id"), unique=True, nullable=True
    )
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True, index=True)
    work_order_ref: Mapped[str | None] = mapped_column(String(60), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    consumptions: Mapped[list[ManufacturingOrderConsumption]] = relationship(
        cascade="all, save-update", back_populates="order",
        order_by="ManufacturingOrderConsumption.id"
    )
    resources: Mapped[list[ManufacturingOrderResource]] = relationship(
        cascade="all, save-update", back_populates="order",
        order_by="ManufacturingOrderResource.id"
    )


class ManufacturingOrderConsumption(Base):
    __tablename__ = "manufacturing_order_consumption"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_order.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False)
    line_cost: Mapped[object] = mapped_column(MONEY, nullable=False)
    waste_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)

    order: Mapped[ManufacturingOrder] = relationship(back_populates="consumptions")


class ManufacturingOrderResource(Base):
    __tablename__ = "manufacturing_order_resource"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_order.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    rate: Mapped[object] = mapped_column(MONEY, nullable=False)
    cost: Mapped[object] = mapped_column(MONEY, nullable=False)

    order: Mapped[ManufacturingOrder] = relationship(back_populates="resources")


class ProductionState(str, enum.Enum):
    draft = "draft"
    confirmed = "confirmed"
    in_progress = "in_progress"
    done = "done"
    reversed = "reversed"


class ProductionOrder(Base):
    __tablename__ = "production_order"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True, index=True)
    external_document_number: Mapped[str | None] = mapped_column(
        String(40), nullable=True, index=True)
    paper_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    state: Mapped[ProductionState] = mapped_column(
        Enum(ProductionState), nullable=False, default=ProductionState.draft, index=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    material_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    expense_amount: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    planned_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    product_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    material_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    imported_from: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("production_order.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    products: Mapped[list[ProductionOrderProduct]] = relationship(
        cascade="all, delete-orphan", back_populates="order",
        order_by="ProductionOrderProduct.id")
    materials: Mapped[list[ProductionOrderMaterial]] = relationship(
        cascade="all, delete-orphan", back_populates="order",
        order_by="ProductionOrderMaterial.id")
    receipts: Mapped[list[ProductionOrderReceipt]] = relationship(
        cascade="all, delete-orphan", back_populates="order",
        order_by="ProductionOrderReceipt.id")


class ProductionOrderProduct(Base):
    __tablename__ = "production_order_product"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("production_order.id"), nullable=False,
                                          index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    planned_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(FACTOR, nullable=False, default=1)
    bom_id: Mapped[int | None] = mapped_column(ForeignKey("bom.id"), nullable=True)
    material_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    expense_amount: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    received_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True)

    order: Mapped[ProductionOrder] = relationship(back_populates="products")
    receipts: Mapped[list[ProductionOrderReceipt]] = relationship(
        cascade="all, delete-orphan", back_populates="product_line")


class ProductionOrderReceipt(Base):
    __tablename__ = "production_order_receipt"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("production_order.id"),
                                          nullable=False, index=True)
    product_line_id: Mapped[int] = mapped_column(
        ForeignKey("production_order_product.id"), nullable=False, index=True)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    receipt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(200), nullable=True)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 nullable=False)

    order: Mapped[ProductionOrder] = relationship(back_populates="receipts")
    product_line: Mapped[ProductionOrderProduct] = relationship(
        back_populates="receipts")


class ProductionOrderMaterial(Base):
    __tablename__ = "production_order_material"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("production_order.id"), nullable=False,
                                          index=True)
    product_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("production_order_product.id"), nullable=True, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    planned_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(FACTOR, nullable=False, default=1)
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    line_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    waste_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True)

    order: Mapped[ProductionOrder] = relationship(back_populates="materials")
