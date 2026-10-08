"""الموارد البشرية — الأقسام ونهاية الخدمة (HR-1)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_HR_WRITE
from src.core.db import get_db
from src.models.employee import Employee, JobTitle
from src.models.hr_org import Department, EmployeeTermination, TerminationKind
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.services import ledger_service
from src.services import hr_service
from src.services.hr_service import HrError

router = APIRouter(tags=["hr"], prefix="/hr")


# ----------------------------------------------------------------- schemas


class DepartmentIn(BaseModel):
    name: str
    code: str | None = None
    parent_id: int | None = None
    manager_employee_id: int | None = None
    cost_center_id: int | None = None
    branch_id: int | None = None
    notes: str | None = None


class DepartmentPatch(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    manager_employee_id: int | None = None
    cost_center_id: int | None = None
    branch_id: int | None = None
    notes: str | None = None
    active: bool | None = None


class DepartmentOut(BaseModel):
    id: int
    code: str
    name: str
    parent_id: int | None
    parent_name: str | None = None
    manager_employee_id: int | None
    manager_name: str | None = None
    cost_center_id: int | None
    branch_id: int | None
    active: bool
    notes: str | None
    employee_count: int = 0


class TerminationIn(BaseModel):
    employee_id: int
    end_date: date
    kind: TerminationKind
    last_working_day: date | None = None
    reason: str | None = None
    settlement_amount: Decimal | None = None


class TerminationOut(BaseModel):
    id: int
    employee_id: int
    employee_name: str | None = None
    end_date: date
    last_working_day: date | None
    kind: TerminationKind
    reason: str | None
    settlement_amount: Decimal | None


def _counts(db: Session, current: CurrentUser | None = None) -> dict[int, int]:
    """عدد الموظفين النشطين في كل قسم — استعلام واحد مش واحد لكل صف.

    ومتعزل بالفرع زي قايمة الموظفين نفسها: قسم مالوش فرع (المبيعات مثلاً) ظاهر لكل الفروع،
    ومن غير العزل مدير فرع أكتوبر كان هيشوف «١٢ موظف» ولما يفتح القسم يلاقي ٣ — العدد لازم
    يطابق اللي هيتعرض لما يضغط عليه.
    """
    stmt = (
        select(Employee.department_id, func.count())
        .where(Employee.department_id.is_not(None), Employee.active.is_(True))
        .group_by(Employee.department_id)
    )
    if current is not None:
        stmt = branch_scope.scope(stmt, Employee, current)
    return {dept_id: n for dept_id, n in db.execute(stmt).all()}


def _seen_department(db: Session, department_id: int, current: CurrentUser) -> Department:
    """القسم لو اللي بيسأل يشوفه — و٤٠٤ لو لأ (نفس قاعدة `_seen_employee`).

    القايمة متعزلة بالفرع، فالرابط المباشر بالرقم لازم يتعزل هو كمان — وإلا مدير فرع
    بيعدّل أو يقفل أو يمسح قسم فرع تاني بمجرد إنه يعرف رقمه.
    """
    dept = db.scalar(branch_scope.scope(
        select(Department).where(Department.id == department_id), Department, current))
    if dept is None:
        raise HTTPException(404, {"code": "not_found", "message": "القسم غير موجود."})
    return dept


def _writable_department(db: Session, department_id: int, current: CurrentUser) -> Department:
    """القسم لو اللي بيسأل يقدر **يغيّره** — مش بس يشوفه.

    قسم فرع تاني: ٤٠٤ (من `_seen_department`). وقسم مالوش فرع (مشترك — زي اللي اتعمل من
    ترحيل النص القديم): بيظهر لموظف الفرع عشان موظفينه متسجّلين فيه، لكن تعديله أو إقفاله أو
    مسحه بيأثر على كل الفروع مرة واحدة — فده للّي فوق الفروع بس، مش لموظف فرع واحد.
    """
    dept = _seen_department(db, department_id, current)
    if dept.branch_id is None and not branch_scope.sees_all_branches(current):
        raise HTTPException(403, {"code": "shared_department",
                                  "message": "القسم ده مشترك بين الفروع — تعديله من الإدارة العامة."})
    return dept


def _scope_fields(db: Session, current: CurrentUser, fields: dict, *, creating: bool) -> None:
    """الفرع والروابط على مقاس اللي بيكتب — HR متفصّل بين الفروع.

    * موظف الفرع: القسم بياخد فرعه هو، دايماً — إنشاء أو نقل. من غير كده كان يقدر يعمل قسم
      «لفرع أكتوبر» من حساب العلياء، أو يسيبه فاضي فيبقى مشترك يظهر عند الكل.
    * القسم الأب والمدير لازم يكونوا ظاهرين له؛ رقم من فرع تاني بيترفض بنفس ٤٠٤ — مايتقالش
      له إن الرقم ده موجود عند حد تاني.
    """
    if not branch_scope.sees_all_branches(current) and (creating or "branch_id" in fields):
        fields["branch_id"] = current.branch_id
    if fields.get("parent_id") is not None:
        _seen_department(db, fields["parent_id"], current)
    if fields.get("manager_employee_id") is not None:
        mgr = db.get(Employee, fields["manager_employee_id"])
        if mgr is None or not branch_scope.may_see(current, mgr):
            raise HTTPException(404, {"code": "not_found", "message": "المدير المختار غير موجود."})


def _dept_out(db: Session, d: Department, counts: dict[int, int] | None = None) -> DepartmentOut:
    parent = db.get(Department, d.parent_id) if d.parent_id else None
    manager = db.get(Employee, d.manager_employee_id) if d.manager_employee_id else None
    counts = counts if counts is not None else _counts(db)
    return DepartmentOut(
        id=d.id, code=d.code, name=d.name, parent_id=d.parent_id,
        parent_name=parent.name if parent else None,
        manager_employee_id=d.manager_employee_id,
        manager_name=manager.name if manager else None,
        cost_center_id=d.cost_center_id, branch_id=d.branch_id,
        active=d.active, notes=d.notes, employee_count=counts.get(d.id, 0),
    )


def _term_out(db: Session, t: EmployeeTermination) -> TerminationOut:
    emp = db.get(Employee, t.employee_id)
    return TerminationOut(
        id=t.id, employee_id=t.employee_id, employee_name=emp.name if emp else None,
        end_date=t.end_date, last_working_day=t.last_working_day, kind=t.kind,
        reason=t.reason, settlement_amount=t.settlement_amount,
    )


# ------------------------------------------------------------- الأقسام


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(
    active_only: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[DepartmentOut]:
    stmt = branch_scope.scope(
        select(Department), Department, current
    ).order_by(Department.code)
    if active_only:
        stmt = stmt.where(Department.active.is_(True))
    counts = _counts(db, current)
    return [_dept_out(db, d, counts) for d in db.scalars(stmt).all()]


@router.post("/departments", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    body: DepartmentIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> DepartmentOut:
    fields = body.model_dump()
    _scope_fields(db, current, fields, creating=True)
    try:
        dept = hr_service.create_department(
            db, actor_user_id=current.id, **fields)
    except HrError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    out = _dept_out(db, dept, _counts(db, current))
    db.commit()
    return out


@router.get("/departments/{department_id}", response_model=DepartmentOut)
def get_department(
    department_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> DepartmentOut:
    dept = _seen_department(db, department_id, current)
    return _dept_out(db, dept, _counts(db, current))


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: int,
    body: DepartmentPatch,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> DepartmentOut:
    _writable_department(db, department_id, current)
    fields = body.model_dump(exclude_unset=True)
    _scope_fields(db, current, fields, creating=False)
    try:
        dept = hr_service.update_department(
            db, department_id=department_id, actor_user_id=current.id, **fields)
    except HrError as exc:
        code = "not_found" if "غير موجود" in str(exc) else "validation"
        raise HTTPException(404 if code == "not_found" else 422,
                            {"code": code, "message": str(exc)}) from exc
    out = _dept_out(db, dept, _counts(db, current))
    db.commit()
    return out


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_department(
    department_id: int,
    hard: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """بيتقفل، مابيتمسحش (FR-023) — و`hard=true` بيمسحه **بشرط إن مافيش حاجة مربوطة بيه**.

    نفس اتفاق المخازن والعملاء: الإقفال هو الافتراضي والمسح للغلط في الإدخال، والسيرفر بيرفض
    المسح بالأرقام لو القسم عليه موظف أو قسم فرعي أو مسير.
    """
    _writable_department(db, department_id, current)
    try:
        if hard:
            hr_service.delete_department(
                db, department_id=department_id, actor_user_id=current.id)
        else:
            hr_service.deactivate_department(
                db, department_id=department_id, actor_user_id=current.id)
    except HrError as exc:
        if "غير موجود" in str(exc):
            raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
        raise HTTPException(409, {"code": "validation", "message": str(exc)}) from exc
    db.commit()


@router.post("/departments/import-from-employees", status_code=status.HTTP_201_CREATED)
def import_departments(
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """بيحوّل نص «القسم» القديم لأقسام حقيقية — مرة واحدة، وبضغطة من المستخدم.

    للّي فوق الفروع بس: الترحيل بيلف على موظفين **كل** الفروع وبيعمل أقسام مشتركة، وده مش
    قرار موظف فرع واحد.
    """
    if not branch_scope.sees_all_branches(current):
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "ترحيل الأقسام القديمة من الإدارة العامة بس."})
    result = hr_service.import_departments_from_employees(db, actor_user_id=current.id)
    db.commit()
    return result


# ------------------------------------------------------ نهاية الخدمة


@router.get("/terminations", response_model=list[TerminationOut])
def list_terminations(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[TerminationOut]:
    stmt = select(EmployeeTermination).order_by(EmployeeTermination.end_date.desc())
    # نهاية الخدمة مالهاش فرع — فرعها فرع الموظف.
    stmt = branch_scope.scope_by_employee(stmt, EmployeeTermination.employee_id, current)
    if date_from:
        stmt = stmt.where(EmployeeTermination.end_date >= date_from)
    if date_to:
        stmt = stmt.where(EmployeeTermination.end_date <= date_to)
    return [_term_out(db, t) for t in db.scalars(stmt).all()]


@router.post("/terminations", response_model=TerminationOut,
             status_code=status.HTTP_201_CREATED)
def terminate_employee(
    body: TerminationIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> TerminationOut:
    if not branch_scope.may_touch_employee(db, current, body.employee_id):
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    try:
        row = hr_service.terminate(db, actor_user_id=current.id, **body.model_dump())
    except HrError as exc:
        if "غير موجود" in str(exc):
            raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
        code = "duplicate" if "قبل كده" in str(exc) else "validation"
        raise HTTPException(409 if code == "duplicate" else 422,
                            {"code": code, "message": str(exc)}) from exc
    out = _term_out(db, row)
    db.commit()
    return out


@router.delete("/terminations/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def reinstate_employee(
    employee_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    """بيلغي نهاية خدمة اتسجّلت بالغلط — ده تصحيح إدخال مش حذف بيانات."""
    if not branch_scope.may_touch_employee(db, current, employee_id):
        raise HTTPException(404, {"code": "not_found", "message": "الموظف غير موجود."})
    try:
        hr_service.reinstate(db, employee_id=employee_id, actor_user_id=current.id)
    except HrError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    db.commit()


# --------------------------------------------------- ذمم الموظفين (HR-2)


class EmployeeReceivableOut(BaseModel):
    """سطر واحد في كشف ذمم الموظفين."""

    employee_id: int | None = None
    employee_code: str | None = None
    employee_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    branch_id: int | None = None
    active: bool | None = None
    account_id: int
    account_code: str
    account_name: str
    debit: Decimal
    credit: Decimal
    balance: Decimal
    lines: int


class EmployeeReceivablesOut(BaseModel):
    rows: list[EmployeeReceivableOut]
    total_debit: Decimal
    total_credit: Decimal
    total_balance: Decimal
    # موظف مسجّل ومالوش حساب ذمة — مش صفر، «مش متربط».
    unlinked_employees: int


# «ذمم الموظفين» في شجرة a5 — مجموعة لكل فرع، وأسماؤها متطابقة.
_RECEIVABLE_GROUPS = ("A5M-22", "AL-A5M-22")


@router.get("/employee-receivables", response_model=EmployeeReceivablesOut)
def employee_receivables(
    q: str | None = Query(None, description="بحث بالاسم أو الكود"),
    branch_id: int | None = Query(None),
    only_nonzero: bool = Query(True, description="اللي عليهم رصيد بس"),
    include_orphans: bool = Query(True, description="حسابات الذمم اللي مالهاش موظف"),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> EmployeeReceivablesOut:
    """كشف «سلفت مين وكام» — الموظف وحسابه ورصيده.

    **الرصيد بيتحسب من الدفتر، مابيتخزّنش.** المخزّن هو `receivable_account_id` —
    أي حركة تترحّل على الحساب بتبان هنا في نفس اللحظة، ومافيش رقمين لنفس الذمة.

    **والحسابات اللي مالهاش موظف بتبان برضه** (`include_orphans`): «عهدة سيارة
    الفيوم» و«فرع اكتوبر» دلاء محاسبية عليها فلوس فعلاً، وإخفاؤها بيخلي مجموع
    الصفحة أقل من مجموع المجموعة في ميزان المراجعة — رقمين مختلفين لنفس الحاجة.
    """
    agg = (select(LedgerLine.account_id,
                  func.coalesce(func.sum(case(
                      (LedgerLine.direction == Direction.debit, LedgerLine.amount),
                      else_=0)), 0),
                  func.coalesce(func.sum(case(
                      (LedgerLine.direction == Direction.credit, LedgerLine.amount),
                      else_=0)), 0),
                  func.count())
           # المرحّل بس — ذمة الموظف مالهاش دعوة بمسودة لسه ماتّرحّلتش.
           .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
           .where(ledger_service.is_posted_sql())
           .group_by(LedgerLine.account_id))
    stats = {a: (d, c, n) for a, d, c, n in db.execute(agg).all()}

    groups = db.scalars(select(Account)
                        .where(Account.code.in_(_RECEIVABLE_GROUPS))).all()
    leaves = []
    if groups:
        leaves = db.scalars(select(Account).where(
            Account.parent_id.in_([g.id for g in groups]))).all()
    by_id = {a.id: a for a in leaves}

    emps = db.scalars(select(Employee)
                      .where(Employee.receivable_account_id.is_not(None))).all()
    titles = {t.id: t.name for t in db.scalars(select(JobTitle)).all()}

    rows: list[EmployeeReceivableOut] = []
    claimed: set[int] = set()
    for e in emps:
        a = by_id.get(e.receivable_account_id)
        if a is None:
            continue
        claimed.add(a.id)
        d, c, n = stats.get(a.id, (Decimal(0), Decimal(0), 0))
        rows.append(EmployeeReceivableOut(
            employee_id=e.id, employee_code=e.code, employee_name=e.name,
            job_title=titles.get(e.job_title_id), department=e.department,
            branch_id=e.branch_id, active=e.active,
            account_id=a.id, account_code=a.code, account_name=a.name,
            debit=Decimal(d), credit=Decimal(c),
            balance=Decimal(d) - Decimal(c), lines=n))

    if include_orphans:
        for a in leaves:
            if a.id in claimed:
                continue
            d, c, n = stats.get(a.id, (Decimal(0), Decimal(0), 0))
            rows.append(EmployeeReceivableOut(
                account_id=a.id, account_code=a.code, account_name=a.name,
                debit=Decimal(d), credit=Decimal(c),
                balance=Decimal(d) - Decimal(c), lines=n))

    if branch_id is not None:
        # الحساب اللي مالوش موظف مالوش فرع كمان — بيتقاس ببادئة كوده.
        want = _branch_prefix(db, branch_id)
        rows = [r for r in rows
                if (r.branch_id == branch_id if r.employee_id
                    else r.account_code.startswith(want))]
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in (
            (r.employee_name or "") + (r.employee_code or "")
            + r.account_name + r.account_code).lower()]
    if only_nonzero:
        rows = [r for r in rows if r.balance != 0]

    rows.sort(key=lambda r: abs(r.balance), reverse=True)
    unlinked = db.scalar(select(func.count()).select_from(Employee)
                         .where(Employee.receivable_account_id.is_(None),
                                Employee.active.is_(True))) or 0
    return EmployeeReceivablesOut(
        rows=rows,
        total_debit=sum((r.debit for r in rows), Decimal(0)),
        total_credit=sum((r.credit for r in rows), Decimal(0)),
        total_balance=sum((r.balance for r in rows), Decimal(0)),
        unlinked_employees=unlinked)


def _branch_prefix(db: Session, branch_id: int) -> str:
    """بادئة كود حسابات الفرع — `AL-` للعلياء وفاضي لأكتوبر."""
    from src.models.org import Branch

    b = db.get(Branch, branch_id)
    return "AL-" if b is not None and (b.name or "").strip() == "العلياء" else "A5"
