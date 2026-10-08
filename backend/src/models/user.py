from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.models.role import Role


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("role.id"), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    territory_id: Mapped[int | None] = mapped_column(ForeignKey("territory.id"), nullable=True)
    full_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    session_client: Mapped[str | None] = mapped_column(String(16), nullable=True)
    session_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    supervisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    role: Mapped[Role] = relationship()
