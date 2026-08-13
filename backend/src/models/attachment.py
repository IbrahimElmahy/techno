"""مرفقات الزيارات — الصور اللي المندوب بيرفعها مع المعاينة.

A rep photographs the meter, the fitting, the damage. Those pictures used to live on his phone and
nowhere else: the visit synced, the evidence did not, and the office had a line of text where the
argument with the customer needed a picture.

**The file is stored on disk, not in the database.** A row per attachment carries where it lives and
what it is; the bytes sit under the uploads directory. Photographs are large and are read whole or
not at all — putting them in table rows makes every backup and every query drag them along.

Keyed to the inspection by its own id, but ALSO carrying the phone's `client_uuid`: the picture is
uploaded in a second request after the visit itself syncs, and the phone knows the visit by the uuid
it minted offline long before the server gave it a number.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class InspectionAttachment(Base):
    __tablename__ = "inspection_attachment"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    inspection_id: Mapped[int] = mapped_column(
        ForeignKey("inspection.id"), nullable=False, index=True
    )
    # اسم الملف زي ما المستخدم شايفه.
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # المسار النسبي جوّه مجلد الرفع — نسبي عشان نقل المجلد مايكسرش الصفوف.
    stored_path: Mapped[str] = mapped_column(String(400), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # `client_uuid` الخاص بالمرفق نفسه: نفس الصورة اتبعتت مرتين بعد اتصال قطع تتسجّل مرة.
    client_uuid: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
