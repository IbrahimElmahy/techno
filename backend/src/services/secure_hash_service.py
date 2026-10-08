from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from src.models.journal import Journal
from src.models.ledger import EntryState, LedgerEntry, LedgerLine


class HashChainError(Exception):
    pass


def journal_is_restricted(db: Session, journal_id: int | None) -> bool:
    if journal_id is None:
        return False
    return bool(db.scalar(select(Journal.restrict_mode_hash).where(Journal.id == journal_id)))


def is_hashed(entry: LedgerEntry) -> bool:
    return bool(getattr(entry, "inalterable_hash", None))


def assert_alterable(entry: LedgerEntry) -> None:
    if is_hashed(entry):
        raise HashChainError(
            f"القيد {entry.number or entry.id} في دفتر متجزّأ — مايتغيّرش ولا يتحذف. "
            "لو فيه غلط، اكتب قيد عكسي بتاريخ جديد."
        )


def canonical_string(entry: LedgerEntry) -> str:
    parts = [
        f"n={entry.number or ''}",
        f"d={entry.entry_date.isoformat() if entry.entry_date else ''}",
        f"j={entry.journal_id or ''}",
        f"t={entry.move_type or ''}",
        f"p={entry.partner_kind or ''}:{entry.partner_id or ''}",
    ]
    for line in sorted(entry.lines, key=lambda ln: ln.id or 0):
        direction = getattr(line.direction, "value", line.direction)
        parts.append(f"l={line.id}|{line.account_id}|{direction}|{line.amount}")
    return ";".join(parts)


def _digest(previous_hash: str | None, entry: LedgerEntry) -> str:
    payload = f"{previous_hash or ''}|{canonical_string(entry)}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _previous(db: Session, entry: LedgerEntry) -> LedgerEntry | None:
    if entry.secure_sequence_number is None:
        return None
    return db.scalar(
        select(LedgerEntry)
        .options(selectinload(LedgerEntry.lines))
        .where(
            LedgerEntry.journal_id == entry.journal_id,
            LedgerEntry.secure_sequence_number.is_not(None),
            LedgerEntry.secure_sequence_number < entry.secure_sequence_number,
        )
        .order_by(LedgerEntry.secure_sequence_number.desc())
        .limit(1)
    )


def stamp(db: Session, entry: LedgerEntry) -> None:
    if entry.inalterable_hash:
        return
    if not journal_is_restricted(db, entry.journal_id):
        return
    last = db.scalar(
        select(func.max(LedgerEntry.secure_sequence_number))
        .where(LedgerEntry.journal_id == entry.journal_id)
    )
    entry.secure_sequence_number = int(last or 0) + 1
    db.flush()
    previous = _previous(db, entry)
    entry.inalterable_hash = _digest(previous.inalterable_hash if previous else None, entry)


@dataclass
class JournalIntegrity:
    journal_id: int
    journal_code: str
    journal_name: str
    restricted: bool
    entries: int = 0
    first_number: str | None = None
    last_number: str | None = None
    first_date: date | None = None
    last_date: date | None = None
    intact: bool = True
    broken_entry_id: int | None = None
    broken_number: str | None = None
    problems: list[str] = field(default_factory=list)


def check_journal(db: Session, journal: Journal) -> JournalIntegrity:
    report = JournalIntegrity(
        journal_id=journal.id, journal_code=journal.code, journal_name=journal.name,
        restricted=bool(journal.restrict_mode_hash),
    )
    rows = db.scalars(
        select(LedgerEntry)
        .options(selectinload(LedgerEntry.lines))
        .where(
            LedgerEntry.journal_id == journal.id,
            LedgerEntry.secure_sequence_number.is_not(None),
        )
        .order_by(LedgerEntry.secure_sequence_number)
    ).all()
    if not rows:
        return report

    report.entries = len(rows)
    report.first_number = rows[0].number
    report.last_number = rows[-1].number
    report.first_date = rows[0].entry_date
    report.last_date = rows[-1].entry_date

    previous_hash: str | None = None
    expected_seq = rows[0].secure_sequence_number
    for entry in rows:
        if entry.secure_sequence_number != expected_seq:
            report.problems.append(
                f"فجوة في السلسلة عند {entry.number or entry.id}: "
                f"متوقع {expected_seq} ولقينا {entry.secure_sequence_number}."
            )
            expected_seq = entry.secure_sequence_number
        expected_seq += 1
        if entry.state != EntryState.posted.value:
            report.problems.append(
                f"القيد {entry.number or entry.id} متجزّأ وحالته «{entry.state}» — "
                "القيد المتجزّأ المفروض يفضل مرحّل."
            )
        if _digest(previous_hash, entry) != entry.inalterable_hash:
            report.intact = False
            report.broken_entry_id = entry.id
            report.broken_number = entry.number
            break
        previous_hash = entry.inalterable_hash
    return report


def check_all(db: Session) -> list[JournalIntegrity]:
    journals = db.scalars(select(Journal).order_by(Journal.sort_order, Journal.code)).all()
    reports = [check_journal(db, j) for j in journals]
    reports.sort(key=lambda r: (not r.restricted, r.journal_code))
    return reports
