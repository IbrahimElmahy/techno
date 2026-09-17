"""قراءة توزيع مستند — من سطور قيده، مش من عمود عليه.

المستند اللي اتكتب بتوزيع محتاج يرجّعه لما يتفتح، وإلا التعديل بيمسحه. والسؤال
«أخزّنه فين» إجابته **مانخزّنوش**: سطور القيد شايلاه أصلاً في
`ledger_line_distribution`، وعمود تاني على المستند معناه نسختين من نفس الحقيقة —
وأول ما حد يعدّل القيد من الأستاذ العام، النسختين بيختلفوا وماحدش عارف مين الصح.

التوزيع بيتقرا من **أول سطر عليه حصص** في قيد المستند: المستند بيوزّع بنفس النِسَب
على سطوره كلها (`post_entry` بيورّثها)، فأي سطر منهم بيقول نفس الحكاية.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.analytic import LedgerLineDistribution
from src.models.ledger import LedgerLine


def distribution_of_entry(db: Session, entry_id: int | None) -> dict[str, Decimal] | None:
    """`{"3": 60, "7": 40}` أو `None` لو المستند مش موزّع."""
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
