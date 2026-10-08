from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, and_, cast, func, or_, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.customer import Customer
from src.models.employee import Employee
from src.models.hr_advance import AdjustmentBasis, AdjustmentKind
from src.models.hr_attendance import AttendanceDay, AttendanceStatus
from src.models.hr_payroll import (
    AbsenceBasis,
    ComponentKind,
    EmployeeSalary,
    EmployeeSalaryLine,
    SalaryComponent,
)
from src.models.hr_payroll_run import (
    DetailKind,
    DetailSource,
    PayrollLine,
    PayrollLineDetail,
    PayrollRun,
    PayrollRunStatus,
)
from src.models.hr_salary import CommissionBasis, EmployeeCommissionRule
from src.models.ledger import Direction
from src.models.sales import SalesInvoice, SalesReturn
from src.models.voucher import Voucher, VoucherKind
from src.services import (
    advance_service,
    audit_service,
    insurance_service,
    ledger_service,
    numbering,
    payroll_service,
)
from src.services import payroll_setup_service as setup
from src.services.ledger_service import LineInput

STATUS_LABELS = {
    PayrollRunStatus.draft: "مسودة",
    PayrollRunStatus.closed: "مسودة",
    PayrollRunStatus.posted: "مرحّل",
    PayrollRunStatus.reversed: "ملغى",
}

BASIS_LABELS = {
    CommissionBasis.sales: "المبيعات",
    CommissionBasis.collections: "التحصيلات",
}


class SalaryError(Exception):
    pass


def _d(v) -> Decimal:
    return Decimal(str(v if v is not None else 0))


def _month_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def _check_month(year: int, month: int) -> None:
    if not 1 <= int(month) <= 12 or int(year) < 2000:
        raise SalaryError("الشهر غير صحيح.")


def sales_of(db: Session, user_id: int, d1: date, d2: date) -> Decimal:
    total = ZERO
    day = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    cond = or_(SalesInvoice.rep_id == user_id,
               and_(SalesInvoice.rep_id.is_(None), Customer.rep_id == user_id))
    for (net,) in db.execute(
        select(SalesInvoice.net)
        .outerjoin(Customer, Customer.id == SalesInvoice.customer_id)
        .where(or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
               day >= d1, day <= d2, cond)
    ).all():
        total += _d(net)
    rday = func.coalesce(SalesReturn.return_date, cast(SalesReturn.created_at, Date))
    rcond = or_(SalesReturn.rep_id == user_id,
                and_(SalesReturn.rep_id.is_(None), Customer.rep_id == user_id))
    for (value,) in db.execute(
        select(SalesReturn.value)
        .outerjoin(Customer, Customer.id == SalesReturn.customer_id)
        .where(SalesReturn.reversed_at.is_(None), rday >= d1, rday <= d2, rcond)
    ).all():
        total -= _d(value)
    return to_money(total)


def collections_of(db: Session, user_id: int, d1: date, d2: date) -> Decimal:
    total = ZERO
    day = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    cond = or_(SalesInvoice.rep_id == user_id,
               and_(SalesInvoice.rep_id.is_(None), Customer.rep_id == user_id))
    for (cash,) in db.execute(
        select(SalesInvoice.cash_amount)
        .outerjoin(Customer, Customer.id == SalesInvoice.customer_id)
        .where(SalesInvoice.cash_amount > 0,
               or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
               day >= d1, day <= d2, cond)
    ).all():
        total += _d(cash)
    vcond = or_(
        Voucher.rep_user_id == user_id,
        and_(Voucher.rep_user_id.is_(None), Voucher.actor_user_id == user_id),
        and_(Voucher.rep_user_id.is_(None), Customer.rep_id == user_id),
    )
    for amount, reverses_id in db.execute(
        select(Voucher.amount, Voucher.reverses_id)
        .join(Customer, Customer.id == Voucher.customer_id)
        .where(Voucher.kind == VoucherKind.receipt, Voucher.voucher_date >= d1,
               Voucher.voucher_date <= d2, vcond)
    ).all():
        total += -_d(amount) if reverses_id is not None else _d(amount)
    return to_money(total)


def rules_of(db: Session, employee_id: int) -> list[EmployeeCommissionRule]:
    return db.scalars(select(EmployeeCommissionRule).where(
        EmployeeCommissionRule.employee_id == employee_id,
        EmployeeCommissionRule.active.is_(True)).order_by(EmployeeCommissionRule.id)).all()


def _rule_out(r: EmployeeCommissionRule) -> dict:
    return {"id": r.id, "basis": r.basis.value, "basis_label": BASIS_LABELS[r.basis],
            "pct": str(r.pct), "notes": r.notes}


def commission_preview(db: Session, employee: Employee, year: int, month: int) -> list[dict]:
    d1, d2 = date(year, month, 1), _month_end(year, month)
    out = []
    for r in rules_of(db, employee.id):
        if employee.user_id is None:
            base = None
        elif r.basis == CommissionBasis.sales:
            base = sales_of(db, employee.user_id, d1, d2)
        else:
            base = collections_of(db, employee.user_id, d1, d2)
        amount = to_money(base * _d(r.pct) / Decimal("100")) if base is not None else ZERO
        out.append({**_rule_out(r), "base": str(base) if base is not None else None,
                    "amount": str(amount)})
    return out


def _components(db: Session, salary: EmployeeSalary | None) -> list[dict]:
    if salary is None:
        return []
    basic = _d(salary.basic)
    out = []
    for line, comp in db.execute(
        select(EmployeeSalaryLine, SalaryComponent)
        .join(SalaryComponent, SalaryComponent.id == EmployeeSalaryLine.component_id)
        .where(EmployeeSalaryLine.salary_id == salary.id)
        .order_by(SalaryComponent.sort_order, SalaryComponent.id)
    ).all():
        amount = (to_money(basic * _d(line.pct) / Decimal("100")) if line.pct is not None
                  else to_money(_d(line.amount)))
        out.append({"component_id": comp.id, "name": comp.name, "kind": comp.kind.value,
                    "amount": str(amount)})
    return out


def _card_summary(db: Session, emp: Employee, day: date) -> dict:
    salary = setup.salary_on(db, emp.id, day)
    items = _components(db, salary)
    ins = insurance_service.amount_on(db, emp.id, day)
    return {
        "has_card": salary is not None,
        "effective_from": str(salary.effective_from) if salary else None,
        "basic": str(salary.basic) if salary else None,
        "earnings": str(to_money(sum((_d(i["amount"]) for i in items
                                       if i["kind"] == "earning"), ZERO))),
        "deductions": str(to_money(sum((_d(i["amount"]) for i in items
                                         if i["kind"] == "deduction"), ZERO))),
        "insurance": str(ins.amount) if ins else None,
        "rules": [_rule_out(r) for r in rules_of(db, emp.id)],
        "linked_user": emp.user_id is not None,
    }


def roster(db: Session, employees: list[Employee], day: date) -> list[dict]:
    return [{
        "employee_id": e.id, "code": e.code, "name": e.name, "active": e.active,
        "branch_id": e.branch_id, "job_title_id": e.job_title_id,
        **_card_summary(db, e, day),
    } for e in employees]


def card(db: Session, employee: Employee) -> dict:
    today = date.today()
    versions = db.scalars(select(EmployeeSalary).where(
        EmployeeSalary.employee_id == employee.id)
        .order_by(EmployeeSalary.effective_from.desc())).all()
    current = setup.salary_on(db, employee.id, today) or (versions[-1] if versions else None)
    months = []
    for line, run in db.execute(
        select(PayrollLine, PayrollRun)
        .join(PayrollRun, PayrollRun.id == PayrollLine.run_id)
        .where(PayrollLine.employee_id == employee.id)
        .order_by(PayrollRun.year.desc(), PayrollRun.month.desc(), PayrollRun.reversal_seq.desc())
    ).all():
        months.append({
            "run_id": run.id, "year": run.year, "month": run.month,
            "status": run.status.value, "status_label": STATUS_LABELS[run.status],
            "gross": str(to_money(_d(line.basic) + _d(line.allowances))), "net": str(line.net),
            "insurance": str(line.insurance_employee), "paid": bool(line.paid),
        })
    return {
        "employee": {"id": employee.id, "code": employee.code, "name": employee.name,
                     "branch_id": employee.branch_id, "linked_user": employee.user_id is not None},
        "current": {
            "effective_from": str(current.effective_from) if current else None,
            "basic": str(current.basic) if current else "0",
            "items": _components(db, current),
            "notes": current.notes if current else None,
        },
        "insurance": str(getattr(insurance_service.amount_on(db, employee.id, today),
                                 "amount", "0") or "0"),
        "rules": [_rule_out(r) for r in rules_of(db, employee.id)],
        "versions": [{
            "id": v.id, "effective_from": str(v.effective_from), "basic": str(v.basic),
            "items": _components(db, v), "locked": setup.used_by_posted_run(db, v),
        } for v in versions],
        "insurance_history": insurance_service.history(db, employee.id),
        "months": months,
    }


def _component_for(db: Session, name: str, kind: ComponentKind, actor_user_id: int):
    clean = (name or "").strip()
    if not clean:
        raise SalaryError("اكتب اسم البند.")
    comp = db.scalar(select(SalaryComponent).where(SalaryComponent.name == clean))
    if comp is None:
        return setup.create_component(db, name=clean, kind=kind, actor_user_id=actor_user_id)
    if comp.kind != kind:
        raise SalaryError(f"البند «{clean}» مسجّل {'إضافة' if comp.kind == ComponentKind.earning else 'خصماً'} — غيّر الاسم.")
    if not comp.active:
        comp.active = True
    return comp


def save_card(
    db: Session, *, employee: Employee, effective_from: date, basic, items: list[dict],
    insurance, rules: list[dict], actor_user_id: int, notes: str | None = None,
) -> dict:
    value = to_money(_d(basic))
    if value < 0:
        raise SalaryError("لا يمكن أن يكون الأساسي سالباً.")
    lines = []
    seen: set[int] = set()
    for it in items or []:
        amount = to_money(_d(it.get("amount")))
        if amount <= 0 and not (it.get("name") or "").strip():
            continue
        kind = ComponentKind.deduction if it.get("kind") == "deduction" else ComponentKind.earning
        comp = _component_for(db, it.get("name") or "", kind, actor_user_id)
        if comp.id in seen:
            raise SalaryError(f"البند «{comp.name}» مكرر.")
        seen.add(comp.id)
        lines.append({"component_id": comp.id, "amount": amount})
    try:
        setup.set_salary(db, employee_id=employee.id, effective_from=effective_from,
                         basic=value, lines=lines, notes=notes, actor_user_id=actor_user_id)
    except setup.PayrollSetupError as exc:
        raise SalaryError(str(exc)) from exc

    ins_value = to_money(_d(insurance))
    current_ins = insurance_service.amount_on(db, employee.id, effective_from)
    if current_ins is None and ins_value > 0 or (
            current_ins is not None and to_money(_d(current_ins.amount)) != ins_value):
        try:
            insurance_service.set_amount(db, employee_id=employee.id,
                                         effective_from=effective_from, amount=ins_value,
                                         actor_user_id=actor_user_id)
        except insurance_service.InsuranceError as exc:
            raise SalaryError(str(exc)) from exc

    save_rules(db, employee=employee, rules=rules, actor_user_id=actor_user_id)
    db.flush()
    return card(db, employee)


def save_rules(db: Session, *, employee: Employee, rules: list[dict], actor_user_id: int) -> None:
    wanted = []
    for r in rules or []:
        pct = _d(r.get("pct"))
        if pct <= 0:
            continue
        if pct > 100:
            raise SalaryError("نسبة العمولة لا تتجاوز 100٪.")
        try:
            basis = CommissionBasis(r.get("basis") or "sales")
        except ValueError as exc:
            raise SalaryError("أساس العمولة غير صحيح.") from exc
        wanted.append((basis, pct, (r.get("notes") or "").strip()[:200] or None))
    if wanted and employee.user_id is None:
        raise SalaryError("الموظف غير مربوط بحساب مستخدم أو مندوب، فلا يمكن حساب عمولته من البيع.")
    old = rules_of(db, employee.id)
    before = [(r.basis, _d(r.pct), r.notes) for r in old]
    if before == wanted:
        return
    for r in old:
        r.active = False
    for basis, pct, note in wanted:
        db.add(EmployeeCommissionRule(employee_id=employee.id, basis=basis, pct=pct,
                                      notes=note, actor_user_id=actor_user_id))
    db.flush()
    audit_service.record(
        db, action="employee_commission.set", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee.id,
        before={"rules": [f"{b.value}:{p}" for b, p, _ in before]},
        after={"rules": [f"{b.value}:{p}" for b, p, _ in wanted]},
    )


def _runs_of(db: Session, branch_id: int, year: int, month: int) -> list[PayrollRun]:
    return db.scalars(select(PayrollRun).where(
        PayrollRun.year == year, PayrollRun.month == month,
        PayrollRun.branch_id == branch_id).order_by(PayrollRun.reversal_seq.desc())).all()


def current_run(db: Session, *, branch_id: int, year: int, month: int) -> PayrollRun | None:
    runs = _runs_of(db, branch_id, year, month)
    return next((r for r in runs if r.status != PayrollRunStatus.reversed), None)


def _absent_days(db: Session, employee_id: int, year: int, month: int) -> Decimal:
    first, last = date(year, month, 1), _month_end(year, month)
    n = db.scalar(select(func.count()).select_from(AttendanceDay).where(
        AttendanceDay.employee_id == employee_id,
        AttendanceDay.work_date >= first, AttendanceDay.work_date <= last,
        AttendanceDay.status == AttendanceStatus.absent)) or 0
    return to_qty(Decimal(n))


_MANUAL = ("commission_override", "absent_override", "extra_earning", "extra_deduction", "notes")


def _wipe_line(db: Session, line: PayrollLine) -> None:
    for d in db.scalars(select(PayrollLineDetail).where(
            PayrollLineDetail.line_id == line.id)).all():
        db.delete(d)
    db.flush()
    db.delete(line)
    db.flush()


def _build_line(db: Session, run: PayrollRun, emp: Employee, manual: dict) -> PayrollLine | None:
    period_end = _month_end(run.year, run.month)
    salary = setup.salary_on(db, emp.id, period_end)
    if salary is None:
        return None
    cfg = setup.settings(db)
    per_month = Decimal(cfg.days_per_month or 30)
    hours = _d(cfg.hours_per_day) or Decimal(8)

    basic = to_money(_d(salary.basic))
    details: list[dict] = []
    earn_items = ZERO
    card_deductions = ZERO
    for it in _components(db, salary):
        amount = _d(it["amount"])
        if not amount:
            continue
        if it["kind"] == "earning":
            earn_items += amount
            details.append(dict(source=DetailSource.component, component_id=it["component_id"],
                                label=it["name"][:120], kind=DetailKind.earning, amount=amount))
        else:
            card_deductions += amount
            details.append(dict(source=DetailSource.component, component_id=it["component_id"],
                                label=it["name"][:120], kind=DetailKind.deduction, amount=amount))
    earn_items = to_money(earn_items)

    daily_base = basic + (earn_items if cfg.absence_basis == AbsenceBasis.gross else ZERO)
    daily = daily_base / per_month if per_month else ZERO

    att_days = _absent_days(db, emp.id, run.year, run.month)
    days = to_qty(_d(manual.get("absent_override"))) if manual.get("absent_override") is not None \
        else att_days
    absence = to_money(daily * days)
    if absence:
        details.append(dict(source=DetailSource.absence, label="غياب", kind=DetailKind.deduction,
                            quantity=days, amount=absence))

    preview = commission_preview(db, emp, run.year, run.month)
    computed = to_money(sum((_d(p["amount"]) for p in preview), ZERO))
    base = to_money(sum((_d(p["base"]) for p in preview if p["base"] is not None), ZERO))
    if manual.get("commission_override") is not None:
        commission = to_money(_d(manual["commission_override"]))
        if commission:
            details.append(dict(source=DetailSource.commission, label="عمولة (يدوي)",
                                kind=DetailKind.earning, amount=commission))
    else:
        commission = computed
        for p in preview:
            if _d(p["amount"]):
                details.append(dict(
                    source=DetailSource.commission,
                    label=f"عمولة {p['pct']}٪ من {p['basis_label']}"[:120],
                    kind=DetailKind.earning, quantity=_d(p["base"]), amount=_d(p["amount"])))

    bonuses = penalties = other_earn = other_ded = ZERO
    for adj in advance_service.adjustments_in(db, employee_id=emp.id, year=run.year,
                                              month=run.month):
        if adj.basis == AdjustmentBasis.days:
            amount = to_money(_d(adj.quantity) * daily)
        elif adj.basis == AdjustmentBasis.hours:
            amount = to_money(_d(adj.quantity) * daily / hours)
        else:
            amount = to_money(_d(adj.amount))
        if not amount:
            continue
        label = (adj.reason or {
            AdjustmentKind.bonus: "مكافأة", AdjustmentKind.penalty: "جزاء",
            AdjustmentKind.other_earning: "إضافة", AdjustmentKind.other_deduction: "خصم",
        }[adj.kind])[:120]
        if adj.kind == AdjustmentKind.bonus:
            bonuses += amount
            details.append(dict(source=DetailSource.bonus, ref_id=adj.id, label=label,
                                kind=DetailKind.earning, amount=amount))
        elif adj.kind == AdjustmentKind.other_earning:
            other_earn += amount
            details.append(dict(source=DetailSource.bonus, ref_id=adj.id, label=label,
                                kind=DetailKind.earning, amount=amount))
        elif adj.kind == AdjustmentKind.penalty:
            penalties += amount
            details.append(dict(source=DetailSource.penalty, ref_id=adj.id, label=label,
                                kind=DetailKind.deduction, amount=amount))
        else:
            other_ded += amount
            details.append(dict(source=DetailSource.penalty, ref_id=adj.id, label=label,
                                kind=DetailKind.deduction, amount=amount))

    extra_earning = to_money(_d(manual.get("extra_earning")))
    extra_deduction = to_money(_d(manual.get("extra_deduction")))
    if extra_earning:
        details.append(dict(source=DetailSource.manual, label="إضافة يدوية",
                            kind=DetailKind.earning, amount=extra_earning))
    if extra_deduction:
        details.append(dict(source=DetailSource.manual, label="خصم يدوي",
                            kind=DetailKind.deduction, amount=extra_deduction))

    advances = to_money(sum((_d(p.amount) for p in advance_service.due_in(
        db, employee_id=emp.id, year=run.year, month=run.month)), ZERO))
    if advances:
        details.append(dict(source=DetailSource.advance, label="قسط سلفة",
                            kind=DetailKind.deduction, amount=advances))

    ins_row = insurance_service.amount_on(db, emp.id, period_end)
    insurance = to_money(_d(ins_row.amount)) if ins_row else ZERO
    if insurance:
        details.append(dict(source=DetailSource.insurance, label="تأمينات",
                            kind=DetailKind.deduction, amount=insurance))

    earnings = to_money(basic + earn_items + commission + bonuses + other_earn + extra_earning)
    reduce = to_money(absence + card_deductions + other_ded + extra_deduction)
    gross = to_money(earnings - reduce)
    net = to_money(gross - penalties - advances - insurance)

    line = PayrollLine(
        run_id=run.id, employee_id=emp.id,
        department_id=emp.department_id, job_title_id=emp.job_title_id,
        cost_center_id=payroll_service._cost_center_of(db, emp),
        basic=basic, allowances=to_money(earnings - basic), gross=gross,
        days_in_month=int(per_month), days_absent=days,
        absence_deduction=absence, penalty_amount=penalties,
        bonus_amount=to_money(bonuses + other_earn),
        insurance_employee=insurance, advance_deduction=advances,
        other_deductions=to_money(card_deductions + other_ded + extra_deduction),
        total_deductions=to_money(reduce + penalties + advances + insurance),
        net=net, has_attendance=att_days > 0,
        commission=commission, commission_base=base,
        commission_override=manual.get("commission_override"),
        absent_override=manual.get("absent_override"),
        extra_earning=extra_earning or None, extra_deduction=extra_deduction or None,
        notes=manual.get("notes"),
    )
    db.add(line)
    db.flush()
    for d in details:
        db.add(PayrollLineDetail(line_id=line.id, **d))
    db.flush()
    return line


def _refresh_totals(db: Session, run: PayrollRun) -> None:
    rows = db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all()

    def tot(f):
        return to_money(sum((_d(getattr(x, f)) for x in rows), ZERO))

    run.earnings = to_money(sum((_d(x.basic) + _d(x.allowances) for x in rows), ZERO))
    run.gross = tot("gross")
    run.absence_deduction = tot("absence_deduction")
    run.bonuses = tot("bonus_amount")
    run.penalties = tot("penalty_amount")
    run.insurance_employee = tot("insurance_employee")
    run.insurance_employer = ZERO
    run.tax = ZERO
    run.advances = tot("advance_deduction")
    run.other_deductions = tot("other_deductions")
    run.total_deductions = tot("total_deductions")
    run.net = tot("net")
    db.flush()


def _manual_of(line: PayrollLine) -> dict:
    return {k: getattr(line, k) for k in _MANUAL}


def calculate(db: Session, *, branch_id: int, year: int, month: int,
              actor_user_id: int) -> PayrollRun:
    _check_month(year, month)
    runs = _runs_of(db, branch_id, year, month)
    live = next((r for r in runs if r.status != PayrollRunStatus.reversed), None)
    if live is not None and live.status == PayrollRunStatus.posted:
        raise SalaryError("مرتبات هذا الشهر مُرحّلة — ألغِ الترحيل أولاً إن أردت التعديل.")

    source = live or next((r for r in runs if r.status == PayrollRunStatus.reversed), None)
    manual: dict[int, dict] = {}
    excluded = _excluded(source)
    if source is not None:
        for line in db.scalars(select(PayrollLine).where(PayrollLine.run_id == source.id)).all():
            manual[line.employee_id] = _manual_of(line)

    if live is None:
        run = PayrollRun(
            document_number=numbering.next_document_number(db, PayrollRun, "PR"),
            year=year, month=month, branch_id=branch_id,
            reversal_seq=(runs[0].reversal_seq + 1) if runs else 0,
            status=PayrollRunStatus.draft, actor_user_id=actor_user_id,
        )
        db.add(run)
        db.flush()
    else:
        run = live
        run.status = PayrollRunStatus.draft
        for line in db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all():
            _wipe_line(db, line)

    run.excluded_employees = _excluded_text(excluded)
    employees = db.scalars(select(Employee).where(
        Employee.branch_id == branch_id, Employee.active.is_(True)).order_by(Employee.name)).all()
    count = 0
    for emp in employees:
        if emp.id in excluded:
            continue
        if _build_line(db, run, emp, manual.get(emp.id, {})) is not None:
            count += 1
    _refresh_totals(db, run)
    audit_service.record(db, action="salary.calculate", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"period": f"{year}-{month:02d}", "employees": count,
                                "net": str(run.net)})
    return run


def _excluded(run: PayrollRun | None) -> set[int]:
    if run is None or not run.excluded_employees:
        return set()
    return {int(x) for x in run.excluded_employees.split(",") if x.strip().isdigit()}


def _excluded_text(ids: set[int]) -> str | None:
    return ",".join(str(i) for i in sorted(ids))[:2000] or None


def _draft(db: Session, run_id: int) -> PayrollRun:
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise SalaryError("مرتبات الشهر غير موجودة.")
    if run.status == PayrollRunStatus.posted:
        raise SalaryError("مرتبات هذا الشهر مُرحّلة — ألغِ الترحيل أولاً.")
    if run.status == PayrollRunStatus.reversed:
        raise SalaryError("هذه النسخة ملغاة — احسب الشهر من جديد.")
    return run


def update_line(db: Session, *, run_id: int, employee_id: int, fields: dict,
                actor_user_id: int) -> PayrollLine:
    run = _draft(db, run_id)
    line = db.scalar(select(PayrollLine).where(
        PayrollLine.run_id == run.id, PayrollLine.employee_id == employee_id))
    if line is None:
        raise SalaryError("الموظف غير موجود في مرتبات هذا الشهر.")
    emp = db.get(Employee, employee_id)
    manual = _manual_of(line)
    for k in _MANUAL:
        if k in fields:
            v = fields[k]
            if k == "notes":
                manual[k] = (v or "").strip()[:300] or None
            elif v in (None, ""):
                manual[k] = None
            else:
                num = _d(v)
                if num < 0:
                    raise SalaryError("لا يمكن إدخال قيمة سالبة.")
                manual[k] = num
    _wipe_line(db, line)
    new = _build_line(db, run, emp, manual)
    if new is None:
        raise SalaryError("لا يوجد كارت مرتب ساري لهذا الموظف في هذا الشهر.")
    _refresh_totals(db, run)
    audit_service.record(db, action="salary.line_update", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"employee_id": employee_id,
                                **{k: (str(v) if v is not None else None)
                                   for k, v in manual.items()}})
    return new


def remove_line(db: Session, *, run_id: int, employee_id: int, actor_user_id: int) -> None:
    run = _draft(db, run_id)
    line = db.scalar(select(PayrollLine).where(
        PayrollLine.run_id == run.id, PayrollLine.employee_id == employee_id))
    if line is None:
        raise SalaryError("الموظف غير موجود في مرتبات هذا الشهر.")
    _wipe_line(db, line)
    run.excluded_employees = _excluded_text(_excluded(run) | {employee_id})
    _refresh_totals(db, run)
    audit_service.record(db, action="salary.line_remove", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"employee_id": employee_id})


def add_line(db: Session, *, run_id: int, employee_id: int, actor_user_id: int) -> PayrollLine:
    run = _draft(db, run_id)
    emp = db.get(Employee, employee_id)
    if emp is None or emp.branch_id != run.branch_id:
        raise SalaryError("الموظف غير موجود في هذا الفرع.")
    if db.scalar(select(PayrollLine).where(
            PayrollLine.run_id == run.id, PayrollLine.employee_id == employee_id)):
        raise SalaryError("الموظف موجود بالفعل في مرتبات هذا الشهر.")
    line = _build_line(db, run, emp, {})
    if line is None:
        raise SalaryError("لا يوجد كارت مرتب ساري لهذا الموظف في هذا الشهر — أنشئ كارته أولاً.")
    run.excluded_employees = _excluded_text(_excluded(run) - {employee_id})
    _refresh_totals(db, run)
    audit_service.record(db, action="salary.line_add", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"employee_id": employee_id})
    return line


def post(db: Session, *, run_id: int, actor_user_id: int) -> dict:
    run = _draft(db, run_id)
    negative = db.scalar(select(func.count()).select_from(PayrollLine).where(
        PayrollLine.run_id == run.id, PayrollLine.net < 0)) or 0
    if negative:
        raise SalaryError(f"يوجد {negative} موظف صافي مرتبهم بالسالب — راجعهم قبل الترحيل.")
    try:
        return payroll_service.post_run(db, run_id=run.id, actor_user_id=actor_user_id)
    except payroll_service.PayrollError as exc:
        raise SalaryError(str(exc)) from exc


def unpost(db: Session, *, run_id: int, actor_user_id: int) -> PayrollRun:
    try:
        payroll_service.reverse_run(db, run_id=run_id, actor_user_id=actor_user_id)
    except payroll_service.PayrollError as exc:
        raise SalaryError(str(exc)) from exc
    old = db.get(PayrollRun, run_id)
    return calculate(db, branch_id=old.branch_id, year=old.year, month=old.month,
                     actor_user_id=actor_user_id)


def pay(db: Session, *, run_id: int, actor_user_id: int, treasury_id: int | None = None,
        pay_date: date | None = None, employee_ids: list[int] | None = None) -> dict:
    run = db.get(PayrollRun, run_id)
    if run is None:
        raise SalaryError("مرتبات الشهر غير موجودة.")
    if run.status != PayrollRunStatus.posted:
        raise SalaryError("رحّل مرتبات الشهر أولاً ثم اصرفها.")
    stmt = select(PayrollLine).where(PayrollLine.run_id == run.id, PayrollLine.paid.is_(False))
    if employee_ids:
        stmt = stmt.where(PayrollLine.employee_id.in_(employee_ids))
    lines = db.scalars(stmt).all()
    if not lines:
        raise SalaryError("لا توجد مرتبات غير مصروفة.")
    total = to_money(sum((_d(x.net) for x in lines), ZERO))
    if total <= ZERO:
        raise SalaryError("لا يوجد صافٍ مستحق للصرف.")
    acc = payroll_service.accounts(db)
    cash_account_id, _ = payroll_service._cash_side(db, treasury_id, run.branch_id)
    label = f"صرف مرتبات {run.year}-{run.month:02d}"
    if len(lines) == 1:
        emp = db.get(Employee, lines[0].employee_id)
        label = f"{label} — {emp.name if emp else ''}"
    entry = ledger_service.post_entry(
        db, entry_type="payroll_payment", actor_user_id=actor_user_id,
        entry_date=pay_date or date.today(), branch_id=run.branch_id, description=label,
        lines=[LineInput(acc["salaries_payable"].id, Direction.debit, total, statement=label),
               LineInput(cash_account_id, Direction.credit, total, statement=label)],
    )
    for line in lines:
        line.paid = True
        line.payment_entry_id = entry.id
        line.paid_at = datetime.now()
    db.flush()
    audit_service.record(db, action="salary.pay", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"paid": len(lines), "total": str(total),
                                "ledger_entry_id": entry.id})
    return {"paid": len(lines), "total": str(total), "ledger_entry_id": entry.id}


def unpay(db: Session, *, run_id: int, employee_id: int, actor_user_id: int) -> int:
    line = db.scalar(select(PayrollLine).where(
        PayrollLine.run_id == run_id, PayrollLine.employee_id == employee_id))
    if line is None:
        raise SalaryError("الموظف غير موجود في مرتبات هذا الشهر.")
    if not line.paid or line.payment_entry_id is None:
        raise SalaryError("مرتب هذا الموظف غير مصروف.")
    entry_id = line.payment_entry_id
    reversal = ledger_service.reverse_entry(db, original_id=entry_id, actor_user_id=actor_user_id)
    affected = db.scalars(select(PayrollLine).where(
        PayrollLine.payment_entry_id == entry_id)).all()
    for x in affected:
        x.paid = False
        x.payment_entry_id = None
        x.paid_at = None
    db.flush()
    audit_service.record(db, action="salary.unpay", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run_id,
                         after={"employees": [x.employee_id for x in affected],
                                "reversal_entry_id": reversal.id})
    return len(affected)


def delete_draft(db: Session, *, run_id: int, actor_user_id: int) -> None:
    run = _draft(db, run_id)
    number = run.document_number
    for line in db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all():
        _wipe_line(db, line)
    db.delete(run)
    db.flush()
    audit_service.record(db, action="salary.delete", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run_id,
                         before={"document_number": number})


def _line_out(line: PayrollLine, emp: Employee | None, details: list[PayrollLineDetail]) -> dict:
    def s(v):
        return str(v) if v is not None else None
    return {
        "line_id": line.id, "employee_id": line.employee_id,
        "code": emp.code if emp else None, "name": emp.name if emp else None,
        "basic": s(line.basic),
        "allowances": s(to_money(_d(line.allowances) - _d(line.commission)
                                 - _d(line.bonus_amount) - _d(line.extra_earning))),
        "commission": s(line.commission or ZERO), "commission_base": s(line.commission_base),
        "commission_override": s(line.commission_override),
        "bonuses": s(to_money(_d(line.bonus_amount) + _d(line.extra_earning))),
        "earnings": s(to_money(_d(line.basic) + _d(line.allowances))),
        "days_absent": s(line.days_absent), "absent_override": s(line.absent_override),
        "absence": s(line.absence_deduction), "penalties": s(line.penalty_amount),
        "advances": s(line.advance_deduction), "insurance": s(line.insurance_employee),
        "other_deductions": s(line.other_deductions),
        "total_deductions": s(line.total_deductions), "net": s(line.net),
        "extra_earning": s(line.extra_earning), "extra_deduction": s(line.extra_deduction),
        "notes": line.notes, "paid": bool(line.paid), "paid_at": line.paid_at,
        "details": [{"source": d.source.value, "label": d.label, "kind": d.kind.value,
                     "quantity": s(d.quantity), "amount": s(d.amount)} for d in details],
    }


def month_out(db: Session, *, branch_id: int, year: int, month: int) -> dict:
    run = current_run(db, branch_id=branch_id, year=year, month=month)
    period_end = _month_end(year, month)
    if run is None:
        missing = db.scalars(select(Employee).where(
            Employee.branch_id == branch_id, Employee.active.is_(True))).all()
        return {"run": None, "lines": [], "branch_id": branch_id, "year": year, "month": month,
                "addable": [],
                "without_card": [{"employee_id": e.id, "name": e.name} for e in missing
                                 if setup.salary_on(db, e.id, period_end) is None]}
    lines = db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all()
    emps = {e.id: e for e in db.scalars(select(Employee).where(
        Employee.id.in_([x.employee_id for x in lines] or [-1]))).all()}
    details: dict[int, list] = defaultdict(list)
    for d in db.scalars(select(PayrollLineDetail).where(
            PayrollLineDetail.line_id.in_([x.id for x in lines] or [-1]))
            .order_by(PayrollLineDetail.id)).all():
        details[d.line_id].append(d)
    rows = sorted((_line_out(x, emps.get(x.employee_id), details[x.id]) for x in lines),
                  key=lambda r: r["name"] or "")
    in_run = {x.employee_id for x in lines}
    outside = [e for e in db.scalars(select(Employee).where(
        Employee.branch_id == branch_id, Employee.active.is_(True))
        .order_by(Employee.name)).all() if e.id not in in_run]
    with_card = {e.id for e in outside if setup.salary_on(db, e.id, period_end) is not None}
    without = [e for e in outside if e.id not in with_card]
    addable = [e for e in outside if e.id in with_card]
    return {
        "run": {"id": run.id, "document_number": run.document_number, "year": run.year,
                "month": run.month, "status": run.status.value,
                "status_label": STATUS_LABELS[run.status], "net": str(run.net),
                "posted_at": run.posted_at, "accrual_entry_id": run.accrual_entry_id},
        "lines": rows, "branch_id": branch_id, "year": year, "month": month,
        "without_card": [{"employee_id": e.id, "name": e.name} for e in without],
        "addable": [{"employee_id": e.id, "name": e.name} for e in addable],
    }


def payslip(db: Session, *, run_id: int, employee_id: int) -> dict:
    run = db.get(PayrollRun, run_id)
    line = db.scalar(select(PayrollLine).where(
        PayrollLine.run_id == run_id, PayrollLine.employee_id == employee_id)) if run else None
    if line is None:
        raise SalaryError("قسيمة المرتب غير موجودة.")
    emp = db.get(Employee, employee_id)
    details = db.scalars(select(PayrollLineDetail).where(
        PayrollLineDetail.line_id == line.id).order_by(PayrollLineDetail.id)).all()
    return {"run": {"document_number": run.document_number, "year": run.year,
                    "month": run.month, "status": run.status.value,
                    "status_label": STATUS_LABELS[run.status]},
            "line": _line_out(line, emp, details)}
