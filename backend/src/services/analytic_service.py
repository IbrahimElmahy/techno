"""التوزيع التحليلي — كتابة الحصص وقراءتها.

كل اللي بيقرا مركز تكلفة بيعدّي من `shares_of` هنا، عشان «السطر على مركز واحد»
و«السطر متقسّم» يبقوا حالة واحدة عند اللي بيجمّع. من غير كده كل تقرير كان هيعيد
كتابة نفس الشرط، وأول واحد ينساه بيدّي رقم أقل من الحقيقة من غير ما حد ياخد باله.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.analytic import LedgerLineDistribution
from src.models.cost_center import CostCenter
from src.models.ledger import LedgerLine

HUNDRED = Decimal("100")


class AnalyticError(Exception):
    """توزيع مالوش معنى — نِسَب مش بتجمّع مية، أو مركز مقفول."""


def normalize(shares) -> dict[int, Decimal]:
    """`{cost_center_id: percent}` من دكشنري أو قايمة أزواج، بنِسَب `Decimal`."""
    if not shares:
        return {}
    items = shares.items() if isinstance(shares, dict) else shares
    out: dict[int, Decimal] = {}
    for cc, pct in items:
        cc = int(cc)
        value = Decimal(str(pct))
        if cc in out:
            raise AnalyticError("المركز اتكرر في التوزيع — اجمع نسبته في سطر واحد.")
        out[cc] = value
    return out


def validate(db: Session, shares: dict[int, Decimal]) -> None:
    """النِسَب موجبة ومجموعها مية، والمراكز موجودة وشغّالة."""
    if not shares:
        return
    for cc, pct in shares.items():
        if pct <= ZERO:
            raise AnalyticError("نسبة التوزيع لازم تكون أكبر من صفر.")
        centre = db.get(CostCenter, cc)
        if centre is None:
            raise AnalyticError(f"مركز التكلفة #{cc} مش موجود.")
        if not centre.active:
            raise AnalyticError(f"مركز التكلفة «{centre.name}» مقفول — مايتوزّعش عليه.")
    total = sum(shares.values(), ZERO)
    if total != HUNDRED:
        raise AnalyticError(
            f"مجموع نِسَب التوزيع {total}٪ — لازم يساوي ١٠٠٪ بالظبط."
        )


def _amounts(amount: Decimal, shares: dict[int, Decimal]) -> list[tuple[int, Decimal, Decimal]]:
    """يحوّل النِسَب لمبالغ، وآخر حصة بتبلع فرق التقريب.

    تلات مراكز بـ٣٣٫٣٣٪ على ١٠٠ جنيه بيدّوا ٣٣٫٣٣ و٣٣٫٣٣ و٣٣٫٣٣ = ٩٩٫٩٩. القرش
    الناقص بيروح لآخر واحد، فمجموع الحصص بيساوي السطر بالظبط — وتقرير المراكز
    بيجمع لنفس رقم قائمة الدخل من غير «فرق تقريب» لازم حد يشرحه.
    """
    rows: list[tuple[int, Decimal, Decimal]] = []
    running = ZERO
    items = list(shares.items())
    for index, (cc, pct) in enumerate(items):
        if index == len(items) - 1:
            value = to_money(amount - running)
        else:
            value = to_money(amount * pct / HUNDRED)
            running = to_money(running + value)
        rows.append((cc, pct, value))
    return rows


def set_distribution(db: Session, *, line: LedgerLine, shares) -> None:
    """يكتب توزيع سطر. توزيع فاضي = امسح الحصص وسيب السطر على `cost_center_id` بتاعه.

    المركز الواحد مابيتخزّنش هنا: بيتكتب على `ledger_line.cost_center_id` زي ما هو،
    فالحالة الشايعة بتفضل عمود واحد من غير صفوف ولا `JOIN`.
    """
    shares = normalize(shares)
    db.execute(
        delete(LedgerLineDistribution).where(LedgerLineDistribution.line_id == line.id)
    )
    if not shares:
        return
    validate(db, shares)
    if len(shares) == 1:
        (only,) = shares
        line.cost_center_id = only
        return
    line.cost_center_id = None  # الحصص هي الحقيقة، والعمود بيفضل فاضي عن قصد
    for cc, pct, value in _amounts(to_money(line.amount), shares):
        db.add(LedgerLineDistribution(
            line_id=line.id, cost_center_id=cc, percent=pct, amount=value))


def distributions_for(db: Session, line_ids) -> dict[int, list[LedgerLineDistribution]]:
    """حصص مجموعة سطور في استعلام واحد — التقارير بتقرا آلاف السطور مرة واحدة."""
    ids = [int(i) for i in line_ids]
    if not ids:
        return {}
    out: dict[int, list[LedgerLineDistribution]] = {}
    for row in db.scalars(
        select(LedgerLineDistribution).where(LedgerLineDistribution.line_id.in_(ids))
    ).all():
        out.setdefault(row.line_id, []).append(row)
    return out


def shares_of(
    line: LedgerLine,
    signed: Decimal,
    rows: list[LedgerLineDistribution] | None = None,
) -> list[tuple[int | None, Decimal]]:
    """`(مركز, نصيبه من المبلغ)` — الحالتين بشكل واحد.

    `signed` هو مبلغ السطر بالإشارة اللي التقرير شغّال بيها، فالتقسيم بيمشي عليها
    زي ما هي. السطر اللي مالوش مركز ولا حصص بيرجع بمفتاح `None` — «غير موزّع» دلو
    حقيقي لازم يبان، مش فرق بين مجاميع.
    """
    if rows:
        total = to_money(sum((to_money(r.amount) for r in rows), ZERO))
        if total == ZERO:
            return [(r.cost_center_id, ZERO) for r in rows]
        # النسبة من المبلغ المخزّن مش من النسبة المكتوبة: التقرير ممكن يشتغل على
        # مبلغ بإشارة مقلوبة، والقسمة على المجموع بتحافظ على المجموع مهما كانت.
        out: list[tuple[int | None, Decimal]] = []
        running = ZERO
        for index, row in enumerate(rows):
            if index == len(rows) - 1:
                part = to_money(signed - running)
            else:
                part = to_money(signed * to_money(row.amount) / total)
                running = to_money(running + part)
            out.append((row.cost_center_id, part))
        return out
    return [(line.cost_center_id, signed)]
