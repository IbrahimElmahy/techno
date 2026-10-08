from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from src.core.db import Base, BigIntPK


class IncomeStatementSetting(Base):
    __tablename__ = "income_statement_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  unique=True, index=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
