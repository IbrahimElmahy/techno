from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.services import move_registry
from src.models.ledger import Account, AccountType, Direction, LedgerEntry, LedgerLine
from src.models.reconcile import FullReconcile, PartialReconcile, format_number
from src.services import ledger_service, move_registry


class ReconcileError(Exception):
    pass


class PaymentState:
    not_paid = "not_paid"
    partial = "partial"
    paid = "paid"


PAYMENT_STATE_LABEL: dict[str, str] = {
    PaymentState.not_paid: "غير مدفوعة",
    PaymentState.partial: "مدفوعة جزئياً",
    PaymentState.paid: "مدفوعة",
}


def signed_amount(line: LedgerLine) -> Decimal:
    amount = to_money(line.amount)
    return amount if line.direction == Direction.debit else -amount


RECONCILABLE_TYPES = (AccountType.customer_receivable, AccountType.supplier_payable)


def is_reconcilable(account: Account | None) -> bool:
    if account is None:
        return False
    return (
        bool(getattr(account, "reconcilable", False))
        or account.account_type in RECONCILABLE_TYPES
    )


def initial_residual(db: Session, line: LedgerLine) -> Decimal | None:
    account = line.account or db.get(Account, line.account_id)
    if not is_reconcilable(account):
        return None
    return signed_amount(line)


def stamp_residuals(db: Session, entry: LedgerEntry) -> None:
    for line in entry.lines:
        if line.amount_residual is None:
            residual = initial_residual(db, line)
            if residual is not None:
                line.amount_residual = residual


def residual_of(line: LedgerLine) -> Decimal:
    return to_money(line.amount_residual) if line.amount_residual is not None else ZERO


def is_open(line: LedgerLine) -> bool:
    return line.amount_residual is not None and to_money(line.amount_residual) != ZERO


@dataclass
class OpenLine:
    line_id: int
    entry_id: int
    entry_number: str | None
    move_type: str | None
    move_type_label: str | None
    account_id: int
    entry_date: date | None
    date_maturity: date | None
    description: str
    statement: str | None
    direction: str
    amount: Decimal
    residual: Decimal


def _open_line(line: LedgerLine) -> OpenLine:
    entry = line.entry
    return OpenLine(
        line_id=line.id,
        entry_id=entry.id,
        entry_number=entry.number,
        move_type=entry.move_type,
        move_type_label=move_registry.MOVE_TYPE_LABEL.get(entry.move_type or ""),
        account_id=line.account_id,
        entry_date=entry.entry_date or entry.created_at.date(),
        date_maturity=line.date_maturity,
        description=entry.description,
        statement=line.statement,
        direction=line.direction.value,
        amount=to_money(line.amount),
        residual=residual_of(line),
    )


def open_lines(
    db: Session,
    *,
    partner_kind: str | None = None,
    partner_id: int | None = None,
    account_id: int | None = None,
) -> list[OpenLine]:
    stmt = (
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry), selectinload(LedgerLine.account))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(
            LedgerLine.amount_residual.is_not(None),
            LedgerLine.amount_residual != 0,
            ledger_service.is_posted_sql(),
        )
    )
    if partner_kind is not None:
        stmt = stmt.where(LedgerLine.partner_kind == partner_kind)
    if partner_id is not None:
        stmt = stmt.where(LedgerLine.partner_id == partner_id)
    if account_id is not None:
        stmt = stmt.where(LedgerLine.account_id == account_id)
    rows = [_open_line(ln) for ln in db.scalars(stmt).all()]
    rows.sort(key=lambda r: (r.date_maturity or r.entry_date or date.max, r.line_id))
    return rows


def _load_lines(db: Session, line_ids: list[int]) -> list[LedgerLine]:
    lines = db.scalars(
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry), selectinload(LedgerLine.account))
        .where(LedgerLine.id.in_(line_ids))
    ).all()
    missing = set(line_ids) - {ln.id for ln in lines}
    if missing:
        raise ReconcileError("فيه سطور مش موجودة.")
    return list(lines)


def _assert_matchable(lines: list[LedgerLine]) -> None:
    if len(lines) < 2:
        raise ReconcileError("المطابقة محتاجة سطرين على الأقل.")
    accounts = {ln.account_id for ln in lines}
    if len(accounts) > 1:
        raise ReconcileError(
            "السطور دي على حسابات مختلفة — المطابقة بتبقى جوّه الحساب الواحد.")
    for line in lines:
        if line.amount_residual is None:
            raise ReconcileError(
                "فيه سطر على حساب مش قابل للتسوية — فعّل «قابل للتسوية» على الحساب الأول.")
        if not ledger_service.is_posted(line.entry):
            raise ReconcileError("فيه سطر قيده مش مرحّل — المسودة مابتتقفلش.")
    debits = [ln for ln in lines if residual_of(ln) > ZERO]
    credits = [ln for ln in lines if residual_of(ln) < ZERO]
    if not debits or not credits:
        raise ReconcileError(
            "لازم يكون فيه مدين ودائن — سطور كلها في اتجاه واحد مالهاش حاجة تتقفل عليها.")


def _next_number(db: Session, full: FullReconcile) -> str:
    return format_number(full.id)


def _connected_component(db: Session, line_ids: set[int]) -> tuple[set[int], list]:
    seen = set(line_ids)
    partials: dict[int, PartialReconcile] = {}
    frontier = set(line_ids)
    while frontier:
        rows = db.scalars(
            select(PartialReconcile).where(
                PartialReconcile.debit_line_id.in_(frontier)
                | PartialReconcile.credit_line_id.in_(frontier)
            )
        ).all()
        nxt: set[int] = set()
        for partial in rows:
            partials[partial.id] = partial
            for side in (partial.debit_line_id, partial.credit_line_id):
                if side not in seen:
                    seen.add(side)
                    nxt.add(side)
        frontier = nxt
    return seen, list(partials.values())


def _close_if_done(
    db: Session, lines: list[LedgerLine], *, actor_user_id: int | None
) -> str | None:
    if any(residual_of(ln) != ZERO for ln in lines):
        return None
    ids, partials = _connected_component(db, {ln.id for ln in lines})
    if len(ids) < 2:
        return None
    component = db.scalars(select(LedgerLine).where(LedgerLine.id.in_(ids))).all()
    if any(residual_of(ln) != ZERO for ln in component):
        return None
    full = FullReconcile(number="", actor_user_id=actor_user_id)
    db.add(full)
    db.flush()
    full.number = _next_number(db, full)
    for line in component:
        line.full_reconcile_id = full.id
    for partial in partials:
        partial.full_reconcile_id = full.id
    db.flush()
    return full.number


def reconcile(
    db: Session, *, line_ids: list[int], actor_user_id: int | None = None
) -> dict:
    lines = _load_lines(db, line_ids)
    _assert_matchable(lines)

    def by_maturity(line: LedgerLine):
        entry_date = line.entry.entry_date or line.entry.created_at.date()
        return (line.date_maturity or entry_date, line.id)

    debits = sorted([ln for ln in lines if residual_of(ln) > ZERO], key=by_maturity)
    credits = sorted([ln for ln in lines if residual_of(ln) < ZERO], key=by_maturity)

    matched = ZERO
    links = 0
    di = ci = 0
    while di < len(debits) and ci < len(credits):
        debit, credit = debits[di], credits[ci]
        amount = min(residual_of(debit), -residual_of(credit))
        if amount <= ZERO:  # pragma: no cover
            break
        db.add(PartialReconcile(
            debit_line_id=debit.id, credit_line_id=credit.id,
            amount=amount, actor_user_id=actor_user_id,
        ))
        debit.amount_residual = to_money(residual_of(debit) - amount)
        credit.amount_residual = to_money(residual_of(credit) + amount)
        matched = to_money(matched + amount)
        links += 1
        if residual_of(debit) == ZERO:
            di += 1
        if residual_of(credit) == ZERO:
            ci += 1
    db.flush()

    number = _close_if_done(db, lines, actor_user_id=actor_user_id)
    refresh_payment_state(db, {ln.entry_id for ln in lines})
    db.flush()
    return {
        "matched": matched,
        "links": links,
        "number": number,
        "lines": [_open_line(ln) for ln in lines],
    }


def auto_reconcile(
    db: Session,
    *,
    partner_kind: str,
    partner_id: int,
    account_id: int | None = None,
    actor_user_id: int | None = None,
) -> dict:
    rows = open_lines(db, partner_kind=partner_kind, partner_id=partner_id,
                      account_id=account_id)
    by_account: dict[int, list[int]] = {}
    for row in rows:
        by_account.setdefault(row.account_id, []).append(row.line_id)

    matched = ZERO
    numbers: list[str] = []
    groups = 0
    for ids in by_account.values():
        if len(ids) < 2:
            continue
        lines = _load_lines(db, ids)
        if not [ln for ln in lines if residual_of(ln) > ZERO]:
            continue
        if not [ln for ln in lines if residual_of(ln) < ZERO]:
            continue
        result = reconcile(db, line_ids=ids, actor_user_id=actor_user_id)
        matched = to_money(matched + result["matched"])
        groups += 1
        if result["number"]:
            numbers.append(result["number"])
    return {"matched": matched, "groups": groups, "numbers": numbers}


def unreconcile(
    db: Session, *, line_ids: list[int] | None = None, number: str | None = None
) -> dict:
    if number:
        full = db.scalar(select(FullReconcile).where(FullReconcile.number == number))
        if full is None:
            raise ReconcileError("رقم المطابقة مش موجود.")
        partials = db.scalars(
            select(PartialReconcile).where(PartialReconcile.full_reconcile_id == full.id)
        ).all()
    elif line_ids:
        partials = db.scalars(
            select(PartialReconcile).where(
                PartialReconcile.debit_line_id.in_(line_ids)
                | PartialReconcile.credit_line_id.in_(line_ids)
            )
        ).all()
        full = None
    else:
        raise ReconcileError("حدد سطور أو رقم مطابقة.")
    if not partials:
        raise ReconcileError("مافيش مطابقة على السطور دي.")

    touched: set[int] = set()
    fulls: set[int] = set()
    for partial in partials:
        debit = db.get(LedgerLine, partial.debit_line_id)
        credit = db.get(LedgerLine, partial.credit_line_id)
        amount = to_money(partial.amount)
        if debit is not None:
            debit.amount_residual = to_money(residual_of(debit) + amount)
            touched.add(debit.entry_id)
            if debit.full_reconcile_id:
                fulls.add(debit.full_reconcile_id)
            debit.full_reconcile_id = None
        if credit is not None:
            credit.amount_residual = to_money(residual_of(credit) - amount)
            touched.add(credit.entry_id)
            if credit.full_reconcile_id:
                fulls.add(credit.full_reconcile_id)
            credit.full_reconcile_id = None
        if partial.full_reconcile_id:
            fulls.add(partial.full_reconcile_id)
        db.delete(partial)
    db.flush()

    for full_id in fulls:
        still = db.scalar(
            select(LedgerLine.id).where(LedgerLine.full_reconcile_id == full_id).limit(1)
        )
        if still is None:
            row = db.get(FullReconcile, full_id)
            if row is not None:
                db.delete(row)
    db.flush()
    refresh_payment_state(db, touched)
    db.flush()
    return {"unlinked": len(partials), "entries": len(touched)}


_DEBIT_SIDE_MOVES = {"out_invoice", "in_refund"}
_CREDIT_SIDE_MOVES = {"out_refund", "in_invoice"}


def payment_state_of(entry: LedgerEntry) -> str | None:
    lines = [ln for ln in entry.lines if ln.amount_residual is not None]
    if not lines:
        return None

    debit_total = sum((signed_amount(ln) for ln in lines if signed_amount(ln) > ZERO), ZERO)
    credit_total = -sum((signed_amount(ln) for ln in lines if signed_amount(ln) < ZERO), ZERO)
    debit_open = sum((residual_of(ln) for ln in lines if residual_of(ln) > ZERO), ZERO)
    credit_open = -sum((residual_of(ln) for ln in lines if residual_of(ln) < ZERO), ZERO)

    move = (entry.move_type or "").strip()
    if not move:
        move = move_registry.move_type_for(entry.entry_type or "").value
    if move in _DEBIT_SIDE_MOVES:
        total, open_now = debit_total, debit_open
    elif move in _CREDIT_SIDE_MOVES:
        total, open_now = credit_total, credit_open
    elif debit_total >= credit_total:
        total, open_now = debit_total, debit_open
    else:
        total, open_now = credit_total, credit_open

    if open_now <= ZERO:
        return PaymentState.paid
    if total == ZERO or open_now >= total:
        return PaymentState.not_paid
    return PaymentState.partial


def refresh_payment_state(db: Session, entry_ids) -> None:
    ids = list(entry_ids)
    if not ids:
        return
    entries = db.scalars(
        select(LedgerEntry).options(selectinload(LedgerEntry.lines))
        .where(LedgerEntry.id.in_(ids))
    ).all()
    for entry in entries:
        entry.payment_state = payment_state_of(entry)
