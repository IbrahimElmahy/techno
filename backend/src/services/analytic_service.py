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
    pass


def normalize(shares) -> dict[int, Decimal]:
    if not shares:
        return {}
    items = shares.items() if isinstance(shares, dict) else shares
    out: dict[int, Decimal] = {}
    for cc, pct in items:
        cc = int(cc)
        value = Decimal(str(pct))
        if cc in out:
            raise AnalyticError("المركز مكرر في التوزيع — اجمع نسبته في سطر واحد.")
        out[cc] = value
    return out


def validate(db: Session, shares: dict[int, Decimal]) -> None:
    if not shares:
        return
    for cc, pct in shares.items():
        if pct <= ZERO:
            raise AnalyticError("يجب أن تكون نسبة التوزيع أكبر من صفر.")
        centre = db.get(CostCenter, cc)
        if centre is None:
            raise AnalyticError(f"مركز التكلفة #{cc} غير موجود.")
        if not centre.active:
            raise AnalyticError(f"مركز التكلفة «{centre.name}» مقفل — لا يمكن التوزيع عليه.")
    total = sum(shares.values(), ZERO)
    if total != HUNDRED:
        raise AnalyticError(
            f"مجموع نِسَب التوزيع {total}٪ — يجب أن يساوي ١٠٠٪ تماماً."
        )


def _amounts(amount: Decimal, shares: dict[int, Decimal]) -> list[tuple[int, Decimal, Decimal]]:
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
    line.cost_center_id = None
    for cc, pct, value in _amounts(to_money(line.amount), shares):
        db.add(LedgerLineDistribution(
            line_id=line.id, cost_center_id=cc, percent=pct, amount=value))


def distributions_for(db: Session, line_ids) -> dict[int, list[LedgerLineDistribution]]:
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
    if rows:
        total = to_money(sum((to_money(r.amount) for r in rows), ZERO))
        if total == ZERO:
            return [(r.cost_center_id, ZERO) for r in rows]
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
