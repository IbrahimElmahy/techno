"""فحص سلامة البيانات — read-only checks that the stored data still agrees with itself.

Their أدوات خاصة offers «مراجعه المخازن»، «مراجعة رصيد القيود»، «مراجعه السرايل» — jobs that
*recompute and repair*. Those exist because their system stores derived balances, and a stored
balance can drift away from the movements it was supposed to summarise.

Ours does not store them. `StockLocator` holds no quantity; on-hand is always summed from
`stock_movement`, and a ledger account's balance is always summed from its lines. There is nothing
to recompute, because nothing was ever cached to go stale.

Two things *are* stored alongside the movements and so can genuinely disagree with them:

* **expiry batches** (011) — quantity per lot, whose sum must equal the derived on-hand;
* **serial numbers** (009) — one row per unit, whose in-stock count must equal it too.

So this module reports rather than repairs. That is the important difference: if a check fails, it
means a code path wrote one side without the other, and silently "fixing" the numbers would hide the
bug that produced them — the next occurrence would be repaired just as quietly, and nobody would
ever learn why the counts drifted. A failure here is a defect to be traced, not a number to be
patched, so this returns findings and touches nothing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import to_qty
from src.models.stock import StockDirection, StockMovement


@dataclass
class Finding:
    """One disagreement, named precisely enough to be traced back to the code that caused it."""

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
    """On-hand per (item, location kind, location id), summed from the movements themselves."""
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
    """The invariant the whole system is built on: no item is ever negative anywhere.

    Enforced at write time by `stock_service.post_movement`, which is the only way stock moves. This
    check is not redundant with that: it is how we find out if some path ever managed to go around
    it, which is the one failure that would make every cost and profit figure downstream a guess.
    """
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
                detail="رصيد سالب — معناه إن حركة عدّت من غير ما تمرّ على بوابة المخزون.",
            ))


def check_batch_sums(db: Session, report: IntegrityReport) -> None:
    """Σ(batch quantity) == derived on-hand, per perishable item × location (011).

    This is the invariant 011 rests on, written down in `StockBatch` itself: receive, FEFO sale and
    return each move both sides together, so the lots cannot drift from the stock ledger. Checking it
    is how we would find out if some path ever moved only one side.
    """
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
    """In-stock serial count == derived on-hand, per serialized item × location (009).

    `ItemSerial` states the rule: every status change is paired with a quantity movement, so the
    in-stock count at a location equals the derived on-hand there.
    """
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
    """Every entry's debits equal its credits.

    `ledger_service` refuses to post an unbalanced entry, so this should never fire — which is
    exactly why it is worth running. An unbalanced entry would make the trial balance wrong without
    making any single screen look wrong, and that is the hardest kind of error to notice.
    """
    from src.models.ledger import Direction, LedgerLine

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
        ).group_by(LedgerLine.entry_id)
    ).all()
    report.checked["ledger_entries"] = len(rows)
    for entry_id, debit, credit in rows:
        if to_qty(debit or 0) != to_qty(credit or 0):
            report.findings.append(Finding(
                check="ledger_entry_balanced",
                subject=f"entry {entry_id}",
                expected=str(debit),
                found=str(credit),
                detail="قيد غير متوازن — ميزان المراجعة هيبقى غلط من غير ما شاشة تبان غلط.",
            ))


def run_all(db: Session) -> IntegrityReport:
    """Run every check. Read-only — nothing here writes, by design."""
    report = IntegrityReport()
    check_no_negative_stock(db, report)
    check_batch_sums(db, report)
    check_serial_counts(db, report)
    check_ledger_entries_balanced(db, report)
    return report
