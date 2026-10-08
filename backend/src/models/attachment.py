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
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(400), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_uuid: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
