"""Rep commissions — 021-tax-commissions (عمولات المناديب).

A commission rule is a percentage for one rep (or a company-wide default when `rep_user_id`
is NULL). The report computes each rep's commission over a period from what he actually
brought in, on either basis:

    sales      — على المبيعات: the net of his invoices (earned when sold)
    collection — على التحصيل: his receipts (earned only when the money arrives)

Nothing is posted automatically: the manager reviews the report and pays with an expense
voucher, which keeps the ledger honest about when the obligation was accepted.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.commission import CommissionRule
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice, SalesReturn
from src.models.user import User
from src.models.voucher import Voucher, VoucherKind
from src.services import audit_service


class CommissionBasis(str, enum.Enum):
    sales = "sales"
    collection = "collection"


class CommissionError(Exception):
    pass


@dataclass(frozen=True)
class CommissionRow:
    rep_user_id: int
    rep_name: str
    basis: CommissionBasis
    rate_pct: Decimal
    base_amount: Decimal   # مبيعات أو تحصيل الفترة
    commission: Decimal


def set_rule(
    db: Session, *, rate_pct, actor_user_id: int, rep_user_id: int | None = None,
    basis: CommissionBasis = CommissionBasis.collection,
) -> CommissionRule:
    """Set (or replace) the rule for one rep, or the company default when rep is None."""
    rate = Decimal(str(rate_pct))
    if rate < 0 or rate > 100:
        raise CommissionError("نسبة العمولة لازم تكون بين 0 و 100.")
    if rep_user_id is not None and db.get(User, rep_user_id) is None:
        raise CommissionError("المندوب غير موجود.")
    existing = db.scalar(
        select(CommissionRule).where(CommissionRule.rep_user_id.is_(rep_user_id)
                                     if rep_user_id is None
                                     else CommissionRule.rep_user_id == rep_user_id)
    )
    if existing is None:
        existing = CommissionRule(rep_user_id=rep_user_id, rate_pct=rate,
                                  basis=basis.value, actor_user_id=actor_user_id)
        db.add(existing)
    else:
        existing.rate_pct = rate
        existing.basis = basis.value
        existing.actor_user_id = actor_user_id
    db.flush()
    audit_service.record(db, action="commission.rule", actor_user_id=actor_user_id,
                         entity_type="commission_rule", entity_id=existing.id,
                         after={"rep": rep_user_id, "rate": str(rate), "basis": basis.value})
    return existing


def list_rules(db: Session) -> list[CommissionRule]:
    return db.scalars(select(CommissionRule).order_by(CommissionRule.id)).all()


def _rule_for(db: Session, rep_user_id: int) -> CommissionRule | None:
    own = db.scalar(select(CommissionRule).where(CommissionRule.rep_user_id == rep_user_id))
    if own is not None:
        return own
    return db.scalar(select(CommissionRule).where(CommissionRule.rep_user_id.is_(None)))


def _in_window(when: date, date_from: date | None, date_to: date | None) -> bool:
    if date_from is not None and when < date_from:
        return False
    return not (date_to is not None and when > date_to)


def compute(
    db: Session, *, date_from: date | None = None, date_to: date | None = None,
    rep_user_id: int | None = None,
) -> list[CommissionRow]:
    """كشف عمولات المناديب للفترة."""
    reps = db.scalars(
        select(User).join(Role, User.role_id == Role.id)
        .where(Role.name == RoleName.sales_rep)
    ).all()
    if rep_user_id is not None:
        reps = [r for r in reps if r.id == rep_user_id]

    invoices = db.scalars(select(SalesInvoice)).all()
    returns = db.scalars(select(SalesReturn).options(selectinload(SalesReturn.lines))).all()
    receipts = db.scalars(
        select(Voucher).where(Voucher.kind == VoucherKind.receipt)
    ).all()
    invoice_by_id = {inv.id: inv for inv in invoices}

    rows: list[CommissionRow] = []
    for rep in reps:
        rule = _rule_for(db, rep.id)
        if rule is None or Decimal(str(rule.rate_pct)) <= 0:
            continue
        basis = CommissionBasis(rule.basis)
        rate = Decimal(str(rule.rate_pct))
        base = ZERO

        if basis == CommissionBasis.sales:
            for inv in invoices:
                if inv.actor_user_id != rep.id:
                    continue
                if not _in_window(inv.created_at.date(), date_from, date_to):
                    continue
                base += to_money(inv.net)
            for ret in returns:  # returns claw the commission back
                inv = invoice_by_id.get(ret.sales_invoice_id)
                if inv is None or inv.actor_user_id != rep.id:
                    continue
                if not _in_window(ret.created_at.date(), date_from, date_to):
                    continue
                base -= to_money(ret.value)
        else:
            for voucher in receipts:
                if voucher.actor_user_id != rep.id:
                    continue
                if not _in_window(voucher.voucher_date, date_from, date_to):
                    continue
                # A reversal row mirrors the original, so subtract it back out.
                base += (-to_money(voucher.amount) if voucher.reverses_id is not None
                         else to_money(voucher.amount))

        base = to_money(base)
        if base <= ZERO:
            continue
        rows.append(CommissionRow(
            rep_user_id=rep.id, rep_name=rep.full_name or rep.username, basis=basis,
            rate_pct=rate, base_amount=base,
            commission=to_money(base * rate / Decimal("100")),
        ))
    rows.sort(key=lambda r: r.commission, reverse=True)
    return rows
