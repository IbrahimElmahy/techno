"""Cost Center model (006).

An optional analytical dimension attached to ledger lines — "which activity/project/department" did
money belong to, independently of the account. Hierarchical (parent_id), unbounded depth, like the
chart of accounts but a SEPARATE table: a cost center is not a ledger account and never bears a balance
(Principle VI). Cost-center figures are derived by filtering `ledger_line.cost_center_id`.
"""
from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK


class CostCenter(Base):
    __tablename__ = "cost_center"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    parent: Mapped[CostCenter | None] = relationship(remote_side=[id], backref="children")
