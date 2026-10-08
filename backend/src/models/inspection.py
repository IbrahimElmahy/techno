from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.display_name import DisplayName
from src.core.money import QTY
from src.models.loyalty import POINTS


class VisitKind(str, enum.Enum):
    technician = "technician"
    regular = "regular"


class InspectionStatus(str, enum.Enum):
    accepted = "accepted"
    rejected = "rejected"


class Inspection(Base):
    __tablename__ = "inspection"

    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    client_uuid: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    visit_kind: Mapped[VisitKind] = mapped_column(
        Enum(VisitKind, native_enum=False, length=16), nullable=False,
        default=VisitKind.technician,
    )
    inspection_date: Mapped[date] = mapped_column(Date, nullable=False)

    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("owner.id"), nullable=True, index=True)

    owner_name: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    national_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    owner_address: Mapped[str | None] = mapped_column(String(240), nullable=True)
    floor_number: Mapped[str | None] = mapped_column(String(16), nullable=True)

    description: Mapped[str | None] = mapped_column(String(80), nullable=True)
    inspection_type: Mapped[str | None] = mapped_column(String(80), nullable=True)

    technician_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    technician_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    merchant_customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("customer.id"), nullable=True, index=True)

    purchase_shop: Mapped[str | None] = mapped_column(String(160), nullable=True)
    purchase_shop_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    visit_details: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    total_points: Mapped[object] = mapped_column(POINTS, nullable=False, default=0)
    rep_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)

    certificate_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    visit_type: Mapped[str] = mapped_column(String(40), nullable=False, default="معاينة")
    status: Mapped[InspectionStatus] = mapped_column(
        Enum(InspectionStatus, native_enum=False, length=12), nullable=False,
        default=InspectionStatus.accepted,
    )
    printed: Mapped[bool] = mapped_column(default=False, nullable=False)
    printed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    items: Mapped[list["InspectionItem"]] = relationship(
        back_populates="inspection", cascade="all, delete-orphan", order_by="InspectionItem.id"
    )


class InspectionItem(Base):
    __tablename__ = "inspection_item"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(
        ForeignKey("inspection.id"), nullable=False, index=True
    )
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"), nullable=True)
    item_name: Mapped[str] = mapped_column(DisplayName(160), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    points: Mapped[object] = mapped_column(POINTS, nullable=False, default=0)
    total: Mapped[object] = mapped_column(POINTS, nullable=False, default=0)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )

    inspection: Mapped[Inspection] = relationship(back_populates="items")
