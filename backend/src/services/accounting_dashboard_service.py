from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.journal import JOURNAL_KIND_LABEL, Journal
from src.models.ledger import Direction, EntryState, LedgerEntry, LedgerLine
from src.models.treasury import Treasury
from src.services import ledger_service


def _month_bounds(today: date | None = None) -> tuple[date, date]:
    day = today or date.today()
    first = day.replace(day=1)
    return first, day


def _effective_date_col():
    return func.coalesce(LedgerEntry.entry_date, func.date(LedgerEntry.created_at))


def journal_cards(db: Session, *, as_of: date | None = None) -> list[dict]:
    first, day = _month_bounds(as_of)
    journals = db.scalars(
        select(Journal).where(Journal.active.is_(True))
        .order_by(Journal.sort_order, Journal.code)
    ).all()
    if not journals:
        return []

    drafts = dict(db.execute(
        select(LedgerEntry.journal_id, func.count(LedgerEntry.id))
        .where(LedgerEntry.state == EntryState.draft.value)
        .group_by(LedgerEntry.journal_id)
    ).all())

    month = {
        jid: (count, total)
        for jid, count, total in db.execute(
            select(
                LedgerEntry.journal_id,
                func.count(func.distinct(LedgerEntry.id)),
                func.coalesce(func.sum(
                    case((LedgerLine.direction == Direction.debit, LedgerLine.amount), else_=0)
                ), 0),
            )
            .join(LedgerLine, LedgerLine.entry_id == LedgerEntry.id)
            .where(ledger_service.is_posted_sql(),
                   _effective_date_col() >= first,
                   _effective_date_col() <= day)
            .group_by(LedgerEntry.journal_id)
        ).all()
    }

    open_residual = dict(db.execute(
        select(LedgerEntry.journal_id, func.coalesce(func.sum(func.abs(
            LedgerLine.amount_residual)), 0))
        .join(LedgerLine, LedgerLine.entry_id == LedgerEntry.id)
        .where(ledger_service.is_posted_sql(),
               LedgerLine.amount_residual.is_not(None),
               LedgerLine.amount_residual != 0)
        .group_by(LedgerEntry.journal_id)
    ).all())

    last = {
        jid: (number, when)
        for jid, number, when in db.execute(
            select(LedgerEntry.journal_id, LedgerEntry.number, _effective_date_col())
            .where(ledger_service.is_posted_sql(), LedgerEntry.number.is_not(None))
            .order_by(LedgerEntry.journal_id, LedgerEntry.id.desc())
            .distinct(LedgerEntry.journal_id)
        ).all()
    } if db.bind.dialect.name == "postgresql" else _last_per_journal_portable(db)

    cards: list[dict] = []
    for j in journals:
        count, total = month.get(j.id, (0, 0))
        number, when = last.get(j.id, (None, None))
        cards.append({
            "id": j.id,
            "code": j.code,
            "name": j.name,
            "kind": j.kind,
            "kind_label": JOURNAL_KIND_LABEL.get(j.kind, j.kind),
            "restrict_mode_hash": bool(j.restrict_mode_hash),
            "draft_count": int(drafts.get(j.id, 0)),
            "month_entries": int(count),
            "month_total": str(to_money(Decimal(str(total or 0)))),
            "open_residual": str(to_money(Decimal(str(open_residual.get(j.id, 0) or 0)))),
            "last_number": number,
            "last_date": str(when) if when else None,
        })
    return cards


def _last_per_journal_portable(db: Session) -> dict:
    out: dict = {}
    for jid, number, when in db.execute(
        select(LedgerEntry.journal_id, LedgerEntry.number, _effective_date_col())
        .where(ledger_service.is_posted_sql(), LedgerEntry.number.is_not(None))
        .order_by(LedgerEntry.id)
    ).all():
        out[jid] = (number, when)
    return out


def treasury_cards(db: Session) -> list[dict]:
    rows = db.scalars(
        select(Treasury).where(Treasury.active.is_(True)).order_by(Treasury.id)
    ).all()
    return [{
        "id": t.id,
        "name": t.name,
        "kind": getattr(t.kind, "value", t.kind),
        "bank_name": t.bank_name,
        "is_default": bool(t.is_default),
        "balance": str(to_money(ledger_service.balance_of(db, t.account_id) or ZERO)),
    } for t in rows]


def dashboard(db: Session, *, as_of: date | None = None) -> dict:
    return {
        "journals": journal_cards(db, as_of=as_of),
        "treasuries": treasury_cards(db),
    }
