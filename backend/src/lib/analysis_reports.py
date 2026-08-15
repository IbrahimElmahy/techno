"""تحليل الربحية — بمركز التكلفة وبالفرع.

النظام بيعرف يقول «الشركة كسبت كام». مابيعرفش يقول «الفرع ده كسب كام» ولا «المشروع ده كلّف كام»،
مع إن الداتا اللي بتجاوب على الاتنين مترحّلة في الدفاتر من زمان: `LedgerLine.cost_center_id`
و`LedgerEntry.branch_id` موجودين وبيتكتبوا، ومحدش بيقراهم مجمّعين.

**بيتقرا من الدفتر مش من المستندات.** Re-summing invoices and vouchers would give a second set of
figures that disagrees with the income statement the moment anything is posted by hand — and the
person holding two numbers has no way to tell which is the company's. The ledger is what was
posted; a reversal and its reversed entry both sit in it and net to zero on their own.

**فرق مقصود بين الاتنين، وهو مش تفصيلة:** مركز التكلفة على **السطر**، والفرع على **القيد**. قيد
واحد ينفع يوزّع مصروف على تلات مراكز تكلفة، ومابينفعش يتقسّم على فرعين. So a cost-centre report
splits inside a document and a branch report never does — and a line with no cost centre is «غير
موزّع», a real bucket that has to appear rather than a rounding difference that makes the parts
not add up to the whole.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.cost_center import CostCenter
from src.models.ledger import AccountNature, LedgerLine
from src.models.org import Branch
from src.services.financial_reports_service import _effective_date, effective_nature

DIMENSIONS = ("cost_center", "branch")

UNASSIGNED = "— غير موزّع —"


class AnalysisReportError(ValueError):
    """طلب تقرير مالوش معنى — بيترد ٤٢٢."""


def _pnl_lines(db: Session, *, date_from: date | None, date_to: date | None):
    """كل سطر إيراد أو مصروف في الفترة، ومعاه القيد بتاعه.

    Only income and expense lines: this is profitability, and an asset movement is neither. The
    balance sheet is a different report and stays one.
    """
    rows = db.scalars(
        select(LedgerLine).options(
            selectinload(LedgerLine.entry), selectinload(LedgerLine.account))
    ).all()
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
        # موجب في الاتجاه الطبيعي للحساب — الإيراد دائن والمصروف مدين.
        signed = amount if line.direction == line.account.normal_side else -amount
        yield line, nature, signed


def profitability(
    db: Session,
    *,
    dimension: str = "cost_center",
    date_from=None,
    date_to=None,
    include_unassigned: bool = True,
) -> dict:
    """أرباح وخسائر لكل مركز تكلفة (أو لكل فرع) في فترة."""
    if dimension not in DIMENSIONS:
        raise AnalysisReportError(f"بُعد مش معروف: {dimension}")

    names = ({c.id: c.name for c in db.scalars(select(CostCenter)).all()}
             if dimension == "cost_center"
             else {b.id: b.name for b in db.scalars(select(Branch)).all()})

    buckets: dict = {}
    for line, nature, signed in _pnl_lines(db, date_from=date_from, date_to=date_to):
        key = (line.cost_center_id if dimension == "cost_center"
               else line.entry.branch_id)
        if key is None and not include_unassigned:
            continue
        bucket = buckets.setdefault(key, {
            "key": key, "label": names.get(key) or UNASSIGNED,
            "income": ZERO, "expenses": ZERO, "lines": 0,
        })
        bucket["lines"] += 1
        if nature == AccountNature.income:
            bucket["income"] += signed
        else:
            bucket["expenses"] += signed

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
            # اللي ماتوزّعش لازم يبان كرقم، مش كفرق بين المجاميع. Somebody comparing the branch
            # report to the income statement has to be able to see where the gap went.
            "unassigned_lines": sum(r["lines"] for r in rows if r["unassigned"]),
        },
    }


def account_breakdown(
    db: Session, *, dimension: str = "cost_center", key: int | None = None,
    date_from=None, date_to=None,
) -> dict:
    """تفصيل مركز واحد (أو فرع واحد) بالحساب — «الرقم ده جه منين».

    A profitability row without this is a figure nobody can check. The first question after «هذا
    المركز خسر ٢٠ ألف» is always «في إيه», and the answer is the accounts underneath it.
    """
    if dimension not in DIMENSIONS:
        raise AnalysisReportError(f"بُعد مش معروف: {dimension}")

    buckets: dict = {}
    for line, nature, signed in _pnl_lines(db, date_from=date_from, date_to=date_to):
        row_key = (line.cost_center_id if dimension == "cost_center"
                   else line.entry.branch_id)
        if row_key != key:
            continue
        bucket = buckets.setdefault(line.account_id, {
            "account_id": line.account_id,
            "code": line.account.code,
            "name": line.account.name or (line.account.account_type.value),
            "nature": nature.value, "amount": ZERO, "lines": 0,
        })
        bucket["amount"] += signed
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
