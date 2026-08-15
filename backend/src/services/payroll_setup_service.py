"""هيكل الرواتب والشرايح — الإعداد قبل أي مسير (HR-4).

The running of the payroll is HR-6; this is everything that has to be true before it can run.

**قاعدة التجميد.** A `payroll_scheme_version` that has been used by a posted payroll run cannot be
edited — not its dates, not its brackets. New rates are a new version with a new `effective_from`,
always. Without that rule, correcting a typo in a rate silently rewrites every month already
posted, and the ledger entries underneath them cannot be edited to match. The books would then
disagree with the payslips and neither would be recoverable.

The freeze is checked here rather than in the router because the run is what sets it, and the two
have to agree about what «used» means.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_money
from src.lib.payroll_calc import Bracket
from src.models.employee import Employee
from src.models.hr_payroll import (
    ComponentCalc,
    ComponentKind,
    EmployeeSalary,
    EmployeeSalaryLine,
    PayrollSchemeBracket,
    PayrollSchemeVersion,
    PayrollSetting,
    SalaryComponent,
    SchemeKind,
)
from src.services import audit_service, numbering


class PayrollSetupError(Exception):
    """الإعداد مايتعملش زي ما هو مكتوب."""


# ------------------------------------------------------------------ البنود


def create_component(
    db: Session, *, name: str, kind: ComponentKind, actor_user_id: int,
    code: str | None = None, calc: ComponentCalc = ComponentCalc.fixed,
    taxable: bool = True, insurable: bool = False, account_id: int | None = None,
    sort_order: int = 0, notes: str | None = None,
) -> SalaryComponent:
    clean = (name or "").strip()
    if not clean:
        raise PayrollSetupError("اسم البند مطلوب.")
    if db.scalar(select(SalaryComponent).where(SalaryComponent.name == clean)):
        raise PayrollSetupError("فيه بند بنفس الاسم.")
    row = SalaryComponent(
        code=(code or "").strip() or numbering.next_document_number(
            db, SalaryComponent, "SC", column=SalaryComponent.code, width=3),
        name=clean, kind=kind, calc=calc, taxable=taxable, insurable=insurable,
        account_id=account_id, sort_order=sort_order, notes=notes,
    )
    db.add(row)
    db.flush()
    audit_service.record(
        db, action="salary_component.create", actor_user_id=actor_user_id,
        entity_type="salary_component", entity_id=row.id,
        after={"name": clean, "kind": kind.value},
    )
    return row


# ------------------------------------------------------------------ الهيكل


def set_salary(
    db: Session, *, employee_id: int, effective_from: date, basic, actor_user_id: int,
    insurance_base=None, lines: list[dict] | None = None, notes: str | None = None,
    payment_method=None, bank_name: str | None = None, bank_account: str | None = None,
) -> EmployeeSalary:
    """بيحط هيكل راتب من تاريخ. الزيادة صف جديد بتاريخ جديد، مش تعديل للقديم."""
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise PayrollSetupError("الموظف غير موجود.")
    if to_money(Decimal(str(basic or 0))) < 0:
        raise PayrollSetupError("الأساسي مايكونش بالسالب.")

    row = db.scalar(select(EmployeeSalary).where(
        EmployeeSalary.employee_id == employee_id,
        EmployeeSalary.effective_from == effective_from))
    if row is None:
        row = EmployeeSalary(employee_id=employee_id, effective_from=effective_from)
        db.add(row)
    row.basic = basic
    row.insurance_base = insurance_base
    row.notes = notes
    row.actor_user_id = actor_user_id
    if payment_method is not None:
        row.payment_method = payment_method
    if bank_name is not None:
        row.bank_name = bank_name
    if bank_account is not None:
        row.bank_account = bank_account
    db.flush()

    if lines is not None:
        for old in db.scalars(select(EmployeeSalaryLine).where(
                EmployeeSalaryLine.salary_id == row.id)).all():
            db.delete(old)
        db.flush()
        for entry in lines:
            component_id = entry.get("component_id")
            if db.get(SalaryComponent, component_id) is None:
                raise PayrollSetupError("بند الراتب غير موجود.")
            db.add(EmployeeSalaryLine(
                salary_id=row.id, component_id=component_id,
                amount=entry.get("amount") or 0, pct=entry.get("pct"),
                notes=entry.get("notes"),
            ))
        db.flush()

    # `Employee.salary` بقى مرآة في اتجاه واحد للأساسي الحالي، عشان عمود المرتب في شاشة
    # الموظفين يفضل صادق. الهيكل هو الحقيقة، والحقل ده عرض.
    current = salary_on(db, employee_id, date.today())
    if current is not None and current.id == row.id:
        employee.salary = row.basic

    audit_service.record(
        db, action="employee_salary.set", actor_user_id=actor_user_id,
        entity_type="employee", entity_id=employee_id,
        after={"from": str(effective_from), "basic": str(row.basic)},
    )
    return row


def salary_on(db: Session, employee_id: int, day: date) -> EmployeeSalary | None:
    """هيكل الراتب الساري في اليوم ده — آخر واحد بدأ قبله أو فيه."""
    return db.scalar(
        select(EmployeeSalary)
        .where(EmployeeSalary.employee_id == employee_id,
               EmployeeSalary.effective_from <= day)
        .order_by(EmployeeSalary.effective_from.desc())
    )


def salary_breakdown(db: Session, salary: EmployeeSalary) -> dict:
    """الأساسي والبنود محسوبة — النسبة بتتحوّل مبلغ هنا مرة واحدة."""
    basic = to_money(Decimal(str(salary.basic or 0)))
    earnings, deductions = [], []
    insurable = basic
    taxable = basic

    lines = db.scalars(select(EmployeeSalaryLine).where(
        EmployeeSalaryLine.salary_id == salary.id)).all()
    for line in lines:
        component = db.get(SalaryComponent, line.component_id)
        if component is None or not component.active:
            continue
        if line.pct is not None:
            amount = to_money(basic * Decimal(str(line.pct)) / Decimal("100"))
        else:
            amount = to_money(Decimal(str(line.amount or 0)))
        entry = {"component_id": component.id, "name": component.name,
                 "kind": component.kind.value, "amount": str(amount)}
        if component.kind == ComponentKind.earning:
            earnings.append(entry)
            if component.insurable:
                insurable += amount
            if component.taxable:
                taxable += amount
        else:
            deductions.append(entry)

    earned = basic + sum(Decimal(e["amount"]) for e in earnings)
    return {
        "basic": str(basic),
        "earnings": earnings,
        "deductions": deductions,
        "gross": str(to_money(earned)),
        # الأجر التأميني المتفق عليه بيغلب الحساب — دي حاجة بتتفق مع التأمينات مش بتتحسب.
        "insurance_base": str(to_money(Decimal(str(salary.insurance_base)))
                              if salary.insurance_base is not None else insurable),
        "taxable_base": str(to_money(taxable)),
    }


# ------------------------------------------------------------------ الشرايح


def create_version(
    db: Session, *, scheme: SchemeKind, name: str, effective_from: date, actor_user_id: int,
    brackets: list[dict] | None = None, annual_exemption=None, annualise: bool = True,
    employee_pct=None, employer_pct=None, min_base=None, max_base=None,
    notes: str | None = None,
) -> PayrollSchemeVersion:
    clean = (name or "").strip()
    if not clean:
        raise PayrollSetupError("اسم الإصدار مطلوب.")
    clash = db.scalar(select(PayrollSchemeVersion).where(
        PayrollSchemeVersion.scheme == scheme,
        PayrollSchemeVersion.effective_from == effective_from))
    if clash is not None:
        raise PayrollSetupError("فيه إصدار بنفس تاريخ السريان.")

    row = PayrollSchemeVersion(
        scheme=scheme, name=clean, effective_from=effective_from,
        annual_exemption=annual_exemption, annualise=annualise,
        employee_pct=employee_pct, employer_pct=employer_pct,
        min_base=min_base, max_base=max_base, notes=notes, actor_user_id=actor_user_id,
    )
    db.add(row)
    db.flush()
    _replace_brackets(db, row, brackets or [])
    audit_service.record(
        db, action="scheme_version.create", actor_user_id=actor_user_id,
        entity_type="payroll_scheme_version", entity_id=row.id,
        after={"scheme": scheme.value, "from": str(effective_from)},
    )
    return row


def _replace_brackets(db: Session, version: PayrollSchemeVersion, brackets: list[dict]) -> None:
    for old in db.scalars(select(PayrollSchemeBracket).where(
            PayrollSchemeBracket.version_id == version.id)).all():
        db.delete(old)
    db.flush()
    ordered = sorted(brackets, key=lambda b: Decimal(str(b.get("from_amount") or 0)))
    previous_top: Decimal | None = None
    for index, band in enumerate(ordered, start=1):
        lower = Decimal(str(band.get("from_amount") or 0))
        upper = band.get("to_amount")
        # فجوة أو تداخل بين الشرايح معناه دخل بيتحاسب مرتين أو مابيتحاسبش خالص — والاتنين
        # بيطلعوا رقم ضريبة غلط من غير ما حاجة تشتكي.
        if previous_top is not None and lower != previous_top:
            raise PayrollSetupError(
                f"الشريحة رقم {index} بتبدأ من {lower} والسابقة انتهت عند {previous_top} — "
                "لازم يبقوا متصلين."
            )
        if upper is not None and Decimal(str(upper)) <= lower:
            raise PayrollSetupError(f"الشريحة رقم {index} نهايتها قبل بدايتها.")
        db.add(PayrollSchemeBracket(
            version_id=version.id, sequence=index, from_amount=lower,
            to_amount=upper, rate_pct=band.get("rate_pct") or 0,
            fixed_amount=band.get("fixed_amount") or 0,
        ))
        previous_top = Decimal(str(upper)) if upper is not None else None
    db.flush()


def assert_editable(db: Session, version: PayrollSchemeVersion) -> None:
    """إصدار استعمله مسير مرحّل مابيتعدّلش."""
    if version.locked:
        raise PayrollSetupError(
            "الشرايح دي استُخدمت في مرتب مرحّل — اعمل إصدار جديد بتاريخ سريان جديد."
        )


def update_version(
    db: Session, *, version_id: int, actor_user_id: int, brackets: list[dict] | None = None,
    **fields,
) -> PayrollSchemeVersion:
    version = db.get(PayrollSchemeVersion, version_id)
    if version is None:
        raise PayrollSetupError("الإصدار غير موجود.")
    assert_editable(db, version)
    for key, value in fields.items():
        if value is not None:
            setattr(version, key, value)
    if brackets is not None:
        _replace_brackets(db, version, brackets)
    db.flush()
    audit_service.record(
        db, action="scheme_version.update", actor_user_id=actor_user_id,
        entity_type="payroll_scheme_version", entity_id=version.id, after=fields,
    )
    return version


def version_on(db: Session, scheme: SchemeKind, day: date) -> PayrollSchemeVersion | None:
    """الإصدار الساري في اليوم ده — بالفترة، مش بالنهاردة.

    Resolved by the PAYROLL PERIOD so recomputing March reads March's rates. The run then stamps
    the id it resolved, which is the second half of the same guarantee.
    """
    return db.scalar(
        select(PayrollSchemeVersion)
        .where(PayrollSchemeVersion.scheme == scheme,
               PayrollSchemeVersion.active.is_(True),
               PayrollSchemeVersion.effective_from <= day)
        .order_by(PayrollSchemeVersion.effective_from.desc())
    )


def brackets_of(db: Session, version_id: int) -> list[Bracket]:
    rows = db.scalars(
        select(PayrollSchemeBracket)
        .where(PayrollSchemeBracket.version_id == version_id)
        .order_by(PayrollSchemeBracket.sequence)
    ).all()
    return [
        Bracket(
            from_amount=Decimal(str(r.from_amount)),
            to_amount=Decimal(str(r.to_amount)) if r.to_amount is not None else None,
            rate_pct=Decimal(str(r.rate_pct)),
            fixed_amount=Decimal(str(r.fixed_amount or 0)),
        )
        for r in rows
    ]


def lock_version(db: Session, version_id: int | None) -> None:
    """بيتقفل أول ما مسير مرحّل يستعمله."""
    if version_id is None:
        return
    version = db.get(PayrollSchemeVersion, version_id)
    if version is not None and not version.locked:
        version.locked = True
        db.flush()


# ------------------------------------------------------------------ الإعدادات


def settings(db: Session) -> PayrollSetting:
    """آخر صف هو الساري — ولو مافيش، بيتعمل واحد بالافتراضيات."""
    row = db.scalar(select(PayrollSetting).order_by(PayrollSetting.id.desc()))
    if row is None:
        row = PayrollSetting()
        db.add(row)
        db.flush()
    return row


def update_settings(db: Session, *, actor_user_id: int, **fields) -> PayrollSetting:
    current = settings(db)
    for key, value in fields.items():
        if value is not None:
            setattr(current, key, value)
    current.actor_user_id = actor_user_id
    db.flush()
    audit_service.record(
        db, action="payroll_setting.update", actor_user_id=actor_user_id,
        entity_type="payroll_setting", entity_id=current.id, after=fields,
    )
    return current
