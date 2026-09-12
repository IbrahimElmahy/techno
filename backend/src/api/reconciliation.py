"""تسوية الفواتير بالدفعات — المرحلة ٣ من إعادة الهيكلة على موديل أودو.

شاشة المطابقة بتقرا من هنا: المفتوح على طرف، وقفله، وفكه، وتاريخ اللي اتقفل قبل كده.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_ACCOUNTING_CHART_READ, CAP_ACCOUNTING_JOURNAL_POST
from src.core.db import get_db
from src.core.money import ZERO, to_money
from src.models.customer import Customer
from src.models.employee import Employee
from src.models.ledger import Account, LedgerEntry, LedgerLine, PartnerKind
from src.models.reconcile import FullReconcile, PartialReconcile
from src.models.supplier import Supplier
from src.services import move_registry, reconcile_service
from src.services.reconcile_service import ReconcileError

router = APIRouter(tags=["reconciliation"])


class OpenLineOut(BaseModel):
    line_id: int
    entry_id: int
    entry_number: str | None
    move_type: str | None
    move_type_label: str | None
    account_id: int
    account_name: str | None = None
    entry_date: date | None
    date_maturity: date | None
    description: str
    statement: str | None
    direction: str
    amount: Decimal
    residual: Decimal


class OpenLinesOut(BaseModel):
    """المفتوح على الطرف ده، ومجاميعه — عشان الشاشة ماتجمعش بإيدها."""

    lines: list[OpenLineOut]
    total_debit: Decimal
    total_credit: Decimal
    balance: Decimal


class ReconcileIn(BaseModel):
    line_ids: list[int] = Field(min_length=2)


class AutoReconcileIn(BaseModel):
    partner_kind: str
    partner_id: int
    account_id: int | None = None


class UnreconcileIn(BaseModel):
    """فك بالسطور أو برقم المطابقة — الاتنين بيوصلوا لنفس المكان."""

    line_ids: list[int] | None = None
    number: str | None = None


class MatchedGroupOut(BaseModel):
    number: str
    created_at: date | None
    lines: list[OpenLineOut]
    amount: Decimal


def _account_names(db: Session, account_ids) -> dict[int, str]:
    ids = {int(i) for i in account_ids if i}
    if not ids:
        return {}
    rows = db.execute(
        select(Account.id, Account.code, Account.name).where(Account.id.in_(ids))
    ).all()
    return {int(i): " ".join(x for x in (code, name) if x) or f"#{i}"
            for i, code, name in rows}


def _to_out(row, account_names: dict[int, str]) -> OpenLineOut:
    return OpenLineOut(
        line_id=row.line_id, entry_id=row.entry_id, entry_number=row.entry_number,
        move_type=row.move_type, move_type_label=row.move_type_label,
        account_id=row.account_id, account_name=account_names.get(row.account_id),
        entry_date=row.entry_date, date_maturity=row.date_maturity,
        description=row.description, statement=row.statement, direction=row.direction,
        amount=row.amount, residual=row.residual,
    )


@router.get("/reconciliation/open", response_model=OpenLinesOut)
def open_items(
    partner_kind: str | None = Query(default=None),
    partner_id: int | None = None,
    account_id: int | None = None,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> OpenLinesOut:
    """السطور اللي لسه عليها متبقّي — الفواتير والدفعات اللي مالهاش غطا."""
    rows = reconcile_service.open_lines(
        db, partner_kind=partner_kind, partner_id=partner_id, account_id=account_id)
    names = _account_names(db, [r.account_id for r in rows])
    lines = [_to_out(r, names) for r in rows]
    debit = sum((r.residual for r in rows if r.residual > ZERO), ZERO)
    credit = sum((-r.residual for r in rows if r.residual < ZERO), ZERO)
    return OpenLinesOut(
        lines=lines, total_debit=to_money(debit), total_credit=to_money(credit),
        balance=to_money(debit - credit),
    )


@router.get("/reconciliation/partners", response_model=list[dict])
def partners_with_open_items(
    partner_kind: str = Query(default=PartnerKind.customer.value),
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """الأطراف اللي عندهم مفتوح — عشان الشاشة تبدأ من قايمة مش من خانة بحث فاضية."""
    rows = db.execute(
        select(LedgerLine.partner_id, LedgerLine.amount_residual)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(
            LedgerLine.partner_kind == partner_kind,
            LedgerLine.partner_id.is_not(None),
            LedgerLine.amount_residual.is_not(None),
            LedgerLine.amount_residual != 0,
        )
    ).all()
    totals: dict[int, Decimal] = {}
    counts: dict[int, int] = {}
    for partner_id, residual in rows:
        pid = int(partner_id)
        totals[pid] = to_money(totals.get(pid, ZERO) + to_money(residual))
        counts[pid] = counts.get(pid, 0) + 1
    if not totals:
        return []
    model = {
        PartnerKind.customer.value: Customer,
        PartnerKind.supplier.value: Supplier,
        PartnerKind.employee.value: Employee,
    }.get(partner_kind, Customer)
    names = {
        int(i): n for i, n in db.execute(
            select(model.id, model.name).where(model.id.in_(list(totals)))
        ).all()
    }
    out = [
        {"partner_id": pid, "partner_kind": partner_kind,
         "partner_name": names.get(pid, f"#{pid}"), "open_lines": counts[pid],
         "balance": str(total)}
        for pid, total in totals.items()
    ]
    out.sort(key=lambda r: abs(Decimal(r["balance"])), reverse=True)
    return out


@router.post("/reconciliation", response_model=dict)
def reconcile(
    body: ReconcileIn,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """يقفل السطور المحددة على بعضها."""
    try:
        result = reconcile_service.reconcile(
            db, line_ids=body.line_ids, actor_user_id=current.id)
    except ReconcileError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "reconcile_invalid", "message": str(exc)})
    db.commit()
    return {"matched": str(result["matched"]), "links": result["links"],
            "number": result["number"]}


@router.post("/reconciliation/auto", response_model=dict)
def auto_reconcile(
    body: AutoReconcileIn,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """مطابقة تلقائية للطرف ده — الأقدم استحقاقاً يتقفل الأول."""
    try:
        result = reconcile_service.auto_reconcile(
            db, partner_kind=body.partner_kind, partner_id=body.partner_id,
            account_id=body.account_id, actor_user_id=current.id)
    except ReconcileError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "reconcile_invalid", "message": str(exc)})
    db.commit()
    return {"matched": str(result["matched"]), "groups": result["groups"],
            "numbers": result["numbers"]}


@router.post("/reconciliation/unreconcile", response_model=dict)
def unreconcile(
    body: UnreconcileIn,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """يفك المطابقة ويرجّع المتبقّي."""
    try:
        result = reconcile_service.unreconcile(
            db, line_ids=body.line_ids, number=body.number)
    except ReconcileError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "reconcile_invalid", "message": str(exc)})
    db.commit()
    return result


@router.get("/reconciliation/matched", response_model=list[MatchedGroupOut])
def matched_groups(
    partner_kind: str | None = Query(default=None),
    partner_id: int | None = None,
    limit: int = Query(default=50, le=200),
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[MatchedGroupOut]:
    """المطابقات اللي اتعملت — كل مجموعة برقمها وسطورها، عشان تتراجع وتتفك."""
    stmt = select(FullReconcile).order_by(FullReconcile.id.desc()).limit(limit)
    if partner_kind or partner_id:
        line_stmt = select(LedgerLine.full_reconcile_id).where(
            LedgerLine.full_reconcile_id.is_not(None))
        if partner_kind:
            line_stmt = line_stmt.where(LedgerLine.partner_kind == partner_kind)
        if partner_id:
            line_stmt = line_stmt.where(LedgerLine.partner_id == partner_id)
        stmt = stmt.where(FullReconcile.id.in_(line_stmt))
    groups = db.scalars(stmt).all()
    if not groups:
        return []
    lines = db.scalars(
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry))
        .where(LedgerLine.full_reconcile_id.in_([g.id for g in groups]))
    ).all()
    names = _account_names(db, [ln.account_id for ln in lines])
    by_group: dict[int, list[LedgerLine]] = {}
    for line in lines:
        by_group.setdefault(int(line.full_reconcile_id), []).append(line)

    out: list[MatchedGroupOut] = []
    for group in groups:
        group_lines = by_group.get(group.id, [])
        amount = sum(
            (to_money(ln.amount) for ln in group_lines
             if ln.direction.value == "debit"), ZERO)
        out.append(MatchedGroupOut(
            number=group.number,
            created_at=group.created_at.date() if group.created_at else None,
            amount=to_money(amount),
            lines=[
                OpenLineOut(
                    line_id=ln.id, entry_id=ln.entry_id, entry_number=ln.entry.number,
                    move_type=ln.entry.move_type,
                    move_type_label=move_registry.MOVE_TYPE_LABEL.get(
                        ln.entry.move_type or ""),
                    account_id=ln.account_id, account_name=names.get(ln.account_id),
                    entry_date=ln.entry.entry_date or ln.entry.created_at.date(),
                    date_maturity=ln.date_maturity, description=ln.entry.description,
                    statement=ln.statement, direction=ln.direction.value,
                    amount=to_money(ln.amount), residual=to_money(ln.amount_residual or 0),
                )
                for ln in group_lines
            ],
        ))
    return out


@router.get("/reconciliation/entry/{entry_id}", response_model=dict)
def entry_matching(
    entry_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """«الفاتورة دي اتدفعت بإيه» — المستندات اللي اتقفلت عليها، والمتبقّي عليها.

    ده الرابط اللي بيخلّي الفاتورة تودّي للدفعة والدفعة تودّي للفاتورة، بدل ما
    الاتنين يفضلوا سطرين على حساب واحد.
    """
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "القيد مش موجود"})
    line_ids = [ln.id for ln in entry.lines]
    partials = db.scalars(
        select(PartialReconcile).where(
            PartialReconcile.debit_line_id.in_(line_ids)
            | PartialReconcile.credit_line_id.in_(line_ids)
        )
    ).all()
    other_ids = set()
    for partial in partials:
        other_ids.add(partial.debit_line_id)
        other_ids.add(partial.credit_line_id)
    other_ids -= set(line_ids)
    counterparts = []
    if other_ids:
        rows = db.scalars(
            select(LedgerLine).options(selectinload(LedgerLine.entry))
            .where(LedgerLine.id.in_(other_ids))
        ).all()
        amount_by_line: dict[int, Decimal] = {}
        for partial in partials:
            for side in (partial.debit_line_id, partial.credit_line_id):
                if side in other_ids:
                    amount_by_line[side] = to_money(
                        amount_by_line.get(side, ZERO) + to_money(partial.amount))
        counterparts = [
            {
                "line_id": ln.id, "entry_id": ln.entry_id,
                "entry_number": ln.entry.number,
                "move_type": ln.entry.move_type,
                "move_type_label": move_registry.MOVE_TYPE_LABEL.get(
                    ln.entry.move_type or ""),
                "date": str(ln.entry.entry_date or ln.entry.created_at.date()),
                "description": ln.entry.description,
                "applied": str(amount_by_line.get(ln.id, ZERO)),
            }
            for ln in rows
        ]
    residual = sum(
        (abs(to_money(ln.amount_residual)) for ln in entry.lines
         if ln.amount_residual is not None), ZERO)
    return {
        "entry_id": entry.id,
        "number": entry.number,
        "payment_state": entry.payment_state,
        "payment_state_label": reconcile_service.PAYMENT_STATE_LABEL.get(
            entry.payment_state or ""),
        "residual": str(to_money(residual)),
        "counterparts": counterparts,
        "line_ids": line_ids,
    }
