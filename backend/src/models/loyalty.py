from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY
from src.models.stock import LocationKind

POINTS = Numeric(18, 3)


class ProductPointValue(Base):
    __tablename__ = "product_point_value"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), unique=True, nullable=False)
    point_value: Mapped[object] = mapped_column(POINTS, default=0, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PointKind(str, enum.Enum):
    earn = "earn"
    reverse = "reverse"
    converted = "converted"
    void_reclaim = "void_reclaim"
    adjustment = "adjustment"
    inspection = "inspection"
    inspection_reverse = "inspection_reverse"


class PointPurse(str, enum.Enum):
    both = "both"
    inspection = "inspection"
    coupon = "coupon"


PURSE_BY_KIND: dict[str, PointPurse] = {
    "earn": PointPurse.both,
    "reverse": PointPurse.both,
    "adjustment": PointPurse.both,
    "inspection": PointPurse.inspection,
    "inspection_reverse": PointPurse.inspection,
    "converted": PointPurse.coupon,
    "void_reclaim": PointPurse.coupon,
}


class PointRecord(Base):
    __tablename__ = "point_record"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False, index=True)
    kind: Mapped[PointKind] = mapped_column(Enum(PointKind), nullable=False)
    purse: Mapped[PointPurse | None] = mapped_column(
        Enum(PointPurse, native_enum=False, length=16), nullable=True, index=True)
    delta: Mapped[object] = mapped_column(POINTS, nullable=False)
    sales_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("sales_invoice.id"), nullable=True)
    sales_return_id: Mapped[int | None] = mapped_column(ForeignKey("sales_return.id"), nullable=True)
    origin_earn_id: Mapped[int | None] = mapped_column(ForeignKey("point_record.id"), nullable=True)
    conversion_id: Mapped[int | None] = mapped_column(ForeignKey("point_conversion.id"), nullable=True)
    coupon_id: Mapped[int | None] = mapped_column(ForeignKey("coupon.id"), nullable=True)
    inspection_id: Mapped[int | None] = mapped_column(
        ForeignKey("inspection.id"), nullable=True, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class CouponKind(str, enum.Enum):
    money = "money"
    gift = "gift"


class CouponType(Base):
    __tablename__ = "coupon_type"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    kind: Mapped[CouponKind] = mapped_column(Enum(CouponKind), nullable=False)
    point_cost: Mapped[int] = mapped_column(BigInteger, nullable=False)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class PointConversion(Base):
    __tablename__ = "point_conversion"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class CouponStatus(str, enum.Enum):
    issued = "issued"
    redeemed = "redeemed"
    voided = "voided"


class Coupon(Base):
    __tablename__ = "coupon"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    serial: Mapped[str] = mapped_column(String(24), unique=True, nullable=False, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False, index=True)
    coupon_type_id: Mapped[int] = mapped_column(ForeignKey("coupon_type.id"), nullable=False)
    kind: Mapped[CouponKind] = mapped_column(Enum(CouponKind), nullable=False)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    points_consumed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[CouponStatus] = mapped_column(
        Enum(CouponStatus), default=CouponStatus.issued, nullable=False
    )
    conversion_id: Mapped[int] = mapped_column(ForeignKey("point_conversion.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class RedemptionMode(str, enum.Enum):
    money = "money"
    gift_product = "gift_product"
    gift_money_off = "gift_money_off"


class CouponRedemption(Base):
    __tablename__ = "coupon_redemption"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    coupon_id: Mapped[int] = mapped_column(ForeignKey("coupon.id"), nullable=False)
    mode: Mapped[RedemptionMode] = mapped_column(Enum(RedemptionMode), nullable=False)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customer.id"), nullable=False)
    sales_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("sales_invoice.id"), nullable=True)
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"), nullable=True)
    location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    quantity: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)
    reverses_redemption_id: Mapped[int | None] = mapped_column(
        ForeignKey("coupon_redemption.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PointRecordImmutableError(Exception):
    pass


def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise PointRecordImmutableError(
        "point_record is immutable; post a new linked record instead (FR-005/IV)."
    )


_ = _block_mutation
