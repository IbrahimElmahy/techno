from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.employee import Employee
from src.models.hr_advance import AdvanceStatus, EmployeeAdvance
from src.models.hr_attendance import AttendanceDay
from src.models.hr_payroll_run import (
    PayrollLine,
    PayrollRemittance,
    PayrollRun,
    PayrollRunStatus,
)
from src.models.ledger import AccountNature, Direction
from src.services import (
    advance_service,
    audit_service,
    ledger_service,
    numbering,
)
from src.services.ledger_service import LineInput

_LIABILITY_GROUP = ("2.02", "التزامات العاملين", AccountNature.liability, None, "2")
_ACCOUNTS = {
    "salary_expense": ("5.10.002", "رواتب", AccountNature.expense, Direction.debit, "5"),
    "employer_insurance": ("5.10.005", "حصة الشركة في التأمينات الاجتماعية",
                           AccountNature.expense, Direction.debit, "5"),
    "salaries_payable": ("2.02.001", "مرتبات مستحقة الدفع",
                         AccountNature.liability, Direction.credit, "2.02"),
    "insurance_payable": ("2.02.002", "تأمينات اجتماعية مستحقة",
                          AccountNature.liability, Direction.credit, "2.02"),
    "penalties_fund": ("2.02.004", "حصيلة الجزاءات",
                       AccountNature.liability, Direction.credit, "2.02"),
}


class PayrollError(Exception):
    pass


def _account(db: Session, code, name, nature, side, parent_code):
    from src.models.ledger import Account, AccountType

    acc = db.scalar(select(Account).where(Account.code == code))
    if acc is not None:
        return acc
    parent = db.scalar(select(Account).where(Account.code == parent_code)) if parent_code else None
    acc = Account(
        account_type=AccountType.user_defined, normal_side=side or Direction.credit,
        code=code, name=name, nature=nature,
        is_postable=side is not None, is_system=True,
        parent_id=parent.id if parent else None,
    )
    db.add(acc)
    db.flush()
    return acc


def accounts(db: Session) -> dict:
    _account(db, *_LIABILITY_GROUP)
    return {key: _account(db, *spec) for key, spec in _ACCOUNTS.items()}


def _period_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def _cost_center_of(db: Session, employee: Employee) -> int | None:
    from src.models.hr_org import Department

    if employee.department_id is None:
        return None
    dept = db.get(Department, employee.department_id)
    return dept.cost_center_id if dept else None


def post_run(db: Session, *, run_id: int, actor_user_id: int) -> dict:
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise PayrollError("المسير غير موجود.")
    if run.status == PayrollRunStatus.posted:
        return {"skipped": True, "run_id": run.id, "total": "0.00",
                "ledger_entry_id": run.accrual_entry_id}
    if run.status == PayrollRunStatus.reversed:
        raise PayrollError("هذا المسير معكوس — أنشئ حساباً جديداً للشهر.")

    lines = db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all()
    if not lines:
        raise PayrollError("لا توجد سطور في المسير — أجرِ الحساب أولاً.")

    acc = accounts(db)
    period_end = _period_end(run.year, run.month)
    entry_lines: list[LineInput] = []

    by_centre: dict[int | None, Decimal] = {}
    for line in lines:
        earned = to_money(Decimal(str(line.gross)))
        if earned:
            by_centre[line.cost_center_id] = to_money(
                by_centre.get(line.cost_center_id, ZERO) + earned)
    for centre, amount in by_centre.items():
        entry_lines.append(LineInput(
            acc["salary_expense"].id, Direction.debit, amount,
            statement=f"مرتبات {run.year}-{run.month:02d}", cost_center_id=centre))

    def total(field: str) -> Decimal:
        return to_money(sum((Decimal(str(getattr(x, field))) for x in lines), ZERO))

    employer = total("insurance_employer")
    employee_ins = total("insurance_employee")
    advances = total("advance_deduction")
    penalties = total("penalty_amount")
    net = total("net")

    if employer:
        entry_lines.append(LineInput(acc["employer_insurance"].id, Direction.debit, employer,
                                     statement="حصة الشركة في التأمينات"))
    if net:
        entry_lines.append(LineInput(acc["salaries_payable"].id, Direction.credit, net,
                                     statement="صافي المرتبات"))
    if employee_ins + employer:
        entry_lines.append(LineInput(acc["insurance_payable"].id, Direction.credit,
                                     to_money(employee_ins + employer),
                                     statement="تأمينات مستحقة"))
    if penalties:
        entry_lines.append(LineInput(acc["penalties_fund"].id, Direction.credit, penalties,
                                     statement="حصيلة الجزاءات"))
    if advances:
        entry_lines.append(LineInput(advance_service.advances_account_id(db),
                                     Direction.credit, advances,
                                     statement="أقساط سلف"))

    entry = ledger_service.post_entry(
        db, entry_type="payroll_accrual", actor_user_id=actor_user_id,
        entry_date=period_end, branch_id=run.branch_id,
        description=f"مرتبات {run.year}-{run.month:02d}", lines=entry_lines,
    )
    run.accrual_entry_id = entry.id
    run.status = PayrollRunStatus.posted
    run.posted_at = datetime.now()
    run.posted_by_user_id = actor_user_id

    _consume(db, run, lines)
    _lock_attendance(db, run)
    db.flush()

    audit_service.record(
        db, action="payroll.post", actor_user_id=actor_user_id,
        entity_type="payroll_run", entity_id=run.id,
        after={"period": f"{run.year}-{run.month:02d}", "employees": len(lines),
               "net": str(net), "ledger_entry_id": entry.id},
    )
    return {"skipped": False, "run_id": run.id, "employees": len(lines),
            "total": str(net), "ledger_entry_id": entry.id}


def _consume(db: Session, run: PayrollRun, lines) -> None:
    from src.models.hr_advance import EmployeeAdvanceInstalment, PayrollAdjustment

    for line in lines:
        for part in advance_service.due_in(
                db, employee_id=line.employee_id, year=run.year, month=run.month):
            part.payroll_line_id = line.id
        for row in advance_service.adjustments_in(
                db, employee_id=line.employee_id, year=run.year, month=run.month):
            row.payroll_line_id = line.id
    db.flush()

    for advance in db.scalars(select(EmployeeAdvance).where(
            EmployeeAdvance.status == AdvanceStatus.active)).all():
        if advance_service.outstanding_of(db, advance) <= ZERO:
            advance.status = AdvanceStatus.settled
    db.flush()
    _ = PayrollAdjustment, EmployeeAdvanceInstalment


def _lock_attendance(db: Session, run: PayrollRun) -> None:
    first, last = date(run.year, run.month, 1), _period_end(run.year, run.month)
    employee_ids = [line.employee_id for line in
                    db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all()]
    if not employee_ids:
        return
    for day in db.scalars(select(AttendanceDay).where(
            AttendanceDay.employee_id.in_(employee_ids),
            AttendanceDay.work_date >= first, AttendanceDay.work_date <= last)).all():
        day.locked_by_payroll_run_id = run.id
    db.flush()


def reverse_run(db: Session, *, run_id: int, actor_user_id: int) -> dict:
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise PayrollError("المسير غير موجود.")
    if run.status != PayrollRunStatus.posted:
        raise PayrollError("هذا المسير غير مُرحّل.")

    paid = db.scalar(select(func.count()).select_from(PayrollLine).where(
        PayrollLine.run_id == run.id, PayrollLine.paid.is_(True))) or 0
    if paid:
        raise PayrollError(f"يوجد {paid} مرتب مصروف من هذا المسير — اعكس الصرف أولاً.")

    reversal = ledger_service.reverse_entry(
        db, original_id=run.accrual_entry_id, actor_user_id=actor_user_id)
    run.reversal_entry_id = reversal.id
    run.status = PayrollRunStatus.reversed

    for line in db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all():
        _release(db, line.id)
    for day in db.scalars(select(AttendanceDay).where(
            AttendanceDay.locked_by_payroll_run_id == run.id)).all():
        day.locked_by_payroll_run_id = None
    db.flush()

    audit_service.record(
        db, action="payroll.reverse", actor_user_id=actor_user_id,
        entity_type="payroll_run", entity_id=run.id,
        after={"period": f"{run.year}-{run.month:02d}", "reversal_entry_id": reversal.id},
    )
    return {"run_id": run.id, "reversal_entry_id": reversal.id}


def _release(db: Session, line_id: int) -> None:
    from src.models.hr_advance import EmployeeAdvanceInstalment, PayrollAdjustment

    for part in db.scalars(select(EmployeeAdvanceInstalment).where(
            EmployeeAdvanceInstalment.payroll_line_id == line_id)).all():
        part.payroll_line_id = None
        advance = db.get(EmployeeAdvance, part.advance_id)
        if advance is not None and advance.status == AdvanceStatus.settled:
            advance.status = AdvanceStatus.active
    for row in db.scalars(select(PayrollAdjustment).where(
            PayrollAdjustment.payroll_line_id == line_id)).all():
        row.payroll_line_id = None


def _cash_side(db: Session, treasury_id: int | None, branch_id: int | None):
    try:
        return advance_service._cash_side(db, treasury_id=treasury_id, branch_id=branch_id)
    except advance_service.AdvanceError as exc:
        raise PayrollError(str(exc)) from exc


def pay_run(
    db: Session, *, run_id: int, actor_user_id: int, treasury_id: int | None = None,
    pay_date: date | None = None,
) -> dict:
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise PayrollError("المسير غير موجود.")
    if run.status != PayrollRunStatus.posted:
        raise PayrollError("يجب ترحيل المسير أولاً.")

    lines = db.scalars(select(PayrollLine).where(
        PayrollLine.run_id == run.id, PayrollLine.paid.is_(False))).all()
    if not lines:
        return {"skipped": True, "paid": 0, "total": "0.00"}

    total = to_money(sum((Decimal(str(x.net)) for x in lines), ZERO))
    if total <= ZERO:
        raise PayrollError("لا يوجد صافٍ مستحق للصرف.")

    acc = accounts(db)
    cash_account_id, _ = _cash_side(db, treasury_id, run.branch_id)
    entry = ledger_service.post_entry(
        db, entry_type="payroll_payment", actor_user_id=actor_user_id,
        entry_date=pay_date or date.today(), branch_id=run.branch_id,
        description=f"صرف مرتبات {run.year}-{run.month:02d}",
        lines=[
            LineInput(acc["salaries_payable"].id, Direction.debit, total,
                      statement=f"صرف مرتبات {run.year}-{run.month:02d}"),
            LineInput(cash_account_id, Direction.credit, total,
                      statement=f"صرف مرتبات {run.year}-{run.month:02d}"),
        ],
    )
    for line in lines:
        line.paid = True
        line.payment_entry_id = entry.id
        line.paid_at = datetime.now()
    db.flush()
    audit_service.record(
        db, action="payroll.pay", actor_user_id=actor_user_id,
        entity_type="payroll_run", entity_id=run.id,
        after={"paid": len(lines), "total": str(total), "ledger_entry_id": entry.id},
    )
    return {"skipped": False, "paid": len(lines), "total": str(total),
            "ledger_entry_id": entry.id}


def remit(
    db: Session, *, kind: str, amount, remit_date: date, actor_user_id: int,
    branch_id: int | None = None, notes: str | None = None, treasury_id: int | None = None,
) -> PayrollRemittance:
    if kind != "insurance":
        raise PayrollError("يجب أن يكون النوع insurance.")
    value = to_money(Decimal(str(amount or 0)))
    if value <= ZERO:
        raise PayrollError("يجب أن يكون المبلغ أكبر من صفر.")

    acc = accounts(db)
    liability = acc["insurance_payable"]
    cash_account_id, treasury_id = _cash_side(db, treasury_id, branch_id)
    label = "تأمينات اجتماعية"

    entry = ledger_service.post_entry(
        db, entry_type="payroll_remittance", actor_user_id=actor_user_id,
        entry_date=remit_date, branch_id=branch_id, description=f"سداد {label}",
        lines=[
            LineInput(liability.id, Direction.debit, value, statement=f"سداد {label}"),
            LineInput(cash_account_id, Direction.credit, value, statement=f"سداد {label}"),
        ],
    )
    row = PayrollRemittance(
        document_number=numbering.next_document_number(db, PayrollRemittance, "RMT"),
        kind=kind, amount=value, remit_date=remit_date, branch_id=branch_id,
        treasury_id=treasury_id,
        ledger_entry_id=entry.id, notes=notes, actor_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    audit_service.record(
        db, action="payroll.remit", actor_user_id=actor_user_id,
        entity_type="payroll_remittance", entity_id=row.id,
        after={"kind": kind, "amount": str(value)},
    )
    return row


def update_remittance(
    db: Session, *, remittance_id: int, actor_user_id: int, amount=None,
    remit_date: date | None = None, treasury_id: int | None = None, notes: str | None = None,
) -> PayrollRemittance:
    row = db.get(PayrollRemittance, remittance_id)
    if row is None:
        raise PayrollError("السداد غير موجود.")
    value = to_money(Decimal(str(amount if amount not in (None, "") else row.amount)))
    if value <= ZERO:
        raise PayrollError("يجب أن يكون المبلغ أكبر من صفر.")
    before = {"amount": str(row.amount), "remit_date": str(row.remit_date),
              "treasury_id": row.treasury_id}
    if row.ledger_entry_id:
        ledger_service.reverse_entry(db, original_id=row.ledger_entry_id,
                                     actor_user_id=actor_user_id)
    acc = accounts(db)
    cash_account_id, treasury_id = _cash_side(db, treasury_id, row.branch_id)
    when = remit_date or row.remit_date
    entry = ledger_service.post_entry(
        db, entry_type="payroll_remittance", actor_user_id=actor_user_id,
        entry_date=when, branch_id=row.branch_id, description="سداد تأمينات اجتماعية",
        lines=[
            LineInput(acc["insurance_payable"].id, Direction.debit, value,
                      statement="سداد تأمينات اجتماعية"),
            LineInput(cash_account_id, Direction.credit, value,
                      statement="سداد تأمينات اجتماعية"),
        ],
    )
    row.amount = value
    row.remit_date = when
    row.treasury_id = treasury_id
    row.notes = (notes or "").strip()[:300] or None
    row.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(
        db, action="payroll.remit_update", actor_user_id=actor_user_id,
        entity_type="payroll_remittance", entity_id=row.id, before=before,
        after={"amount": str(value), "remit_date": str(when), "treasury_id": treasury_id},
    )
    return row


def delete_remittance(db: Session, *, remittance_id: int, actor_user_id: int) -> None:
    row = db.get(PayrollRemittance, remittance_id)
    if row is None:
        raise PayrollError("السداد غير موجود.")
    if row.ledger_entry_id:
        ledger_service.reverse_entry(db, original_id=row.ledger_entry_id,
                                     actor_user_id=actor_user_id)
    before = {"document_number": row.document_number, "amount": str(row.amount)}
    db.delete(row)
    db.flush()
    audit_service.record(
        db, action="payroll.remit_delete", actor_user_id=actor_user_id,
        entity_type="payroll_remittance", entity_id=remittance_id, before=before,
    )
