from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.employee import Employee
from src.models.hr_advance import (
    AdjustmentBasis,
    AdjustmentKind,
    AdjustmentStatus,
    AdvanceStatus,
    EmployeeAdvance,
    EmployeeAdvanceInstalment,
    PayrollAdjustment,
)
from src.models.ledger import AccountNature, Direction, PartnerKind
from src.services import account_resolver, audit_service, ledger_service, numbering
from src.services.ledger_service import LineInput

_ADVANCE_ACCOUNT = ("1.02.010", "سلف العاملين", AccountNature.asset, Direction.debit, "1.02")


class AdvanceError(Exception):
    pass


def _get_or_create_account(db: Session):
    from src.models.ledger import Account, AccountType

    code, name, nature, side, parent_code = _ADVANCE_ACCOUNT
    acc = db.scalar(select(Account).where(Account.code == code))
    if acc is not None:
        return acc
    parent = db.scalar(select(Account).where(Account.code == parent_code))
    acc = Account(
        account_type=AccountType.user_defined, normal_side=side, code=code, name=name,
        nature=nature, is_postable=True, is_system=True,
        parent_id=parent.id if parent else None,
    )
    db.add(acc)
    db.flush()
    return acc


def advances_account_id(db: Session) -> int:
    return _get_or_create_account(db).id


def _cash_side(db: Session, *, treasury_id: int | None,
               branch_id: int | None) -> tuple[int, int | None]:
    from src.models.treasury import Treasury

    if treasury_id is not None:
        t = db.get(Treasury, treasury_id)
        if t is None or not t.active:
            raise AdvanceError("الخزنة غير موجودة.")
        return t.account_id, t.id
    if branch_id is not None:
        own = db.scalar(select(Treasury).where(
            Treasury.branch_id == branch_id, Treasury.active.is_(True)).order_by(Treasury.id))
        if own is not None:
            return own.account_id, own.id
    return account_resolver.treasury_account(db, branch_id=branch_id).id, None


def _split(amount: Decimal, count: int) -> list[Decimal]:
    if count <= 0:
        raise AdvanceError("يجب ألا يقل عدد الأقساط عن واحد.")
    each = to_money(amount / count)
    parts = [each] * (count - 1)
    parts.append(to_money(amount - each * (count - 1)))
    return parts


def create_advance(
    db: Session,
    *,
    employee_id: int,
    amount,
    advance_date: date,
    actor_user_id: int,
    instalments: int = 1,
    start_year: int | None = None,
    start_month: int | None = None,
    reason: str | None = None,
    treasury_id: int | None = None,
    branch_id: int | None = None,
    cost_center_id: int | None = None,
    post: bool = True,
    plan: list[dict] | None = None,
    actor_role=None,
) -> EmployeeAdvance:
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise AdvanceError("الموظف غير موجود.")
    value = to_money(Decimal(str(amount or 0)))
    if value <= 0:
        raise AdvanceError("يجب أن يكون مبلغ السلفة أكبر من صفر.")
    if instalments < 1:
        raise AdvanceError("يجب ألا يقل عدد الأقساط عن واحد.")

    year = start_year or advance_date.year
    month = start_month or advance_date.month
    if not 1 <= month <= 12:
        raise AdvanceError("يجب أن يكون الشهر من 1 إلى 12.")

    rows = _plan_rows(value, plan, instalments, year, month)
    row = EmployeeAdvance(
        document_number=numbering.next_document_number(db, EmployeeAdvance, "ADV"),
        employee_id=employee_id, advance_date=advance_date, amount=value,
        instalments=max(len(rows), 1), instalment_amount=rows[0][2] if rows else ZERO,
        start_year=year, start_month=month, reason=reason,
        treasury_id=treasury_id, branch_id=branch_id, cost_center_id=cost_center_id,
        actor_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    _write_plan(db, row, rows)

    if post:
        _disburse(db, row, emp, value=value, advance_date=advance_date, treasury_id=treasury_id,
                  actor_user_id=actor_user_id, actor_role=actor_role,
                  cost_center_id=cost_center_id, reason=reason)

    audit_service.record(
        db, action="advance.create", actor_user_id=actor_user_id,
        entity_type="employee_advance", entity_id=row.id,
        after={"employee_id": employee_id, "amount": str(value),
               "instalments": instalments},
    )
    return row


def settled_sql():
    return or_(EmployeeAdvanceInstalment.payroll_line_id.is_not(None),
               EmployeeAdvanceInstalment.voucher_id.is_not(None))


def taken_of(db: Session, advance_id: int) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(EmployeeAdvanceInstalment.amount), 0))
        .where(EmployeeAdvanceInstalment.advance_id == advance_id, settled_sql())
    ) or 0
    return to_money(Decimal(str(total)))


def debit_account_of(db: Session, advance: EmployeeAdvance) -> int:
    return advance.account_id or advances_account_id(db)


def employee_account_id(db: Session, emp: Employee) -> int:
    if emp.receivable_account_id is None:
        from src.services import employee_card_service

        employee_card_service.open_card(db, emp)
        db.flush()
    if emp.receivable_account_id is None:
        raise AdvanceError(f"«{emp.name}» ليس له حساب ذمة — افتح له كارت من شاشة الموظفين.")
    return emp.receivable_account_id


def _plan_rows(value: Decimal, plan: list[dict] | None, instalments: int,
               year: int, month: int) -> list[tuple[int, int, Decimal]]:
    if plan is None:
        out, y, m = [], year, month
        for part in _split(value, instalments):
            out.append((y, m, part))
            m += 1
            if m > 12:
                m, y = 1, y + 1
        return out
    out, seen = [], set()
    for r in plan:
        y, m = int(r["year"]), int(r["month"])
        amount = to_money(Decimal(str(r.get("amount") or 0)))
        if amount <= 0:
            continue
        if not 1 <= m <= 12:
            raise AdvanceError("يجب أن يكون الشهر من 1 إلى 12.")
        if (y, m) in seen:
            raise AdvanceError(f"الشهر {y}/{m:02d} مكرر في خطة السداد.")
        seen.add((y, m))
        out.append((y, m, amount))
    if to_money(sum((a for _, _, a in out), ZERO)) > value:
        raise AdvanceError("مجموع الأقساط أكبر من المبلغ المتبقي من السلفة.")
    return sorted(out)


def _write_plan(db: Session, row: EmployeeAdvance, rows: list[tuple[int, int, Decimal]]) -> None:
    for y, m, amount in rows:
        db.add(EmployeeAdvanceInstalment(advance_id=row.id, year=y, month=m, amount=amount))
    pending = [a for _, _, a in rows]
    row.instalments = len(pending) or 1
    row.instalment_amount = pending[0] if pending else ZERO
    if rows:
        row.start_year, row.start_month = rows[0][0], rows[0][1]
    db.flush()


def _disburse(db: Session, row: EmployeeAdvance, emp: Employee, *, value: Decimal,
              advance_date: date, treasury_id: int | None, actor_user_id: int, actor_role,
              cost_center_id: int | None, reason: str | None) -> None:
    from src.services import voucher_service

    account_id = employee_account_id(db, emp)
    try:
        voucher = voucher_service._party_voucher(
            db, receipt=False, value=value, actor_user_id=actor_user_id, actor_role=actor_role,
            account_id=account_id, treasury_id=treasury_id, voucher_date=advance_date,
            description=f"سلفة {row.document_number} — {emp.name}",
            cost_center_id=cost_center_id, statement1=reason)
    except voucher_service.VoucherError as exc:
        raise AdvanceError(str(exc)) from exc
    row.voucher_id = voucher.id
    row.ledger_entry_id = voucher.ledger_entry_id
    row.treasury_id = voucher.treasury_id
    row.account_id = account_id
    db.flush()


def _undo_disbursement(db: Session, row: EmployeeAdvance, actor_user_id: int) -> None:
    from src.services import voucher_service

    if row.voucher_id:
        try:
            mirror = voucher_service.reverse_voucher(
                db, voucher_id=row.voucher_id, actor_user_id=actor_user_id)
        except voucher_service.VoucherError as exc:
            raise AdvanceError(str(exc)) from exc
        row.reversal_entry_id = mirror.ledger_entry_id
    elif row.ledger_entry_id:
        reversal = ledger_service.reverse_entry(
            db, original_id=row.ledger_entry_id, actor_user_id=actor_user_id)
        row.reversal_entry_id = reversal.id
    db.flush()


def _pending(db: Session, advance_id: int) -> list[EmployeeAdvanceInstalment]:
    return list(db.scalars(select(EmployeeAdvanceInstalment).where(
        EmployeeAdvanceInstalment.advance_id == advance_id,
        EmployeeAdvanceInstalment.payroll_line_id.is_(None),
        EmployeeAdvanceInstalment.voucher_id.is_(None))
        .order_by(EmployeeAdvanceInstalment.year, EmployeeAdvanceInstalment.month)).all())


def set_plan(db: Session, *, advance_id: int, plan: list[dict], actor_user_id: int) -> EmployeeAdvance:
    row = db.get(EmployeeAdvance, advance_id)
    if row is None:
        raise AdvanceError("السلفة غير موجودة.")
    if row.status != AdvanceStatus.active:
        raise AdvanceError("هذه السلفة غير مفتوحة.")
    left = outstanding_of(db, row)
    rows = _plan_rows(left, plan, 1, row.start_year, row.start_month)
    taken_months = {(p.year, p.month) for p in db.scalars(select(EmployeeAdvanceInstalment).where(
        EmployeeAdvanceInstalment.advance_id == advance_id,
        EmployeeAdvanceInstalment.payroll_line_id.is_not(None))).all()}
    clash = [f"{y}/{m:02d}" for y, m, _ in rows if (y, m) in taken_months]
    if clash:
        raise AdvanceError(f"شهر {clash[0]} خُصم فيه قسط بالفعل من المرتب.")
    before = [(p.year, p.month, str(p.amount)) for p in _pending(db, advance_id)]
    for p in _pending(db, advance_id):
        db.delete(p)
    db.flush()
    _write_plan(db, row, rows)
    audit_service.record(db, action="advance.plan", actor_user_id=actor_user_id,
                         entity_type="employee_advance", entity_id=row.id,
                         before={"plan": before},
                         after={"plan": [(y, m, str(a)) for y, m, a in rows]})
    return row


def repay(db: Session, *, advance_id: int, amount, pay_date: date, treasury_id: int | None,
          actor_user_id: int, actor_role, notes: str | None = None) -> EmployeeAdvance:
    from src.services import voucher_service

    row = db.get(EmployeeAdvance, advance_id)
    if row is None:
        raise AdvanceError("السلفة غير موجودة.")
    if row.status != AdvanceStatus.active:
        raise AdvanceError("هذه السلفة غير مفتوحة.")
    value = to_money(Decimal(str(amount or 0)))
    if value <= 0:
        raise AdvanceError("يجب أن يكون المبلغ أكبر من صفر.")
    left = outstanding_of(db, row)
    if value > left:
        raise AdvanceError(f"المبلغ أكبر من المتبقي من السلفة ({left}).")
    emp = db.get(Employee, row.employee_id)
    try:
        voucher = voucher_service._party_voucher(
            db, receipt=True, value=value, actor_user_id=actor_user_id, actor_role=actor_role,
            account_id=debit_account_of(db, row), treasury_id=treasury_id, voucher_date=pay_date,
            description=f"تحصيل من سلفة {row.document_number} — {emp.name if emp else ''}",
            statement1=notes)
    except voucher_service.VoucherError as exc:
        raise AdvanceError(str(exc)) from exc
    db.add(EmployeeAdvanceInstalment(advance_id=row.id, year=pay_date.year, month=pay_date.month,
                                     amount=value, voucher_id=voucher.id, paid_on=pay_date))
    db.flush()
    remaining = to_money(left - value)
    pending = _pending(db, row.id)
    excess = to_money(sum((Decimal(str(p.amount)) for p in pending), ZERO) - remaining)
    for p in reversed(pending):
        if excess <= 0:
            break
        cut = min(Decimal(str(p.amount)), excess)
        p.amount = to_money(Decimal(str(p.amount)) - cut)
        excess = to_money(excess - cut)
        if p.amount <= 0:
            db.delete(p)
    if remaining <= 0:
        row.status = AdvanceStatus.settled
    db.flush()
    audit_service.record(db, action="advance.repay", actor_user_id=actor_user_id,
                         entity_type="employee_advance", entity_id=row.id,
                         after={"amount": str(value), "voucher_id": voucher.id,
                                "remaining": str(remaining)})
    return row


def cancel_repayment(db: Session, *, instalment_id: int, actor_user_id: int) -> EmployeeAdvance:
    from src.services import voucher_service

    part = db.get(EmployeeAdvanceInstalment, instalment_id)
    if part is None or part.voucher_id is None:
        raise AdvanceError("التحصيل غير موجود.")
    row = db.get(EmployeeAdvance, part.advance_id)
    try:
        voucher_service.reverse_voucher(db, voucher_id=part.voucher_id, actor_user_id=actor_user_id)
    except voucher_service.VoucherError as exc:
        raise AdvanceError(str(exc)) from exc
    amount = str(part.amount)
    db.delete(part)
    if row.status == AdvanceStatus.settled:
        row.status = AdvanceStatus.active
    db.flush()
    audit_service.record(db, action="advance.repay_cancel", actor_user_id=actor_user_id,
                         entity_type="employee_advance", entity_id=row.id,
                         after={"amount": amount})
    return row


def outstanding_of(db: Session, advance: EmployeeAdvance) -> Decimal:
    return to_money(Decimal(str(advance.amount)) - taken_of(db, advance.id))


def cancel_advance(db: Session, *, advance_id: int, actor_user_id: int) -> EmployeeAdvance:
    row = db.get(EmployeeAdvance, advance_id)
    if row is None:
        raise AdvanceError("السلفة غير موجودة.")
    if row.status == AdvanceStatus.cancelled:
        return row
    taken = taken_of(db, advance_id)
    if taken > 0:
        raise AdvanceError(
            f"اتسدد منها {taken} (من المرتب أو تحصيل نقدي) — ألغِ التحصيل أو اعكس المسير أولاً."
        )

    _undo_disbursement(db, row, actor_user_id)
    for part in db.scalars(select(EmployeeAdvanceInstalment).where(
            EmployeeAdvanceInstalment.advance_id == advance_id)).all():
        db.delete(part)
    row.status = AdvanceStatus.cancelled
    db.flush()
    audit_service.record(
        db, action="advance.cancel", actor_user_id=actor_user_id,
        entity_type="employee_advance", entity_id=row.id, after={"status": "cancelled"},
    )
    return row


def update_advance(
    db: Session, *, advance_id: int, actor_user_id: int, amount, advance_date: date,
    instalments: int = 1, start_year: int | None = None, start_month: int | None = None,
    reason: str | None = None, treasury_id: int | None = None,
    cost_center_id: int | None = None, plan: list[dict] | None = None, actor_role=None,
) -> EmployeeAdvance:
    row = db.get(EmployeeAdvance, advance_id)
    if row is None:
        raise AdvanceError("السلفة غير موجودة.")
    if row.status != AdvanceStatus.active:
        raise AdvanceError("هذه السلفة غير مفتوحة — لا يمكن تعديل الملغاة والمسدّدة.")
    taken = taken_of(db, advance_id)
    if taken > 0:
        raise AdvanceError(f"اتسدد منها {taken} — عدّل خطة السداد بدل تعديل السلفة.")
    value = to_money(Decimal(str(amount or 0)))
    if value <= 0:
        raise AdvanceError("يجب أن يكون مبلغ السلفة أكبر من صفر.")
    year = start_year or advance_date.year
    month = start_month or advance_date.month
    if not 1 <= month <= 12:
        raise AdvanceError("يجب أن يكون الشهر من 1 إلى 12.")
    before = {"amount": str(row.amount), "instalments": row.instalments,
              "advance_date": str(row.advance_date)}
    rows = _plan_rows(value, plan, max(instalments, 1), year, month)
    for part in db.scalars(select(EmployeeAdvanceInstalment).where(
            EmployeeAdvanceInstalment.advance_id == advance_id)).all():
        db.delete(part)
    db.flush()
    disbursed = bool(row.voucher_id or row.ledger_entry_id)
    money_changed = (value != to_money(Decimal(str(row.amount))) or advance_date != row.advance_date
                     or (treasury_id is not None and treasury_id != row.treasury_id))
    if disbursed and money_changed:
        _undo_disbursement(db, row, actor_user_id)
        row.voucher_id = row.ledger_entry_id = row.reversal_entry_id = None
    row.amount, row.advance_date = value, advance_date
    row.start_year, row.start_month = year, month
    row.reason, row.cost_center_id = reason, cost_center_id
    _write_plan(db, row, rows)
    if disbursed and money_changed:
        emp = db.get(Employee, row.employee_id)
        _disburse(db, row, emp, value=value, advance_date=advance_date,
                  treasury_id=treasury_id if treasury_id is not None else row.treasury_id,
                  actor_user_id=actor_user_id, actor_role=actor_role,
                  cost_center_id=cost_center_id, reason=reason)
    db.flush()
    audit_service.record(
        db, action="advance.update", actor_user_id=actor_user_id,
        entity_type="employee_advance", entity_id=row.id, before=before,
        after={"amount": str(value), "instalments": row.instalments,
               "advance_date": str(advance_date)},
    )
    return row


def due_in(db: Session, *, employee_id: int, year: int, month: int) -> list:
    return db.scalars(
        select(EmployeeAdvanceInstalment)
        .join(EmployeeAdvance, EmployeeAdvance.id == EmployeeAdvanceInstalment.advance_id)
        .where(EmployeeAdvance.employee_id == employee_id,
               EmployeeAdvance.status == AdvanceStatus.active,
               EmployeeAdvanceInstalment.year == year,
               EmployeeAdvanceInstalment.month == month,
               EmployeeAdvanceInstalment.payroll_line_id.is_(None),
               EmployeeAdvanceInstalment.voucher_id.is_(None))
    ).all()


def create_adjustment(
    db: Session,
    *,
    employee_id: int,
    kind: AdjustmentKind,
    year: int,
    month: int,
    actor_user_id: int,
    basis: AdjustmentBasis = AdjustmentBasis.amount,
    quantity=None,
    amount=0,
    reason: str | None = None,
) -> PayrollAdjustment:
    if db.get(Employee, employee_id) is None:
        raise AdvanceError("الموظف غير موجود.")
    if not 1 <= month <= 12:
        raise AdvanceError("يجب أن يكون الشهر من 1 إلى 12.")

    value = to_money(Decimal(str(amount or 0)))
    qty = Decimal(str(quantity or 0))
    if basis == AdjustmentBasis.amount and value <= ZERO:
        raise AdvanceError("يجب أن يكون المبلغ أكبر من صفر.")
    if basis != AdjustmentBasis.amount and qty <= 0:
        raise AdvanceError("يجب أن يكون العدد أكبر من صفر.")

    row = PayrollAdjustment(
        document_number=numbering.next_document_number(db, PayrollAdjustment, "ADJ"),
        employee_id=employee_id, kind=kind, basis=basis,
        quantity=qty if basis != AdjustmentBasis.amount else None,
        amount=value, year=year, month=month, reason=reason,
        actor_user_id=actor_user_id, approved_by_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    audit_service.record(
        db, action="adjustment.create", actor_user_id=actor_user_id,
        entity_type="payroll_adjustment", entity_id=row.id,
        after={"employee_id": employee_id, "kind": kind.value,
               "period": f"{year}-{month:02d}"},
    )
    return row


def cancel_adjustment(db: Session, *, adjustment_id: int, actor_user_id: int):
    row = db.get(PayrollAdjustment, adjustment_id)
    if row is None:
        raise AdvanceError("الجزاء غير موجود.")
    if row.payroll_line_id is not None:
        raise AdvanceError("حُسب في مسير مُرحّل — اعكس المسير أولاً.")
    row.status = AdjustmentStatus.cancelled
    db.flush()
    audit_service.record(
        db, action="adjustment.cancel", actor_user_id=actor_user_id,
        entity_type="payroll_adjustment", entity_id=row.id, after={"status": "cancelled"},
    )
    return row


def adjustments_in(db: Session, *, employee_id: int, year: int, month: int) -> list:
    return db.scalars(
        select(PayrollAdjustment)
        .where(PayrollAdjustment.employee_id == employee_id,
               PayrollAdjustment.year == year,
               PayrollAdjustment.month == month,
               PayrollAdjustment.status == AdjustmentStatus.approved,
               PayrollAdjustment.payroll_line_id.is_(None))
    ).all()
