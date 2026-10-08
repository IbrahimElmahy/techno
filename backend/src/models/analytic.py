from __future__ import annotations

from sqlalchemy import ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY

PERCENT = Numeric(9, 4)


class LedgerLineDistribution(Base):
    __tablename__ = "ledger_line_distribution"
    __table_args__ = (
        UniqueConstraint("line_id", "cost_center_id", name="uq_lld_line_center"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    line_id: Mapped[int] = mapped_column(
        ForeignKey("ledger_line.id", ondelete="CASCADE"), nullable=False, index=True
    )
    cost_center_id: Mapped[int] = mapped_column(
        ForeignKey("cost_center.id"), nullable=False, index=True
    )
    percent: Mapped[object] = mapped_column(PERCENT, nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
