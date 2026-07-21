"""Site inspections (معاينات) recorded by field reps — 015-inspections-mobile.

The mobile app records inspections offline (technician visits + regular visits) and syncs them in
batches. `client_uuid` is generated on the device and unique — re-syncing the same record is a
no-op, which makes the sync endpoint idempotent. Informational documents only: no stock movements
and no ledger entries are posted.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import QTY
from src.models.loyalty import POINTS


class VisitKind(str, enum.Enum):
    technician = "technician"  # زيارات الفنيين (معاينات)
    regular = "regular"        # الزيارات العادية


class InspectionStatus(str, enum.Enum):
    accepted = "accepted"  # مقبولة (الافتراضي — زي النظام القديم)
    rejected = "rejected"  # مرفوضة — بديل الحذف؛ ترجّع البضاعة لعهدة المندوب


class Inspection(Base):
    __tablename__ = "inspection"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    # Device-generated UUID → idempotent offline sync (NULL for rows created on the web).
    client_uuid: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    visit_kind: Mapped[VisitKind] = mapped_column(
        Enum(VisitKind, native_enum=False, length=16), nullable=False,
        default=VisitKind.technician,
    )
    inspection_date: Mapped[date] = mapped_column(Date, nullable=False)

    # الزيارة العادية مرتبطة بعميل مختار من النظام؛ معاينة الفنيين تكتب اسم المالك يدويًا.
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customer.id"), nullable=True,
                                                    index=True)

    # صاحب الشقة / المالك (أو اسم العميل في الزيارة العادية)
    owner_name: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    national_id: Mapped[str | None] = mapped_column(String(20), nullable=True)   # رقم البطاقة
    owner_address: Mapped[str | None] = mapped_column(String(240), nullable=True)
    floor_number: Mapped[str | None] = mapped_column(String(16), nullable=True)  # رقم الدور

    # Configurable lookups (013): inspection_description / inspection_type categories.
    description: Mapped[str | None] = mapped_column(String(80), nullable=True)      # توصيف المعاينة
    inspection_type: Mapped[str | None] = mapped_column(String(80), nullable=True)  # نوع المعاينة

    # الفني
    technician_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    technician_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    purchase_shop: Mapped[str | None] = mapped_column(String(160), nullable=True)  # محل الشراء
    visit_details: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    total_points: Mapped[object] = mapped_column(POINTS, nullable=False, default=0)
    rep_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)

    # --- Review-screen parity with the legacy «مراجعة زيارات المناديب» (015 follow-up) ---
    # Sequential warranty-certificate number, continuing the legacy paper sequence (156204…).
    certificate_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    # معاينة / مرمة — configurable lookup (visit_type); set by the reviewer, defaults to معاينة.
    visit_type: Mapped[str] = mapped_column(String(40), nullable=False, default="معاينة")
    status: Mapped[InspectionStatus] = mapped_column(
        Enum(InspectionStatus, native_enum=False, length=12), nullable=False,
        default=InspectionStatus.accepted,
    )
    printed: Mapped[bool] = mapped_column(default=False, nullable=False)  # حالة الطباعة
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
    # Nullable + a name snapshot: the device may hold an item that was renamed/removed since its
    # last catalog pull — the inspection must still sync exactly as recorded.
    item_id: Mapped[int | None] = mapped_column(ForeignKey("item.id"), nullable=True)
    item_name: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    points: Mapped[object] = mapped_column(POINTS, nullable=False, default=0)  # نقاط الوحدة
    total: Mapped[object] = mapped_column(POINTS, nullable=False, default=0)   # points × quantity
    # Set when the recording rep holds a custody: the line's `inspection_out` movement that
    # deducted this quantity from it (reversed if an admin deletes the inspection).
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True
    )

    inspection: Mapped[Inspection] = relationship(back_populates="items")
