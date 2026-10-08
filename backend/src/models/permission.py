from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.models.role import RoleName


class RoleCapability(Base):
    __tablename__ = "role_capability"
    __table_args__ = (
        UniqueConstraint("role", "capability", name="uq_role_capability"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    role: Mapped[RoleName] = mapped_column(Enum(RoleName), nullable=False, index=True)
    capability: Mapped[str] = mapped_column(String(60), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)


class UserCapability(Base):
    __tablename__ = "user_capability"
    __table_args__ = (
        UniqueConstraint("user_id", "capability", name="uq_user_capability"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)
    capability: Mapped[str] = mapped_column(String(120), nullable=False)
    granted: Mapped[bool] = mapped_column(nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)
