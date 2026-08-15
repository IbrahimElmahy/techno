"""مسير الرواتب — الحساب والترحيل والصرف والعكس (HR-6).

Same shape as `fixed_asset_service.run_depreciation`, with one deliberate difference: that one
DELETES its period markers on reversal, which is right for a marker and wrong for a document. A
payroll run has a printed number and an employee is holding a payslip quoting it, so reversing
bumps `reversal_seq` and keeps the row.

**الحساب في مسودة، والترحيل فعل تاني.** A draft can be recomputed all day and touches nothing
financial. Posting is the act that writes to the ledger, and from that moment nothing on it can be
edited — the attendance days it read get locked, the advance instalments get consumed, and the tax
version it used gets frozen.

**والقيد:**

    مدين   ٥٫١٠٫٠٠٢  مصروف أجور ومرتبات      = المستحق (إجمالي − غياب − جزاءات)
    مدين   ٥٫١٠٫٠٠٥  حصة الشركة في التأمينات = حصة الشركة
           دائن  ٢٫٠٢٫٠٠١  مرتبات مستحقة            = الصافي
           دائن  ٢٫٠٢٫٠٠٢  تأمينات مستحقة            = حصة الموظف + حصة الشركة
           دائن  ٢٫٠٢٫٠٠٣  ضريبة كسب عمل مستحقة     = الضريبة
           دائن  ٢٫٠٢٫٠٠٤  حصيلة الجزاءات            = الجزاءات
           دائن  ١٫٠٢٫٠١٠  سلف العاملين              = أقساط السلف

الجزاء بيقفل على **التزام** مش إيراد: قانون العمل بيقول حصيلة الجزاءات تروح لصندوق رعاية العمال،
مش ربح للشركة. وبيتشال من المصروف كمان، لأن تكلفة الأجور الحقيقية للشركة أقل فعلاً.

الصرف: مدين مرتبات مستحقة / دائن الخزنة. `voucher_service.create_expense` مابتعرفش تعمله — هي
بتخصم على حساب مصروف وبترفض أي طبيعة تانية.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.lib import payroll_calc as calc
from src.models.employee import Employee
from src.models.hr_advance import AdjustmentBasis, AdjustmentKind, AdvanceStatus, EmployeeAdvance
from src.models.hr_attendance import AttendanceDay, AttendanceStatus
from src.models.hr_leave import LeaveType
from src.models.hr_payroll import AbsenceBasis, SchemeKind
from src.models.hr_payroll_run import (
    DetailKind,
    DetailSource,
    PayrollLine,
    PayrollLineDetail,
    PayrollRemittance,
    PayrollRun,
    PayrollRunStatus,
)
from src.models.ledger import AccountNature, Direction
from src.services import (
    account_resolver,
    advance_service,
    audit_service,
    ledger_service,
    numbering,
)
from src.services import payroll_setup_service as setup
from src.services.ledger_service import LineInput

ZERO_QTY = Decimal("0.000")

# حسابات المسير — بتتعمل عند أول ترحيل، بالكود، زي الأصول الثابتة.
_LIABILITY_GROUP = ("2.02", "التزامات العاملين", AccountNature.liability, None, "2")
_ACCOUNTS = {
    # حساب الرواتب موجود أصلاً في الشجرة القياسية — عمل تاني معناه سطرين في قائمة الدخل.
    "salary_expense": ("5.10.002", "رواتب", AccountNature.expense, Direction.debit, "5"),
    "employer_insurance": ("5.10.005", "حصة الشركة في التأمينات الاجتماعية",
                           AccountNature.expense, Direction.debit, "5"),
    "salaries_payable": ("2.02.001", "مرتبات مستحقة الدفع",
                         AccountNature.liability, Direction.credit, "2.02"),
    "insurance_payable": ("2.02.002", "تأمينات اجتماعية مستحقة",
                          AccountNature.liability, Direction.credit, "2.02"),
    "tax_payable": ("2.02.003", "ضريبة كسب العمل مستحقة",
                    AccountNature.liability, Direction.credit, "2.02"),
    "penalties_fund": ("2.02.004", "حصيلة الجزاءات",
                       AccountNature.liability, Direction.credit, "2.02"),
}


class PayrollError(Exception):
    """المسير مايتعملش زي ما هو مطلوب."""


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
    """حسابات المسير، بتتعمل عند أول استعمال."""
    _account(db, *_LIABILITY_GROUP)
    return {key: _account(db, *spec) for key, spec in _ACCOUNTS.items()}


def _period_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


# ------------------------------------------------------------------ الحساب


def compute_run(
    db: Session, *, year: int, month: int, actor_user_id: int, branch_id: int | None = None,
) -> PayrollRun:
    """بيعمل أو بيعيد حساب مسودة الشهر. مابيلمسش الأستاذ.

    Recomputing wipes the draft's lines and rebuilds them — a draft is uncommitted working state,
    not a document. The moment it is POSTED that stops being true.
    """
    if not 1 <= month <= 12:
        raise PayrollError("الشهر لازم يكون من 1 لـ 12.")
    period_end = _period_end(year, month)

    posted = db.scalar(select(PayrollRun).where(
        PayrollRun.year == year, PayrollRun.month == month,
        PayrollRun.branch_id.is_(branch_id) if branch_id is None
        else PayrollRun.branch_id == branch_id,
        PayrollRun.status == PayrollRunStatus.posted))
    if posted is not None:
        raise PayrollError(
            f"الشهر ده مرحّل بالفعل في المسير {posted.document_number} — اعكسه الأول."
        )

    run = db.scalar(select(PayrollRun).where(
        PayrollRun.year == year, PayrollRun.month == month,
        PayrollRun.branch_id.is_(branch_id) if branch_id is None
        else PayrollRun.branch_id == branch_id,
        PayrollRun.status == PayrollRunStatus.draft))
    if run is None:
        seq = db.scalar(select(func.coalesce(func.max(PayrollRun.reversal_seq), -1)).where(
            PayrollRun.year == year, PayrollRun.month == month,
            PayrollRun.branch_id.is_(branch_id) if branch_id is None
            else PayrollRun.branch_id == branch_id)) or -1
        run = PayrollRun(
            document_number=numbering.next_document_number(db, PayrollRun, "PR"),
            year=year, month=month, branch_id=branch_id, reversal_seq=seq + 1,
            actor_user_id=actor_user_id,
        )
        db.add(run)
        db.flush()
    else:
        for line in db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all():
            for detail in db.scalars(select(PayrollLineDetail).where(
                    PayrollLineDetail.line_id == line.id)).all():
                db.delete(detail)
            db.delete(line)
        db.flush()

    settings = setup.settings(db)
    tax_version = setup.version_on(db, SchemeKind.income_tax, period_end)
    ins_version = setup.version_on(db, SchemeKind.social_insurance, period_end)
    run.tax_version_id = tax_version.id if tax_version else None
    run.insurance_version_id = ins_version.id if ins_version else None

    stmt = select(Employee).where(Employee.active.is_(True))
    if branch_id is not None:
        stmt = stmt.where(Employee.branch_id == branch_id)
    employees = db.scalars(stmt).all()

    totals = {k: ZERO for k in (
        "earnings", "absence_deduction", "overtime", "bonuses", "penalties", "gross",
        "insurance_employee", "insurance_employer", "tax", "advances", "other_deductions",
        "total_deductions", "net")}

    for employee in employees:
        line = _compute_line(
            db, run=run, employee=employee, year=year, month=month,
            period_end=period_end, settings=settings,
            tax_version=tax_version, ins_version=ins_version,
        )
        if line is None:
            continue
        for key in totals:
            totals[key] = to_money(totals[key] + Decimal(str(getattr(line, _RUN_FIELD[key], 0))))

    for key, value in totals.items():
        setattr(run, key, value)
    db.flush()
    return run


# اسم الحقل على السطر اللي بيغذّي كل إجمالي على المسير.
_RUN_FIELD = {
    "earnings": "gross", "absence_deduction": "absence_deduction",
    "overtime": "overtime_amount", "bonuses": "bonus_amount",
    "penalties": "penalty_amount", "gross": "gross",
    "insurance_employee": "insurance_employee", "insurance_employer": "insurance_employer",
    "tax": "tax_amount", "advances": "advance_deduction",
    "other_deductions": "other_deductions", "total_deductions": "total_deductions",
    "net": "net",
}


def _compute_line(
    db: Session, *, run: PayrollRun, employee: Employee, year: int, month: int,
    period_end: date, settings, tax_version, ins_version,
) -> PayrollLine | None:
    salary = setup.salary_on(db, employee.id, period_end)
    if salary is None:
        # مافيش هيكل راتب ساري — الموظف اتعيّن بعد الشهر ده، أو محدش حطّله راتب.
        # سطر بصفر أوحش من مفيش سطر: بيقرا كإن الراجل مستحق صفر.
        return None

    breakdown = setup.salary_breakdown(db, salary)
    basic = Decimal(breakdown["basic"])
    gross_structure = Decimal(breakdown["gross"])
    days_in_month = settings.days_per_month or 30

    absence_base = basic if settings.absence_basis == AbsenceBasis.basic else gross_structure
    daily = calc.daily_rate(absence_base, days_in_month)
    hourly = calc.hourly_rate(absence_base, days_in_month, settings.hours_per_day)

    days = _attendance_of(db, employee.id, year, month)
    unpaid_types = {t.id for t in db.scalars(select(LeaveType).where(
        LeaveType.deducts_salary.is_(True))).all()}
    absent = Decimal(days["absent"]) + Decimal(days["unpaid_leave"] if unpaid_types else 0)
    absence_amount = calc.absence_deduction(days_absent=absent, daily=daily)
    overtime_amount = calc.overtime_amount(
        hours_normal=days["overtime_hours"], hourly=hourly,
        normal_pct=settings.overtime_normal_pct, holiday_pct=settings.overtime_holiday_pct)

    bonus, penalty, adjustments = _adjustments_of(db, employee.id, year, month, daily, hourly)
    instalments = advance_service.due_in(db, employee_id=employee.id, year=year, month=month)
    advance_total = to_money(sum((Decimal(str(p.amount)) for p in instalments), ZERO))

    gross = to_money(gross_structure + overtime_amount + bonus - absence_amount - penalty)

    insurance_base = to_money(Decimal(breakdown["insurance_base"]))
    ins_employee = ins_employer = ZERO
    if ins_version is not None:
        ins_employee, ins_employer = calc.insurance_for(
            insurance_base,
            employee_pct=ins_version.employee_pct or 0,
            employer_pct=ins_version.employer_pct or 0,
            min_base=ins_version.min_base, max_base=ins_version.max_base,
        )

    # وعاء الضريبة بعد التأمينات — حصة الموظف مخصومة قانوناً قبل الضريبة.
    taxable_monthly = to_money(
        Decimal(breakdown["taxable_base"]) + overtime_amount + bonus
        - absence_amount - penalty - ins_employee)
    tax_amount = ZERO
    if tax_version is not None:
        brackets = setup.brackets_of(db, tax_version.id)
        if tax_version.annualise:
            annual = calc.tax_for(taxable_monthly * 12, brackets,
                                  exemption=tax_version.annual_exemption or 0)
            tax_amount = to_money(annual / 12)
        else:
            tax_amount = calc.tax_for(taxable_monthly, brackets,
                                      exemption=tax_version.annual_exemption or 0)

    other = to_money(sum(
        (Decimal(d["amount"]) for d in breakdown["deductions"]), ZERO))
    net = calc.net_of(gross=gross, insurance_employee=ins_employee, tax=tax_amount,
                      advances=advance_total, other_deductions=other)

    line = PayrollLine(
        run_id=run.id, employee_id=employee.id,
        # متجمّدين وقت الحساب — نقل الموظف بعدين مايغيّرش تكلفة الشهر ده على قسمه.
        department_id=employee.department_id, job_title_id=employee.job_title_id,
        cost_center_id=_cost_center_of(db, employee),
        basic=basic, allowances=to_money(gross_structure - basic),
        overtime_hours=to_qty(Decimal(days["overtime_hours"])),
        overtime_amount=overtime_amount, gross=gross,
        days_in_month=days_in_month, days_worked=to_qty(Decimal(days["worked"])),
        days_absent=to_qty(absent), days_leave_paid=to_qty(Decimal(days["paid_leave"])),
        days_leave_unpaid=to_qty(Decimal(days["unpaid_leave"])),
        late_minutes=days["late_minutes"],
        absence_deduction=absence_amount, penalty_amount=penalty, bonus_amount=bonus,
        insurance_base=insurance_base, insurance_employee=ins_employee,
        insurance_employer=ins_employer,
        taxable_base=taxable_monthly, tax_amount=tax_amount,
        advance_deduction=advance_total, other_deductions=other,
        total_deductions=to_money(ins_employee + tax_amount + advance_total + other),
        net=net, has_attendance=days["has_any"],
    )
    db.add(line)
    db.flush()

    _write_details(db, line, breakdown, overtime_amount, days, absence_amount,
                   adjustments, instalments, ins_employee, tax_amount)
    return line


def _cost_center_of(db: Session, employee: Employee) -> int | None:
    from src.models.hr_org import Department

    if employee.department_id is None:
        return None
    dept = db.get(Department, employee.department_id)
    return dept.cost_center_id if dept else None


def _attendance_of(db: Session, employee_id: int, year: int, month: int) -> dict:
    """أيام الشهر مجمّعة. مفيش أي يوم = «محدش رفع الملف»، مش «غايب الشهر كله»."""
    first, last = date(year, month, 1), _period_end(year, month)
    rows = db.scalars(select(AttendanceDay).where(
        AttendanceDay.employee_id == employee_id,
        AttendanceDay.work_date >= first, AttendanceDay.work_date <= last)).all()

    out = {"worked": 0, "absent": 0, "paid_leave": 0, "unpaid_leave": 0,
           "overtime_hours": ZERO_QTY, "late_minutes": 0, "has_any": bool(rows)}
    for row in rows:
        if row.status == AttendanceStatus.present:
            out["worked"] += 1
        elif row.status == AttendanceStatus.absent:
            out["absent"] += 1
        elif row.status == AttendanceStatus.leave:
            out["paid_leave"] += 1
        out["overtime_hours"] += Decimal(str(row.overtime_hours or 0))
        out["late_minutes"] += row.late_minutes or 0
    return out


def _adjustments_of(db: Session, employee_id: int, year: int, month: int, daily, hourly):
    """بيحوّل الجزاءات والمكافآت لفلوس — الأيام بأجر يوم الشهر ده."""
    rows = advance_service.adjustments_in(db, employee_id=employee_id, year=year, month=month)
    bonus = penalty = ZERO
    resolved = []
    for row in rows:
        if row.basis == AdjustmentBasis.days:
            amount = to_money(Decimal(str(row.quantity or 0)) * daily)
        elif row.basis == AdjustmentBasis.hours:
            amount = to_money(Decimal(str(row.quantity or 0)) * hourly)
        else:
            amount = to_money(Decimal(str(row.amount or 0)))
        earning = row.kind in (AdjustmentKind.bonus, AdjustmentKind.other_earning)
        if earning:
            bonus += amount
        else:
            penalty += amount
        resolved.append((row, amount, earning))
    return to_money(bonus), to_money(penalty), resolved


def _write_details(db, line, breakdown, overtime_amount, days, absence_amount,
                   adjustments, instalments, ins_employee, tax_amount) -> None:
    """بند بند — قسيمة الراتب وكل تقارير المرتبات بتتقرا من هنا."""
    add = lambda **kw: db.add(PayrollLineDetail(line_id=line.id, **kw))  # noqa: E731

    add(source=DetailSource.component, label="الأساسي", kind=DetailKind.earning,
        amount=Decimal(breakdown["basic"]))
    for entry in breakdown["earnings"]:
        add(source=DetailSource.component, component_id=entry["component_id"],
            label=entry["name"], kind=DetailKind.earning, amount=Decimal(entry["amount"]))
    for entry in breakdown["deductions"]:
        add(source=DetailSource.component, component_id=entry["component_id"],
            label=entry["name"], kind=DetailKind.deduction, amount=Decimal(entry["amount"]))
    if overtime_amount > 0:
        add(source=DetailSource.overtime, label="أجر إضافي", kind=DetailKind.earning,
            quantity=to_qty(Decimal(days["overtime_hours"])), amount=overtime_amount)
    if absence_amount > 0:
        add(source=DetailSource.absence, label="خصم غياب", kind=DetailKind.deduction,
            quantity=to_qty(Decimal(days["absent"])), amount=absence_amount)
    for row, amount, earning in adjustments:
        add(source=DetailSource.bonus if earning else DetailSource.penalty,
            ref_id=row.id, label=row.reason or row.document_number,
            kind=DetailKind.earning if earning else DetailKind.deduction, amount=amount)
    for part in instalments:
        add(source=DetailSource.advance, ref_id=part.advance_id,
            label="قسط سلفة", kind=DetailKind.deduction, amount=Decimal(str(part.amount)))
    if ins_employee > 0:
        add(source=DetailSource.insurance, label="تأمينات اجتماعية",
            kind=DetailKind.deduction, amount=ins_employee)
    if tax_amount > 0:
        add(source=DetailSource.tax, label="ضريبة كسب عمل",
            kind=DetailKind.deduction, amount=tax_amount)
    db.flush()


# ------------------------------------------------------------------ الترحيل


def post_run(db: Session, *, run_id: int, actor_user_id: int) -> dict:
    """بيرحّل المسودة للأستاذ. ضغطة تانية مابتعملش حاجة.

    Returns `{"skipped": True}` rather than raising on a second press — the house pattern from
    `fixed_asset_service.run_depreciation`. A button somebody can click twice must be safe to click
    twice, and an error message for «it already worked» teaches people to distrust the screen.
    """
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise PayrollError("المسير غير موجود.")
    if run.status == PayrollRunStatus.posted:
        return {"skipped": True, "run_id": run.id, "total": "0.00",
                "ledger_entry_id": run.accrual_entry_id}
    if run.status == PayrollRunStatus.reversed:
        raise PayrollError("المسير ده اتعكس — اعمل حساب جديد للشهر.")

    lines = db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all()
    if not lines:
        raise PayrollError("المسير مافيهوش سطور — اعمل الحساب الأول.")

    acc = accounts(db)
    period_end = _period_end(run.year, run.month)
    entry_lines: list[LineInput] = []

    # المصروف بيتقسّم على مراكز التكلفة — ده اللي بيخلّي أجور القسم تظهر في أرباح وخسائر
    # مركز التكلفة من غير تقرير مخصوص.
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
    tax = total("tax_amount")
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
    if tax:
        entry_lines.append(LineInput(acc["tax_payable"].id, Direction.credit, tax,
                                     statement="ضريبة كسب عمل"))
    if penalties:
        # التزام مش إيراد: قانون العمل بيقول حصيلة الجزاءات لصندوق رعاية العمال.
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
    setup.lock_version(db, run.tax_version_id)
    setup.lock_version(db, run.insurance_version_id)
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
    """بيربط الأقساط والجزاءات بسطورها — عشان مايتخصموش تاني الشهر الجاي."""
    from src.models.hr_advance import EmployeeAdvanceInstalment, PayrollAdjustment

    for line in lines:
        for part in advance_service.due_in(
                db, employee_id=line.employee_id, year=run.year, month=run.month):
            part.payroll_line_id = line.id
        for row in advance_service.adjustments_in(
                db, employee_id=line.employee_id, year=run.year, month=run.month):
            row.payroll_line_id = line.id
    db.flush()

    # سلفة اتسدّدت بالكامل بتتقفل.
    for advance in db.scalars(select(EmployeeAdvance).where(
            EmployeeAdvance.status == AdvanceStatus.active)).all():
        if advance_service.outstanding_of(db, advance) <= ZERO:
            advance.status = AdvanceStatus.settled
    db.flush()
    _ = PayrollAdjustment, EmployeeAdvanceInstalment  # للقراية


def _lock_attendance(db: Session, run: PayrollRun) -> None:
    """أيام الشهر بتتقفل — القيد مابيتعدّلش، فمصدره مايتحركش من تحته."""
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
    """بيعكس المسير ويفتح الشهر تاني — والمستند بيفضل بترقيمه."""
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise PayrollError("المسير غير موجود.")
    if run.status != PayrollRunStatus.posted:
        raise PayrollError("المسير ده مش مرحّل.")

    paid = db.scalar(select(func.count()).select_from(PayrollLine).where(
        PayrollLine.run_id == run.id, PayrollLine.paid.is_(True))) or 0
    if paid:
        raise PayrollError(f"فيه {paid} مرتب اتصرف من المسير ده — اعكس الصرف الأول.")

    reversal = ledger_service.reverse_entry(
        db, original_id=run.accrual_entry_id, actor_user_id=actor_user_id)
    run.reversal_entry_id = reversal.id
    run.status = PayrollRunStatus.reversed

    # الأقساط والجزاءات بترجع مفتوحة، وأيام الحضور بتتفك.
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


# ------------------------------------------------------------------ الصرف


def pay_run(
    db: Session, *, run_id: int, actor_user_id: int, treasury_id: int | None = None,
    pay_date: date | None = None,
) -> dict:
    """صرف المرتبات — مدين مرتبات مستحقة / دائن الخزنة."""
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise PayrollError("المسير غير موجود.")
    if run.status != PayrollRunStatus.posted:
        raise PayrollError("لازم المسير يترحّل الأول.")

    lines = db.scalars(select(PayrollLine).where(
        PayrollLine.run_id == run.id, PayrollLine.paid.is_(False))).all()
    if not lines:
        return {"skipped": True, "paid": 0, "total": "0.00"}

    total = to_money(sum((Decimal(str(x.net)) for x in lines), ZERO))
    if total <= ZERO:
        raise PayrollError("مافيش صافي مستحق للصرف.")

    acc = accounts(db)
    treasury = account_resolver.treasury_account(db, branch_id=run.branch_id)
    entry = ledger_service.post_entry(
        db, entry_type="payroll_payment", actor_user_id=actor_user_id,
        entry_date=pay_date or date.today(), branch_id=run.branch_id,
        description=f"صرف مرتبات {run.year}-{run.month:02d}",
        lines=[
            LineInput(acc["salaries_payable"].id, Direction.debit, total,
                      statement=f"صرف مرتبات {run.year}-{run.month:02d}"),
            LineInput(treasury.id, Direction.credit, total,
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
    _ = treasury_id
    return {"skipped": False, "paid": len(lines), "total": str(total),
            "ledger_entry_id": entry.id}


def remit(
    db: Session, *, kind: str, amount, remit_date: date, actor_user_id: int,
    branch_id: int | None = None, notes: str | None = None,
) -> PayrollRemittance:
    """سداد التأمينات أو الضريبة — بيقفل الالتزام من الخزنة.

    Without it those liability accounts only ever grow: the payroll credits them every month and
    nobody ever debits them, so the balance sheet carries a debt that was actually paid.
    """
    if kind not in ("insurance", "tax"):
        raise PayrollError("النوع لازم يكون insurance أو tax.")
    value = to_money(Decimal(str(amount or 0)))
    if value <= ZERO:
        raise PayrollError("المبلغ لازم يكون أكبر من صفر.")

    acc = accounts(db)
    liability = acc["insurance_payable"] if kind == "insurance" else acc["tax_payable"]
    treasury = account_resolver.treasury_account(db, branch_id=branch_id)
    label = "تأمينات اجتماعية" if kind == "insurance" else "ضريبة كسب عمل"

    entry = ledger_service.post_entry(
        db, entry_type="payroll_remittance", actor_user_id=actor_user_id,
        entry_date=remit_date, branch_id=branch_id, description=f"سداد {label}",
        lines=[
            LineInput(liability.id, Direction.debit, value, statement=f"سداد {label}"),
            LineInput(treasury.id, Direction.credit, value, statement=f"سداد {label}"),
        ],
    )
    row = PayrollRemittance(
        document_number=numbering.next_document_number(db, PayrollRemittance, "RMT"),
        kind=kind, amount=value, remit_date=remit_date, branch_id=branch_id,
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
