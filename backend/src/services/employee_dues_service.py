from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee, JobTitle
from src.models.hr_advance import AdvanceStatus, EmployeeAdvance, EmployeeAdvanceInstalment
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.services import ledger_service

RECEIVABLE_GROUPS = ("A5M-22", "AL-A5M-22", "FC-A5M-22")


@dataclass
class DueRow:
    employee_id: int | None = None
    employee_code: str | None = None
    employee_name: str | None = None
    job_title: str | None = None
    department: str | None = None
    branch_id: int | None = None
    active: bool | None = None
    account_id: int | None = None
    account_code: str | None = None
    account_name: str | None = None
    customer_id: int | None = None
    ledger_debit: Decimal = ZERO
    ledger_credit: Decimal = ZERO
    ledger_balance: Decimal = ZERO
    ledger_lines: int = 0
    last_ledger_date: date | None = None
    advances_outstanding: Decimal | None = None
    open_advances: int | None = None
    remaining_instalments: int | None = None
    next_instalment_year: int | None = None
    next_instalment_month: int | None = None
    next_instalment_amount: Decimal | None = None
    last_advance_date: date | None = None
    total_due: Decimal = ZERO
    last_movement: date | None = None


@dataclass
class DuesResult:
    rows: list[DueRow] = field(default_factory=list)
    unlinked_employees: int = 0


def _leaves(db: Session) -> tuple[dict[int, Account], dict[int, int | None]]:
    groups = db.scalars(select(Account).where(Account.code.in_(RECEIVABLE_GROUPS))).all()
    if not groups:
        return {}, {}
    group_branch = {g.id: g.branch_id for g in groups}
    leaves = db.scalars(select(Account).where(
        Account.parent_id.in_(list(group_branch)))).all()
    return ({a.id: a for a in leaves},
            {a.id: a.branch_id or group_branch.get(a.parent_id) for a in leaves})


def _ledger_stats(db: Session, account_ids: list[int]) -> dict[int, tuple]:
    if not account_ids:
        return {}
    stmt = (select(
        LedgerLine.account_id,
        func.coalesce(func.sum(case(
            (LedgerLine.direction == Direction.debit, LedgerLine.amount), else_=0)), 0),
        func.coalesce(func.sum(case(
            (LedgerLine.direction == Direction.credit, LedgerLine.amount), else_=0)), 0),
        func.count(),
        func.max(LedgerEntry.entry_date))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(ledger_service.is_posted_sql(), LedgerLine.account_id.in_(account_ids))
        .group_by(LedgerLine.account_id))
    return {a: (Decimal(d), Decimal(c), n, last) for a, d, c, n, last in db.execute(stmt).all()}


def _in_receivable(db: Session, advances: list[EmployeeAdvance],
                   receivable_of: dict[int, int | None]) -> set[int]:
    pairs = {(a.ledger_entry_id, receivable_of.get(a.employee_id)): a.id for a in advances
             if a.ledger_entry_id and receivable_of.get(a.employee_id)}
    if not pairs:
        return set()
    hits = db.execute(select(LedgerLine.entry_id, LedgerLine.account_id).where(
        LedgerLine.entry_id.in_([e for e, _ in pairs]))).all()
    return {pairs[(e, acc)] for e, acc in hits if (e, acc) in pairs}


def employee_dues(
    db: Session, *, branch_id: int | None, q: str | None = None,
    only_open: bool = True, include_orphans: bool = True, with_advances: bool = True,
) -> DuesResult:
    leaves, leaf_branch = _leaves(db)

    emp_stmt = select(Employee)
    if branch_id is not None:
        emp_stmt = emp_stmt.where(or_(Employee.branch_id == branch_id,
                                      Employee.branch_id.is_(None)))
    emps = db.scalars(emp_stmt).all()
    emp_ids = [e.id for e in emps]
    receivable_of = {e.id: e.receivable_account_id for e in emps}

    claimed = {e.receivable_account_id for e in emps if e.receivable_account_id}
    all_claimed = set(db.scalars(select(Employee.receivable_account_id).where(
        Employee.receivable_account_id.is_not(None))).all())
    orphans = []
    if include_orphans:
        orphans = [a for a in leaves.values() if a.id not in all_claimed
                   and (branch_id is None or leaf_branch.get(a.id) in (branch_id, None))]
    extra_ids = [i for i in claimed if i not in leaves]
    accounts = dict(leaves)
    if extra_ids:
        accounts.update({a.id: a for a in db.scalars(
            select(Account).where(Account.id.in_(extra_ids))).all()})
    stats = _ledger_stats(db, list(claimed) + [a.id for a in orphans])

    cards: dict[int, int] = {}
    acc_ids = list(claimed) + [a.id for a in orphans]
    if acc_ids:
        for acc_id, cust_id in db.execute(
                select(CustomerAccount.account_id, Customer.id)
                .join(Customer, Customer.id == CustomerAccount.customer_id)
                .where(Customer.customer_type == "employee",
                       CustomerAccount.account_id.in_(acc_ids))
                .order_by(Customer.id)).all():
            cards.setdefault(acc_id, cust_id)

    open_by_emp: dict[int, list[EmployeeAdvance]] = {}
    last_adv: dict[int, date] = {}
    pending: dict[int, list[EmployeeAdvanceInstalment]] = {}
    skip: set[int] = set()
    if with_advances and emp_ids:
        advs = db.scalars(select(EmployeeAdvance).where(
            EmployeeAdvance.employee_id.in_(emp_ids),
            EmployeeAdvance.status != AdvanceStatus.cancelled)).all()
        for a in advs:
            if a.employee_id not in last_adv or a.advance_date > last_adv[a.employee_id]:
                last_adv[a.employee_id] = a.advance_date
            if a.status == AdvanceStatus.active:
                open_by_emp.setdefault(a.employee_id, []).append(a)
        open_ids = [a.id for lst in open_by_emp.values() for a in lst]
        if open_ids:
            for p in db.scalars(select(EmployeeAdvanceInstalment).where(
                    EmployeeAdvanceInstalment.advance_id.in_(open_ids),
                    EmployeeAdvanceInstalment.payroll_line_id.is_(None))
                    .order_by(EmployeeAdvanceInstalment.year,
                              EmployeeAdvanceInstalment.month)).all():
                pending.setdefault(p.advance_id, []).append(p)
        skip = _in_receivable(db, [a for lst in open_by_emp.values() for a in lst],
                              receivable_of)

    titles = {t.id: t.name for t in db.scalars(select(JobTitle)).all()}

    def fill_ledger(row: DueRow, acc: Account | None) -> None:
        if acc is None:
            return
        row.account_id, row.account_code, row.account_name = acc.id, acc.code, acc.name
        row.customer_id = cards.get(acc.id)
        d, c, n, last = stats.get(acc.id, (ZERO, ZERO, 0, None))
        row.ledger_debit, row.ledger_credit = to_money(d), to_money(c)
        row.ledger_balance = to_money(d - c)
        row.ledger_lines, row.last_ledger_date = n, last

    rows: list[DueRow] = []
    for e in emps:
        row = DueRow(employee_id=e.id, employee_code=e.code, employee_name=e.name,
                     job_title=titles.get(e.job_title_id), department=e.department,
                     branch_id=e.branch_id, active=e.active)
        fill_ledger(row, accounts.get(e.receivable_account_id)
                    if e.receivable_account_id else None)
        added = ZERO
        if with_advances:
            mine = open_by_emp.get(e.id, [])
            parts = [p for a in mine for p in pending.get(a.id, [])]
            outstanding = to_money(sum((Decimal(str(p.amount)) for p in parts), ZERO))
            row.advances_outstanding = outstanding
            row.open_advances = len(mine)
            row.remaining_instalments = len(parts)
            if parts:
                nxt = min(parts, key=lambda p: (p.year, p.month))
                row.next_instalment_year, row.next_instalment_month = nxt.year, nxt.month
                row.next_instalment_amount = to_money(sum(
                    (Decimal(str(p.amount)) for p in parts
                     if (p.year, p.month) == (nxt.year, nxt.month)), ZERO))
            row.last_advance_date = last_adv.get(e.id)
            added = to_money(sum((Decimal(str(p.amount)) for a in mine if a.id not in skip
                                  for p in pending.get(a.id, [])), ZERO))
        row.total_due = to_money(row.ledger_balance + added)
        dates = [d for d in (row.last_ledger_date, row.last_advance_date) if d]
        row.last_movement = max(dates) if dates else None
        rows.append(row)

    for a in orphans:
        row = DueRow(branch_id=leaf_branch.get(a.id))
        fill_ledger(row, a)
        row.total_due = row.ledger_balance
        row.last_movement = row.last_ledger_date
        rows.append(row)

    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in " ".join(filter(None, (
            r.employee_name, r.employee_code, r.account_name, r.account_code))).lower()]
    if only_open:
        rows = [r for r in rows if r.total_due != 0 or r.ledger_balance != 0
                or (r.open_advances or 0) > 0]
    else:
        rows = [r for r in rows if r.employee_id is not None or r.ledger_lines]

    rows.sort(key=lambda r: (abs(r.total_due), r.employee_name or ""), reverse=True)
    unlinked_stmt = select(func.count()).select_from(Employee).where(
        Employee.receivable_account_id.is_(None), Employee.active.is_(True))
    if branch_id is not None:
        unlinked_stmt = unlinked_stmt.where(or_(Employee.branch_id == branch_id,
                                                Employee.branch_id.is_(None)))
    return DuesResult(rows=rows, unlinked_employees=db.scalar(unlinked_stmt) or 0)
