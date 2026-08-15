"""السلف والجزاءات (HR-5).

**السلفة أصل، مش مصروف.** The disbursement posts DR «سلف العاملين» / CR الخزنة. Booking it as an
expense is the most common payroll-accounting mistake there is — the money leaves the safe so it
looks like a cost, but the employee owes it back and the salary that repays it is booked as a cost
too. The same pound would be carried twice.

**والمتبقي مشتق.** `amount − Σ(instalments already taken)`. A stored «متبقي» column drifts the
first time a payroll run is reversed, and then the advance disagrees with the payslips that fed it.
Same rule as the leave balance.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
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
from src.models.ledger import AccountNature, Direction
from src.services import account_resolver, audit_service, ledger_service, numbering
from src.services.ledger_service import LineInput

# حساب سلف العاملين — أصل تحت الذمم المدينة، مش مصروف.
_ADVANCE_ACCOUNT = ("1.02.010", "سلف العاملين", AccountNature.asset, Direction.debit, "1.02")


class AdvanceError(Exception):
    """السلفة أو الجزاء مايتعملوش زي ما هما مكتوبين."""


def _get_or_create_account(db: Session):
    """نفس نمط الأصول الثابتة: الحساب بيتعمل عند أول استعمال، بالكود."""
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


# ------------------------------------------------------------------ السلف


def _split(amount: Decimal, count: int) -> list[Decimal]:
    """بيقسّم المبلغ على الأقساط، والباقي بيروح لآخر قسط.

    1000 over 3 is 333.33 three times and a lost penny. The remainder lands on the LAST instalment
    so the total is exactly what was borrowed — an advance that repays 999.99 of a 1000 stays open
    forever over one piastre.
    """
    if count <= 0:
        raise AdvanceError("عدد الأقساط لازم يكون واحد على الأقل.")
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
) -> EmployeeAdvance:
    """بيسجّل السلفة وبيصرفها — مدين سلف العاملين / دائن الخزنة."""
    if db.get(Employee, employee_id) is None:
        raise AdvanceError("الموظف غير موجود.")
    value = to_money(Decimal(str(amount or 0)))
    if value <= 0:
        raise AdvanceError("مبلغ السلفة لازم يكون أكبر من صفر.")
    if instalments < 1:
        raise AdvanceError("عدد الأقساط لازم يكون واحد على الأقل.")

    year = start_year or advance_date.year
    month = start_month or advance_date.month
    if not 1 <= month <= 12:
        raise AdvanceError("الشهر لازم يكون من 1 لـ 12.")

    parts = _split(value, instalments)
    row = EmployeeAdvance(
        document_number=numbering.next_document_number(db, EmployeeAdvance, "ADV"),
        employee_id=employee_id, advance_date=advance_date, amount=value,
        instalments=instalments, instalment_amount=parts[0],
        start_year=year, start_month=month, reason=reason,
        treasury_id=treasury_id, branch_id=branch_id, cost_center_id=cost_center_id,
        actor_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()

    # جدول الأقساط بيتعمل كامل من دلوقتي — «هيتخصم مني كام الشهر الجاي» سؤال بيتسأل ساعة
    # الاستلاف، مش بعد ما المسير يترحّل.
    cursor_year, cursor_month = year, month
    for part in parts:
        db.add(EmployeeAdvanceInstalment(
            advance_id=row.id, year=cursor_year, month=cursor_month, amount=part))
        cursor_month += 1
        if cursor_month > 12:
            cursor_month = 1
            cursor_year += 1
    db.flush()

    if post:
        treasury_account = account_resolver.treasury_account(db, branch_id=branch_id)
        entry = ledger_service.post_entry(
            db, entry_type="employee_advance", actor_user_id=actor_user_id,
            entry_date=advance_date, branch_id=branch_id,
            description=f"سلفة {row.document_number}",
            lines=[
                # أصل: الموظف مديون بيها. لو اتقيدت مصروف، المرتب اللي هيسددها هيتقيد مصروف
                # كمان والشركة هتتحمّل نفس الجنيه مرتين.
                LineInput(advances_account_id(db), Direction.debit, value,
                          statement=f"سلفة {row.document_number}",
                          cost_center_id=cost_center_id),
                LineInput(treasury_account.id, Direction.credit, value,
                          statement=f"سلفة {row.document_number}"),
            ],
        )
        row.ledger_entry_id = entry.id
        db.flush()

    audit_service.record(
        db, action="advance.create", actor_user_id=actor_user_id,
        entity_type="employee_advance", entity_id=row.id,
        after={"employee_id": employee_id, "amount": str(value),
               "instalments": instalments},
    )
    return row


def taken_of(db: Session, advance_id: int) -> Decimal:
    """اللي اتخصم فعلاً — الأقساط اللي اتربطت بسطر مسير."""
    total = db.scalar(
        select(func.coalesce(func.sum(EmployeeAdvanceInstalment.amount), 0))
        .where(EmployeeAdvanceInstalment.advance_id == advance_id,
               EmployeeAdvanceInstalment.payroll_line_id.is_not(None))
    ) or 0
    return to_money(Decimal(str(total)))


def outstanding_of(db: Session, advance: EmployeeAdvance) -> Decimal:
    return to_money(Decimal(str(advance.amount)) - taken_of(db, advance.id))


def cancel_advance(db: Session, *, advance_id: int, actor_user_id: int) -> EmployeeAdvance:
    """بيلغي السلفة ويعكس قيد صرفها — لو مااتخصمش منها حاجة."""
    row = db.get(EmployeeAdvance, advance_id)
    if row is None:
        raise AdvanceError("السلفة غير موجودة.")
    if row.status == AdvanceStatus.cancelled:
        return row
    taken = taken_of(db, advance_id)
    if taken > 0:
        raise AdvanceError(
            f"اتخصم منها {taken} في مسير مرحّل — اعكس المسير الأول."
        )

    if row.ledger_entry_id:
        reversal = ledger_service.reverse_entry(
            db, original_id=row.ledger_entry_id, actor_user_id=actor_user_id)
        row.reversal_entry_id = reversal.id
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


def due_in(db: Session, *, employee_id: int, year: int, month: int) -> list:
    """أقساط الشهر ده اللي لسه مااتخصمتش — اللي المسير بيقراه."""
    return db.scalars(
        select(EmployeeAdvanceInstalment)
        .join(EmployeeAdvance, EmployeeAdvance.id == EmployeeAdvanceInstalment.advance_id)
        .where(EmployeeAdvance.employee_id == employee_id,
               EmployeeAdvance.status == AdvanceStatus.active,
               EmployeeAdvanceInstalment.year == year,
               EmployeeAdvanceInstalment.month == month,
               EmployeeAdvanceInstalment.payroll_line_id.is_(None))
    ).all()


# ------------------------------------------------------------------ الجزاءات


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
        raise AdvanceError("الشهر لازم يكون من 1 لـ 12.")

    value = to_money(Decimal(str(amount or 0)))
    qty = Decimal(str(quantity or 0))
    if basis == AdjustmentBasis.amount and value <= ZERO:
        raise AdvanceError("المبلغ لازم يكون أكبر من صفر.")
    if basis != AdjustmentBasis.amount and qty <= 0:
        raise AdvanceError("العدد لازم يكون أكبر من صفر.")

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
        raise AdvanceError("اتحسب في مسير مرحّل — اعكس المسير الأول.")
    row.status = AdjustmentStatus.cancelled
    db.flush()
    audit_service.record(
        db, action="adjustment.cancel", actor_user_id=actor_user_id,
        entity_type="payroll_adjustment", entity_id=row.id, after={"status": "cancelled"},
    )
    return row


def adjustments_in(db: Session, *, employee_id: int, year: int, month: int) -> list:
    """جزاءات ومكافآت الشهر اللي لسه مااتحسبتش."""
    return db.scalars(
        select(PayrollAdjustment)
        .where(PayrollAdjustment.employee_id == employee_id,
               PayrollAdjustment.year == year,
               PayrollAdjustment.month == month,
               PayrollAdjustment.status == AdjustmentStatus.approved,
               PayrollAdjustment.payroll_line_id.is_(None))
    ).all()
