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
) -> EmployeeAdvance:
    if db.get(Employee, employee_id) is None:
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
        cash_account_id, row.treasury_id = _cash_side(db, treasury_id=treasury_id,
                                                      branch_id=branch_id)
        entry = ledger_service.post_entry(
            db, entry_type="employee_advance", actor_user_id=actor_user_id,
            entry_date=advance_date, branch_id=branch_id,
            description=f"سلفة {row.document_number}",
            partner_kind=PartnerKind.employee, partner_id=employee_id,
            lines=[
                LineInput(advances_account_id(db), Direction.debit, value,
                          statement=f"سلفة {row.document_number}",
                          cost_center_id=cost_center_id),
                LineInput(cash_account_id, Direction.credit, value,
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
    total = db.scalar(
        select(func.coalesce(func.sum(EmployeeAdvanceInstalment.amount), 0))
        .where(EmployeeAdvanceInstalment.advance_id == advance_id,
               EmployeeAdvanceInstalment.payroll_line_id.is_not(None))
    ) or 0
    return to_money(Decimal(str(total)))


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
            f"خُصم منها {taken} في مسير مُرحّل — اعكس المسير أولاً."
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


def update_advance(
    db: Session, *, advance_id: int, actor_user_id: int, amount, advance_date: date,
    instalments: int = 1, start_year: int | None = None, start_month: int | None = None,
    reason: str | None = None, treasury_id: int | None = None,
    cost_center_id: int | None = None,
) -> EmployeeAdvance:
    row = db.get(EmployeeAdvance, advance_id)
    if row is None:
        raise AdvanceError("السلفة غير موجودة.")
    if row.status != AdvanceStatus.active:
        raise AdvanceError("هذه السلفة غير مفتوحة — لا يمكن تعديل الملغاة والمسدّدة.")
    taken = taken_of(db, advance_id)
    if taken > 0:
        raise AdvanceError(f"خُصم منها {taken} في مسير مُرحّل — اعكس المسير أولاً.")
    value = to_money(Decimal(str(amount or 0)))
    if value <= 0:
        raise AdvanceError("يجب أن يكون مبلغ السلفة أكبر من صفر.")
    if instalments < 1:
        raise AdvanceError("يجب ألا يقل عدد الأقساط عن واحد.")
    year = start_year or advance_date.year
    month = start_month or advance_date.month
    if not 1 <= month <= 12:
        raise AdvanceError("يجب أن يكون الشهر من 1 إلى 12.")
    before = {"amount": str(row.amount), "instalments": row.instalments,
              "advance_date": str(row.advance_date)}

    parts = _split(value, instalments)
    for part in db.scalars(select(EmployeeAdvanceInstalment).where(
            EmployeeAdvanceInstalment.advance_id == advance_id)).all():
        db.delete(part)
    db.flush()
    row.amount, row.advance_date, row.instalments = value, advance_date, instalments
    row.instalment_amount, row.start_year, row.start_month = parts[0], year, month
    row.reason, row.cost_center_id = reason, cost_center_id
    cursor_year, cursor_month = year, month
    for part in parts:
        db.add(EmployeeAdvanceInstalment(
            advance_id=row.id, year=cursor_year, month=cursor_month, amount=part))
        cursor_month += 1
        if cursor_month > 12:
            cursor_month, cursor_year = 1, cursor_year + 1

    if row.ledger_entry_id:
        cash_account_id, row.treasury_id = _cash_side(
            db, treasury_id=treasury_id if treasury_id is not None else row.treasury_id,
            branch_id=row.branch_id)
        entry = ledger_service.reset_to_draft(
            db, entry_id=row.ledger_entry_id, actor_user_id=actor_user_id)
        entry.entry_date = advance_date
        ledger_service.replace_lines(db, entry=entry, lines=[
            LineInput(advances_account_id(db), Direction.debit, value,
                      statement=f"سلفة {row.document_number}", cost_center_id=cost_center_id),
            LineInput(cash_account_id, Direction.credit, value,
                      statement=f"سلفة {row.document_number}"),
        ])
        ledger_service.post_draft(db, entry_id=entry.id, actor_user_id=actor_user_id)
    elif treasury_id is not None:
        row.treasury_id = treasury_id
    db.flush()
    audit_service.record(
        db, action="advance.update", actor_user_id=actor_user_id,
        entity_type="employee_advance", entity_id=row.id, before=before,
        after={"amount": str(value), "instalments": instalments,
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
               EmployeeAdvanceInstalment.payroll_line_id.is_(None))
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
