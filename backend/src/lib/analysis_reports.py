from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.cost_center import CostCenter
from src.models.ledger import AccountNature, LedgerEntry, LedgerLine
from src.services import analytic_service, ledger_service
from src.models.org import Branch
from src.services.financial_reports_service import _effective_date, effective_nature

DIMENSIONS = ("cost_center", "branch")

UNASSIGNED = "— غير موزّع —"


class AnalysisReportError(ValueError):
    pass


def _pnl_lines(db: Session, *, date_from: date | None, date_to: date | None,
               branch_id: int | None = None):
    stmt = (
        select(LedgerLine).options(
            selectinload(LedgerLine.entry), selectinload(LedgerLine.account))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(ledger_service.is_posted_sql())
    )
    if branch_id is not None:
        stmt = stmt.where(
            (LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    rows = db.scalars(stmt).all()
    for line in rows:
        nature = effective_nature(line.account)
        if nature not in (AccountNature.income, AccountNature.expense):
            continue
        when = _effective_date(line.entry)
        if date_from is not None and when < date_from:
            continue
        if date_to is not None and when > date_to:
            continue
        amount = to_money(line.amount)
        signed = amount if line.direction == line.account.normal_side else -amount
        yield line, nature, signed


def profitability(
    db: Session,
    *,
    dimension: str = "cost_center",
    date_from=None,
    date_to=None,
    include_unassigned: bool = True,
    branch_id: int | None = None,
) -> dict:
    if dimension not in DIMENSIONS:
        raise AnalysisReportError(f"بُعد غير معروف: {dimension}")

    names = ({c.id: c.name for c in db.scalars(select(CostCenter)).all()}
             if dimension == "cost_center"
             else {b.id: b.name for b in db.scalars(select(Branch)).all()})

    rows_in = list(_pnl_lines(db, date_from=date_from, date_to=date_to, branch_id=branch_id))
    dists = (analytic_service.distributions_for(db, [ln.id for ln, _n, _s in rows_in])
             if dimension == "cost_center" else {})

    buckets: dict = {}
    for line, nature, signed in rows_in:
        parts = (analytic_service.shares_of(line, signed, dists.get(line.id))
                 if dimension == "cost_center"
                 else [(line.entry.branch_id, signed)])
        for key, part in parts:
            if key is None and not include_unassigned:
                continue
            bucket = buckets.setdefault(key, {
                "key": key, "label": names.get(key) or UNASSIGNED,
                "income": ZERO, "expenses": ZERO, "lines": 0,
            })
            bucket["lines"] += 1
            if nature == AccountNature.income:
                bucket["income"] += part
            else:
                bucket["expenses"] += part

    rows = [{
        "key": b["key"], "label": b["label"], "lines": b["lines"],
        "income": str(to_money(b["income"])),
        "expenses": str(to_money(b["expenses"])),
        "profit": str(to_money(b["income"] - b["expenses"])),
        "margin_pct": str(to_money(
            (b["income"] - b["expenses"]) / b["income"] * 100)) if b["income"] else None,
        "unassigned": b["key"] is None,
    } for b in buckets.values()]
    rows.sort(key=lambda r: Decimal(r["profit"]), reverse=True)

    total_income = sum((Decimal(r["income"]) for r in rows), ZERO)
    total_expenses = sum((Decimal(r["expenses"]) for r in rows), ZERO)
    return {
        "dimension": dimension,
        "date_from": str(date_from) if date_from else None,
        "date_to": str(date_to) if date_to else None,
        "rows": rows,
        "totals": {
            "rows": len(rows),
            "income": str(to_money(total_income)),
            "expenses": str(to_money(total_expenses)),
            "profit": str(to_money(total_income - total_expenses)),
            "margin_pct": str(to_money(
                (total_income - total_expenses) / total_income * 100))
            if total_income else None,
            "unassigned_lines": sum(r["lines"] for r in rows if r["unassigned"]),
        },
    }


def account_breakdown(
    db: Session, *, dimension: str = "cost_center", key: int | None = None,
    date_from=None, date_to=None,
) -> dict:
    if dimension not in DIMENSIONS:
        raise AnalysisReportError(f"بُعد غير معروف: {dimension}")

    rows_in = list(_pnl_lines(db, date_from=date_from, date_to=date_to, branch_id=branch_id))
    dists = (analytic_service.distributions_for(db, [ln.id for ln, _n, _s in rows_in])
             if dimension == "cost_center" else {})

    buckets: dict = {}
    for line, nature, signed in rows_in:
        parts = (analytic_service.shares_of(line, signed, dists.get(line.id))
                 if dimension == "cost_center"
                 else [(line.entry.branch_id, signed)])
        for row_key, part in parts:
            if row_key != key:
                continue
            bucket = buckets.setdefault(line.account_id, {
                "account_id": line.account_id,
                "code": line.account.code,
                "name": line.account.name or (line.account.account_type.value),
                "nature": nature.value, "amount": ZERO, "lines": 0,
            })
            bucket["amount"] += part
            bucket["lines"] += 1

    rows = [{**b, "amount": str(to_money(b["amount"]))} for b in buckets.values()]
    rows.sort(key=lambda r: (r["nature"], r["code"] or ""))
    income = sum((Decimal(r["amount"]) for r in rows if r["nature"] == "income"), ZERO)
    expenses = sum((Decimal(r["amount"]) for r in rows if r["nature"] == "expense"), ZERO)
    return {
        "dimension": dimension, "key": key, "rows": rows,
        "totals": {
            "rows": len(rows),
            "income": str(to_money(income)),
            "expenses": str(to_money(expenses)),
            "profit": str(to_money(income - expenses)),
        },
    }
