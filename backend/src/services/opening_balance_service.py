"""Opening balances (005, T022).

Entered as one balanced journal entry: each account's opening amount posts on its **normal side**,
and the offsetting total posts to the singleton `opening_balance_equity` account. No special
storage — openings are ordinary ledger movement, so they flow through the trial balance like any
other entry (research R5; Principle VI). v1 supports normal-side openings only (spec assumption).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, Direction, LedgerEntry
from src.services import account_resolver, chart_service, journal_service
from src.services.journal_service import JournalError, JournalLineInput


@dataclass(frozen=True)
class OpeningLineInput:
    account_id: int
    amount: Decimal


def post_opening_balances(
    db: Session,
    *,
    entry_date: date,
    branch_id: int | None,
    lines: list[OpeningLineInput],
    actor_user_id: int,
) -> LedgerEntry:
    """Post opening balances against opening_balance_equity as one balanced entry."""
    if not lines:
        raise JournalError("Opening balances require at least one account line.")

    equity = account_resolver.opening_balance_equity_account(db)
    journal_lines: list[JournalLineInput] = []
    debit_sum = ZERO
    credit_sum = ZERO
    for ln in lines:
        if not chart_service.is_postable_leaf(db, ln.account_id):
            raise JournalError(f"Account {ln.account_id} is not a postable, active leaf.")
        acc = db.get(Account, ln.account_id)
        amount = to_money(ln.amount)
        # Opening posts on the account's normal side (assets debit; liab/equity/income credit).
        if acc.normal_side == Direction.debit:
            debit_sum += amount
        else:
            credit_sum += amount
        journal_lines.append(
            JournalLineInput(
                account_id=acc.id, direction=acc.normal_side, amount=amount,
                statement="رصيد افتتاحي",
            )
        )

    # The equity offset takes whichever side balances the net of the account lines.
    net = debit_sum - credit_sum
    if net != ZERO:
        offset_dir = Direction.credit if net > ZERO else Direction.debit
        journal_lines.append(
            JournalLineInput(
                account_id=equity.id, direction=offset_dir, amount=to_money(abs(net)),
                statement="إجمالي الأرصدة الافتتاحية",
            )
        )

    return journal_service.post_entry(
        db,
        entry_date=entry_date,
        description="الأرصدة الافتتاحية",
        branch_id=branch_id,
        lines=journal_lines,
        actor_user_id=actor_user_id,
        entry_type="opening_balance",
    )
