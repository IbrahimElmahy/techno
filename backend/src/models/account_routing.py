from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class AccountRouting(Base):
    __tablename__ = "account_routing"
    __table_args__ = (
        UniqueConstraint("role", "branch_id", name="uq_account_routing_role_branch"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    role: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
