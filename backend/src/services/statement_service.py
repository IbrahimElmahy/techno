from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.lib import entry_text
from src.core.money import ZERO, to_money
from src.models.cost_center import CostCenter
from src.models.user import User
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.models.reconcile import PartialReconcile
from src.services import ledger_service, reconcile_service


class StatementError(Exception):
    pass


@dataclass(frozen=True)
class StatementLine:
    entry_id: int
    entry_date: date
    entry_type: str
    description: str
    debit: Decimal
    credit: Decimal
    balance_before: Decimal
    balance: Decimal
    cost_center_id: int | None = None
    cost_center_name: str | None = None
    rep_id: int | None = None
    rep_name: str | None = None
    account_id: int | None = None
    account_name: str | None = None
    line_id: int | None = None
    residual: Decimal | None = None
    due_date: date | None = None
    days_overdue: int | None = None
    payment_state: str | None = None
    payment_state_label: str | None = None
    matches: tuple = ()
    cash_on_invoice: bool = False
    account_balance_before: Decimal | None = None
    account_balance: Decimal | None = None


@dataclass(frozen=True)
class AccountSummary:
    account_id: int
    account_name: str
    code: str | None
    normal_side: str
    opening: Decimal
    debit: Decimal
    credit: Decimal
    closing: Decimal
    lines: int


@dataclass(frozen=True)
class AgingBuckets:
    current: Decimal = ZERO
    d30: Decimal = ZERO
    d60: Decimal = ZERO
    d90: Decimal = ZERO
    older: Decimal = ZERO
    total: Decimal = ZERO
    debit_open: Decimal = ZERO
    credit_open: Decimal = ZERO


@dataclass(frozen=True)
class Statement:
    account_id: int
    account_name: str
    opening_balance: Decimal
    closing_balance: Decimal
    total_debit: Decimal
    total_credit: Decimal
    lines: list[StatementLine]
    main_account_id: int | None = None
    main_account_name: str | None = None
    total_due: Decimal = ZERO
    total_overdue: Decimal = ZERO
    aging: AgingBuckets = AgingBuckets()
    reconcilable: bool = False
    normal_side: str | None = None
    account_summaries: tuple[AccountSummary, ...] = ()


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def _matches_by_line(db: Session, line_ids: list[int]) -> dict[int, list[dict]]:
    if not line_ids:
        return {}
    wanted = set(line_ids)
    pairs = db.scalars(
        select(PartialReconcile).where(
            (PartialReconcile.debit_line_id.in_(wanted))
            | (PartialReconcile.credit_line_id.in_(wanted))
        )
    ).all()
    if not pairs:
        return {}

    other_ids = set()
    for pair in pairs:
        other_ids.add(pair.debit_line_id)
        other_ids.add(pair.credit_line_id)
    others = {
        line.id: line
        for line in db.scalars(
            select(LedgerLine).options(selectinload(LedgerLine.entry))
            .where(LedgerLine.id.in_(other_ids))
        ).all()
    }

    out: dict[int, list[dict]] = {}
    for pair in pairs:
        for mine, theirs in ((pair.debit_line_id, pair.credit_line_id),
                             (pair.credit_line_id, pair.debit_line_id)):
            if mine not in wanted:
                continue
            other = others.get(theirs)
            entry = other.entry if other is not None else None
            out.setdefault(mine, []).append({
                "line_id": theirs,
                "entry_id": entry.id if entry else None,
                "entry_number": entry.number if entry else None,
                "entry_type": entry.entry_type if entry else None,
                "entry_date": (_effective_date(entry).isoformat() if entry else None),
                "amount": str(to_money(pair.amount)),
                "full": pair.full_reconcile_id is not None,
            })
    return out


def payment_terms_days(db: Session) -> int:
    from src.models.accounting_setting import AccountingSetting

    row = db.scalar(select(AccountingSetting).limit(1))
    return int(getattr(row, "payment_terms_days", 0) or 0)


def due_date_of(line: LedgerLine, when: date, terms: int) -> date:
    if line.date_maturity:
        return line.date_maturity
    return when + timedelta(days=terms) if terms else when


def _days_overdue(line: LedgerLine, when: date, as_of: date, terms: int = 0) -> int | None:
    if line.amount_residual is None or to_money(line.amount_residual) == ZERO:
        return None
    days = (as_of - due_date_of(line, when, terms)).days
    return days if days > 0 else None


def _age_bucket(days: int) -> str:
    if days <= 0:
        return "current"
    if days <= 30:
        return "d30"
    if days <= 60:
        return "d60"
    if days <= 90:
        return "d90"
    return "older"


def due_summary(
    db: Session, *, account_ids: Sequence[int], as_of: date | None = None,
) -> tuple[Decimal, Decimal, AgingBuckets]:
    today = as_of or date.today()
    terms = payment_terms_days(db)
    rows = db.scalars(
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(list(account_ids)),
               LedgerLine.amount_residual.isnot(None),
               ledger_service.is_posted_sql())
    ).all()

    buckets = {"current": ZERO, "d30": ZERO, "d60": ZERO, "d90": ZERO, "older": ZERO}
    total = overdue = debit_open = credit_open = ZERO
    for line in rows:
        residual = to_money(line.amount_residual)
        if residual == ZERO:
            continue
        when = _effective_date(line.entry)
        if when > today:
            continue
        total += residual
        if residual > ZERO:
            debit_open += residual
        else:
            credit_open += -residual
        days = (today - due_date_of(line, when, terms)).days
        buckets[_age_bucket(days)] += residual
        if days > 0 and residual > ZERO:
            overdue += residual

    return (
        to_money(total),
        to_money(overdue),
        AgingBuckets(
            current=to_money(buckets["current"]), d30=to_money(buckets["d30"]),
            d60=to_money(buckets["d60"]), d90=to_money(buckets["d90"]),
            older=to_money(buckets["older"]), total=to_money(total),
            debit_open=to_money(debit_open), credit_open=to_money(credit_open),
        ),
    )


@dataclass(frozen=True)
class _WholeCash:
    when: date
    entry: LedgerEntry
    account_id: int
    cash: Decimal
    doc_number: str
    cost_center_id: int | None
    side: Direction


@dataclass(frozen=True)
class _CashKind:
    side: Direction
    model: type
    party_col: object
    party_ids: set[int]
    accounts: set[int]
    account_of: Callable[[object], int | None]
    skip: Callable[[object], bool]


def _sales_cash(db: Session, ids: Sequence[int]) -> _CashKind | None:
    from src.models.customer import CustomerAccount
    from src.models.sales import SalesInvoice

    links = {ca.account_id: ca for ca in db.scalars(
        select(CustomerAccount).where(CustomerAccount.account_id.in_(list(ids)))).all()}
    if not links:
        return None
    customer_ids = {ca.customer_id for ca in links.values()}
    all_accounts: dict[int, list[CustomerAccount]] = {}
    for ca in db.scalars(select(CustomerAccount).where(
            CustomerAccount.customer_id.in_(customer_ids))).all():
        all_accounts.setdefault(ca.customer_id, []).append(ca)

    def account_of(inv) -> int | None:
        own = all_accounts.get(inv.customer_id, [])
        if inv.family is not None:
            hit = next((a for a in own if a.family == inv.family), None)
            if hit is not None:
                return hit.account_id
        if len(own) == 1:
            return own[0].account_id
        if inv.family is None:
            plain = next((a for a in own if a.family is None), None)
            return plain.account_id if plain is not None else None
        return None

    return _CashKind(side=Direction.debit, model=SalesInvoice,
                     party_col=SalesInvoice.customer_id, party_ids=customer_ids,
                     accounts=set(links), account_of=account_of,
                     skip=lambda inv: bool(inv.is_bonus))


def _purchase_cash(db: Session, ids: Sequence[int]) -> _CashKind | None:
    from src.models.purchasing import PurchaseInvoice
    from src.models.supplier import SupplierAccount

    links = {sa.supplier_id: sa.account_id for sa in db.scalars(
        select(SupplierAccount).where(SupplierAccount.account_id.in_(list(ids)))).all()}
    if not links:
        return None
    return _CashKind(side=Direction.credit, model=PurchaseInvoice,
                     party_col=PurchaseInvoice.supplier_id, party_ids=set(links),
                     accounts=set(links.values()),
                     account_of=lambda inv: links.get(inv.supplier_id),
                     skip=lambda inv: False)


def _cash_on_invoices(
    db: Session, *, ids: Sequence[int], rows: Sequence[LedgerLine],
    window: Sequence[tuple[date, LedgerLine]], date_from: date | None, date_to: date | None,
) -> tuple[dict[int, tuple[Decimal, Decimal, str, Direction]], list[_WholeCash]]:
    split: dict[int, tuple[Decimal, Decimal, str, Direction]] = {}
    whole: list[_WholeCash] = []
    touched = {line.entry_id for line in rows}
    for kind in (_sales_cash(db, ids), _purchase_cash(db, ids)):
        if kind is None:
            continue
        model = kind.model

        wanted = {line.entry_id for _w, line in window if line.account_id in kind.accounts}
        if wanted:
            invoices = {
                inv.ledger_entry_id: inv
                for inv in db.scalars(select(model).where(
                    model.ledger_entry_id.in_(wanted), model.cash_amount > 0)).all()
                if not kind.skip(inv)
            }
            done: set[int] = set()
            for _w, line in window:
                inv = invoices.get(line.entry_id)
                if inv is None or line.account_id not in kind.accounts or line.entry_id in done:
                    continue
                cash = to_money(inv.cash_amount)
                on_credit = to_money(inv.credit_amount)
                amount = to_money(line.amount)
                if line.direction == kind.side and on_credit > ZERO and amount == on_credit:
                    due = on_credit + cash
                elif (line.direction != kind.side and on_credit < ZERO
                      and amount == -on_credit and cash + on_credit > ZERO):
                    due = cash + on_credit
                else:
                    continue
                split[line.id] = (to_money(due), cash, inv.document_number, kind.side)
                done.add(line.entry_id)

        for inv, entry in db.execute(
            select(model, LedgerEntry)
            .join(LedgerEntry, LedgerEntry.id == model.ledger_entry_id)
            .where(kind.party_col.in_(kind.party_ids),
                   model.cash_amount > 0, model.credit_amount == 0,
                   ledger_service.is_posted_sql())
        ).all():
            if kind.skip(inv) or entry.id in touched:
                continue
            when = _effective_date(entry)
            if ((date_from is not None and when < date_from)
                    or (date_to is not None and when > date_to)):
                continue
            account_id = kind.account_of(inv)
            if account_id is None or account_id not in kind.accounts:
                continue
            whole.append(_WholeCash(
                when=when, entry=entry, account_id=account_id, cash=to_money(inv.cash_amount),
                doc_number=inv.document_number, cost_center_id=inv.cost_center_id,
                side=kind.side))
    return split, whole


def _newest_first(lines: list[StatementLine]) -> list[StatementLine]:
    blocks: list[list[StatementLine]] = []
    for ln in lines:
        prev = blocks[-1][-1] if blocks else None
        if (ln.cash_on_invoice and prev is not None and not prev.cash_on_invoice
                and prev.entry_id == ln.entry_id and prev.account_id == ln.account_id):
            blocks[-1].append(ln)
        else:
            blocks.append([ln])
    return [ln for block in reversed(blocks) for ln in block]


def _with_descendants(db: Session, ids: list[int]) -> list[int]:
    kids: dict[int, list[int]] = {}
    for aid, parent_id in db.execute(
        select(Account.id, Account.parent_id).where(Account.parent_id.is_not(None))
    ).all():
        kids.setdefault(parent_id, []).append(aid)
    out = list(dict.fromkeys(ids))
    seen = set(out)
    stack = [i for i in out if i in kids]
    while stack:
        for kid in kids.get(stack.pop(), ()):
            if kid not in seen:
                seen.add(kid)
                out.append(kid)
                stack.append(kid)
    return out


def account_statement(
    db: Session, *, account_id: int, date_from: date | None = None,
    date_to: date | None = None, also_accounts: Sequence[int] = (),
) -> Statement:
    ids = _with_descendants(db, [account_id, *[a for a in also_accounts if a != account_id]])
    accounts = {a.id: a for a in db.scalars(select(Account).where(Account.id.in_(ids))).all()}
    account = accounts.get(account_id)
    if account is None:
        raise StatementError("الحساب غير موجود.")

    rows = db.scalars(
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(ids), ledger_service.is_posted_sql())
    ).all()

    cost_centers = {c.id: c.name for c in db.scalars(select(CostCenter)).all()}
    from src.services import chart_service
    owner_names = chart_service.bulk_owner_names(db, list(accounts.values()))
    def name_of(aid: int) -> str:
        a = accounts.get(aid)
        if a is None:
            return f"#{aid}"
        return a.name or owner_names.get(aid) or f"#{aid}"
    reps = {u.id: (u.full_name or u.username)
            for u in db.scalars(select(User)).all()}

    def signed(line: LedgerLine) -> Decimal:
        amount = to_money(line.amount)
        side = accounts[line.account_id].normal_side
        return amount if line.direction == side else -amount

    dated = sorted(
        ((_effective_date(line.entry), line) for line in rows),
        key=lambda pair: (pair[0], pair[1].entry_id, pair[1].id),
    )

    opening = ZERO
    openings: dict[int, Decimal] = {}
    window: list[tuple[date, LedgerLine]] = []
    for when, line in dated:
        if date_from is not None and when < date_from:
            moved = signed(line)
            opening += moved
            openings[line.account_id] = openings.get(line.account_id, ZERO) + moved
            continue
        if date_to is not None and when > date_to:
            continue
        window.append((when, line))

    balance = to_money(opening)
    total_debit = total_credit = ZERO
    lines: list[StatementLine] = []
    acct_balance: dict[int, Decimal] = {aid: to_money(v) for aid, v in openings.items()}
    acct_debit: dict[int, Decimal] = {}
    acct_credit: dict[int, Decimal] = {}
    acct_lines: dict[int, int] = {}
    matches = _matches_by_line(db, [line.id for _when, line in window])
    as_of = date_to or date.today()
    terms = payment_terms_days(db)
    split, whole = _cash_on_invoices(db, ids=ids, rows=rows, window=window,
                                     date_from=date_from, date_to=date_to)

    def emit(*, when: date, entry: LedgerEntry, account_id: int, debit: Decimal,
             credit: Decimal, description: str, cost_center_id: int | None,
             line: LedgerLine | None = None, cash_row: bool = False) -> None:
        nonlocal balance, total_debit, total_credit
        total_debit += debit
        total_credit += credit
        before = balance
        side = accounts[account_id].normal_side
        moved = (debit - credit) if side == Direction.debit else (credit - debit)
        balance = to_money(balance + moved)
        acct_before = acct_balance.get(account_id, ZERO)
        acct_after = to_money(acct_before + moved)
        acct_balance[account_id] = acct_after
        acct_debit[account_id] = acct_debit.get(account_id, ZERO) + debit
        acct_credit[account_id] = acct_credit.get(account_id, ZERO) + credit
        acct_lines[account_id] = acct_lines.get(account_id, 0) + 1
        lines.append(StatementLine(
            entry_id=entry.id, entry_date=when, entry_type=entry.entry_type,
            description=description,
            debit=debit, credit=credit, balance_before=before, balance=balance,
            cost_center_id=cost_center_id,
            cost_center_name=cost_centers.get(cost_center_id),
            rep_id=entry.rep_id,
            rep_name=reps.get(entry.rep_id),
            account_id=account_id,
            account_name=name_of(account_id),
            line_id=line.id if line is not None else None,
            residual=(to_money(line.amount_residual)
                      if line is not None and line.amount_residual is not None else None),
            due_date=due_date_of(line, when, terms) if line is not None else None,
            days_overdue=(_days_overdue(line, when, as_of, terms)
                          if line is not None else None),
            payment_state=entry.payment_state,
            payment_state_label=reconcile_service.PAYMENT_STATE_LABEL.get(
                entry.payment_state or ""),
            matches=tuple(matches.get(line.id, ())) if line is not None else (),
            cash_on_invoice=cash_row,
            account_balance_before=acct_before,
            account_balance=acct_after,
        ))

    items: list[tuple] = [(when, line.entry_id, line.id, line, None) for when, line in window]
    items += [(w.when, w.entry.id, 0, None, w) for w in whole]
    items.sort(key=lambda it: (it[0], it[1], it[2]))

    def pair(side: Direction, amount: Decimal) -> tuple[Decimal, Decimal]:
        return (amount, ZERO) if side == Direction.debit else (ZERO, amount)

    for when, _eid, _lid, line, cash_inv in items:
        if cash_inv is not None:
            debit, credit = pair(cash_inv.side, cash_inv.cash)
            emit(when=when, entry=cash_inv.entry, account_id=cash_inv.account_id,
                 debit=debit, credit=credit,
                 description=entry_text.arabic(cash_inv.entry.description),
                 cost_center_id=cash_inv.cost_center_id)
            emit(when=when, entry=cash_inv.entry, account_id=cash_inv.account_id,
                 debit=credit, credit=debit,
                 description=f"مدفوع نقداً مع الفاتورة {cash_inv.doc_number}",
                 cost_center_id=cash_inv.cost_center_id, cash_row=True)
            continue

        amount = to_money(line.amount)
        is_debit = line.direction.value == "debit"
        description = line.statement or entry_text.arabic(line.entry.description)
        cut = split.get(line.id)
        if cut is not None:
            due, cash, doc_number, side = cut
            on_side = line.direction == side
            debit, credit = pair(side, due)
            emit(when=when, entry=line.entry, account_id=line.account_id, debit=debit,
                 credit=credit, description=description, cost_center_id=line.cost_center_id,
                 line=line if on_side else None)
            debit, credit = pair(side, cash)
            emit(when=when, entry=line.entry, account_id=line.account_id, debit=credit,
                 credit=debit, description=f"مدفوع نقداً مع الفاتورة {doc_number}",
                 cost_center_id=line.cost_center_id,
                 line=None if on_side else line, cash_row=True)
            continue
        emit(when=when, entry=line.entry, account_id=line.account_id,
             debit=amount if is_debit else ZERO, credit=ZERO if is_debit else amount,
             description=description, cost_center_id=line.cost_center_id, line=line)

    lines = _newest_first(lines)

    reconcilable = reconcile_service.is_reconcilable(account)
    total_due = total_overdue = ZERO
    aging = AgingBuckets()
    if reconcilable:
        total_due, total_overdue, aging = due_summary(db, account_ids=ids, as_of=date_to)

    summaries = []
    for aid in ids:
        acc = accounts.get(aid)
        if acc is None:
            continue
        first = to_money(openings.get(aid, ZERO))
        count = acct_lines.get(aid, 0)
        if not count and first == ZERO:
            continue
        summaries.append(AccountSummary(
            account_id=aid, account_name=name_of(aid), code=acc.code,
            normal_side=acc.normal_side.value, opening=first,
            debit=to_money(acct_debit.get(aid, ZERO)),
            credit=to_money(acct_credit.get(aid, ZERO)),
            closing=to_money(acct_balance.get(aid, first)), lines=count,
        ))
    summaries.sort(key=lambda s: (s.code or "", s.account_name))

    parent = db.get(Account, account.parent_id) if account.parent_id else None
    return Statement(
        account_id=account_id, account_name=name_of(account_id),
        main_account_id=parent.id if parent else None,
        main_account_name=(parent.name or f"#{parent.id}") if parent else None,
        opening_balance=to_money(opening), closing_balance=balance,
        total_debit=to_money(total_debit), total_credit=to_money(total_credit), lines=lines,
        total_due=total_due, total_overdue=total_overdue, aging=aging,
        reconcilable=reconcilable,
        normal_side=account.normal_side.value,
        account_summaries=tuple(summaries),
    )
