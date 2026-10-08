from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.stock import StockDirection, StockMovement


@dataclass
class Finding:
    check: str
    subject: str
    expected: str
    found: str
    detail: str = ""


@dataclass
class IntegrityReport:
    findings: list[Finding] = field(default_factory=list)
    checked: dict[str, int] = field(default_factory=dict)

    @property
    def clean(self) -> bool:
        return not self.findings


def _derived_on_hand(db: Session) -> dict[tuple[int, str, int], Decimal]:
    rows = db.execute(
        select(
            StockMovement.item_id,
            StockMovement.location_kind,
            StockMovement.location_id,
            StockMovement.direction,
            func.sum(StockMovement.quantity),
        ).group_by(
            StockMovement.item_id,
            StockMovement.location_kind,
            StockMovement.location_id,
            StockMovement.direction,
        )
    ).all()
    out: dict[tuple[int, str, int], Decimal] = {}
    for item_id, kind, loc_id, direction, total in rows:
        key = (int(item_id), kind.value if hasattr(kind, "value") else str(kind), int(loc_id))
        signed = to_qty(total or 0)
        if direction != StockDirection.in_:
            signed = -signed
        out[key] = to_qty(out.get(key, to_qty(0)) + signed)
    return out


def check_no_negative_stock(db: Session, report: IntegrityReport) -> None:
    balances = _derived_on_hand(db)
    report.checked["stock_balances"] = len(balances)
    zero = to_qty(0)
    for (item_id, kind, loc_id), qty in balances.items():
        if qty < zero:
            report.findings.append(Finding(
                check="no_negative_stock",
                subject=f"item {item_id} @ {kind}:{loc_id}",
                expected=">= 0",
                found=str(qty),
                detail="رصيد سالب — أي أن حركة مرّت دون المرور على بوابة المخزون.",
            ))


def check_batch_sums(db: Session, report: IntegrityReport) -> None:
    from src.models.catalog import StockBatch

    rows = db.execute(
        select(StockBatch.item_id, StockBatch.location_kind, StockBatch.location_id,
               func.sum(StockBatch.quantity))
        .group_by(StockBatch.item_id, StockBatch.location_kind, StockBatch.location_id)
    ).all()
    report.checked["batch_locations"] = len(rows)
    balances = _derived_on_hand(db)
    for item_id, kind, loc_id, total in rows:
        batched = to_qty(total or 0)
        key = (int(item_id), kind.value if hasattr(kind, "value") else str(kind), int(loc_id))
        derived = balances.get(key, to_qty(0))
        if batched != derived:
            report.findings.append(Finding(
                check="batch_sum_equals_on_hand",
                subject=f"item {item_id} @ {key[1]}:{loc_id}",
                expected=str(derived),
                found=str(batched),
                detail="مجموع دفعات الصلاحية مختلف عن الرصيد المشتق من الحركات.",
            ))


def check_serial_counts(db: Session, report: IntegrityReport) -> None:
    from src.models.catalog import ItemSerial, SerialStatus

    rows = db.execute(
        select(ItemSerial.item_id, ItemSerial.location_kind, ItemSerial.location_id, func.count())
        .where(ItemSerial.status == SerialStatus.in_stock)
        .group_by(ItemSerial.item_id, ItemSerial.location_kind, ItemSerial.location_id)
    ).all()
    report.checked["serial_locations"] = len(rows)
    balances = _derived_on_hand(db)
    for item_id, kind, loc_id, count in rows:
        if kind is None or loc_id is None:
            continue
        key = (int(item_id), kind.value if hasattr(kind, "value") else str(kind), int(loc_id))
        derived = balances.get(key, to_qty(0))
        if to_qty(count) != derived:
            report.findings.append(Finding(
                check="serial_count_equals_on_hand",
                subject=f"item {item_id} @ {key[1]}:{loc_id}",
                expected=str(derived),
                found=str(count),
                detail="عدد الأرقام التسلسلية في المخزن مختلف عن الرصيد المشتق.",
            ))


def check_ledger_entries_balanced(db: Session, report: IntegrityReport) -> None:
    from src.models.ledger import Direction, LedgerEntry, LedgerLine
    from src.services import ledger_service

    rows = db.execute(
        select(
            LedgerLine.entry_id,
            func.sum(
                case(
                    (LedgerLine.direction == Direction.debit, LedgerLine.amount), else_=0
                )
            ),
            func.sum(
                case(
                    (LedgerLine.direction == Direction.credit, LedgerLine.amount), else_=0
                )
            ),
        )
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(ledger_service.is_posted_sql())
        .group_by(LedgerLine.entry_id)
    ).all()
    report.checked["ledger_entries"] = len(rows)
    for entry_id, debit, credit in rows:
        if to_qty(debit or 0) != to_qty(credit or 0):
            report.findings.append(Finding(
                check="ledger_entry_balanced",
                subject=f"entry {entry_id}",
                expected=str(debit),
                found=str(credit),
                detail="قيد غير متوازن — سيكون ميزان المراجعة خاطئاً دون أن تُظهر أي شاشة خطأً.",
            ))


def check_customers_have_a_rep(db: Session, report: IntegrityReport) -> None:
    from src.models.customer import Customer
    from src.models.user import User

    total = db.scalar(select(func.count()).select_from(Customer)) or 0
    report.checked["customers"] = total

    missing = db.execute(
        select(Customer.id, Customer.name)
        .outerjoin(User, User.id == Customer.rep_id)
        .where(User.id.is_(None))
    ).all()
    for cid, name in missing:
        report.findings.append(Finding(
            check="customer_rep",
            subject=f"عميل #{cid} — {name or ''}".strip(),
            expected="مندوب موجود",
            found="مندوب محذوف أو غير محدد",
            detail="لن يظهر هذا العميل لأي مندوب في التطبيق ولا في كشوف المندوبين.",
        ))

    closed = db.execute(
        select(Customer.id, Customer.name, User.username)
        .join(User, User.id == Customer.rep_id)
        .where(User.active.is_(False))
    ).all()
    for cid, name, username in closed:
        report.findings.append(Finding(
            check="customer_rep",
            subject=f"عميل #{cid} — {name or ''}".strip(),
            expected="مندوب نشط",
            found=f"مندوب موقوف ({username})",
            detail="لا يزور أحد هذا العميل — انقله إلى مندوب آخر.",
        ))


def check_reps_have_a_store(db: Session, report: IntegrityReport) -> None:
    from src.models.employee import Employee
    from src.models.role import Role, RoleName
    from src.models.user import User
    from src.models.warehouse import Custody

    reps = db.execute(
        select(User.id, User.username, User.full_name)
        .join(Role, Role.id == User.role_id)
        .where(Role.name == RoleName.sales_rep, User.active.is_(True))
    ).all()
    report.checked["sales_reps"] = len(reps)

    for uid, username, full_name in reps:
        emp = db.scalar(select(Employee).where(Employee.user_id == uid))
        if emp is not None and emp.warehouse_id is not None:
            continue
        if db.scalar(select(Custody).where(Custody.rep_id == uid)) is not None:
            continue
        report.findings.append(Finding(
            check="rep_store",
            subject=f"مندوب {username} — {full_name or ''}".strip(),
            expected="مخزن أو عهدة",
            found="لا يوجد",
            detail="لا يستطيع هذا المندوب البيع من التطبيق — اربطه بمخزن من ملف الموظف.",
        ))


def run_all(db: Session) -> IntegrityReport:
    report = IntegrityReport()
    check_no_negative_stock(db, report)
    check_batch_sums(db, report)
    check_serial_counts(db, report)
    check_ledger_entries_balanced(db, report)
    check_customers_have_a_rep(db, report)
    check_reps_have_a_store(db, report)
    return report
