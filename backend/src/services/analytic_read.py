from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.analytic import LedgerLineDistribution
from src.models.ledger import LedgerLine


def distribution_of_entry(db: Session, entry_id: int | None) -> dict[str, Decimal] | None:
    if entry_id is None:
        return None
    line_id = db.scalar(
        select(LedgerLineDistribution.line_id)
        .join(LedgerLine, LedgerLine.id == LedgerLineDistribution.line_id)
        .where(LedgerLine.entry_id == entry_id)
        .order_by(LedgerLineDistribution.line_id)
        .limit(1)
    )
    if line_id is None:
        return None
    rows = db.scalars(
        select(LedgerLineDistribution)
        .where(LedgerLineDistribution.line_id == line_id)
        .order_by(LedgerLineDistribution.id)
    ).all()
    return {str(r.cost_center_id): Decimal(str(r.percent)) for r in rows} or None
