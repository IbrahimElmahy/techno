from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountNature, Direction, LedgerEntry, LedgerLine
from src.services import ledger_service
from src.models.supplier import Supplier, SupplierAccount


@dataclass(frozen=True)
class ReportLine:
    account_id: int
    code: str | None
    name: str | None
    amount: Decimal


@dataclass(frozen=True)
class IncomeStatement:
    date_from: date | None
    date_to: date | None
    income: list[ReportLine]
    expenses: list[ReportLine]
    total_income: Decimal
    total_expenses: Decimal
    net_profit: Decimal


@dataclass(frozen=True)
class BalanceSheet:
    as_of: date | None
    assets: list[ReportLine]
    liabilities: list[ReportLine]
    equity: list[ReportLine]
    total_assets: Decimal
    total_liabilities: Decimal
    total_equity: Decimal
    net_profit: Decimal
    balanced: bool


@dataclass
class AgingRow:
    party_id: int
    party_name: str
    total: Decimal = ZERO
    buckets: dict[str, Decimal] = field(default_factory=dict)


BUCKETS = ("0-30", "31-60", "61-90", "90+")


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def effective_nature(acc: Account) -> AccountNature | None:
    if acc.nature is not None:
        return acc.nature
    from src.services.chart_service import _NATURE_BY_TYPE

    return _NATURE_BY_TYPE.get(acc.account_type)


def _label(acc: Account) -> tuple[str | None, str | None]:
    if acc.name:
        return acc.code, acc.name
    if acc.owner_ref is not None:
        return acc.code, f"{acc.account_type.value}#{acc.owner_ref}"
    return acc.code, acc.account_type.value


def _movements(
    db: Session, *, date_from: date | None, date_to: date | None,
    posted_only: bool = True, branch_id: int | None = None,
) -> dict[int, Decimal]:
    eff = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    signed = case((LedgerLine.direction == Account.normal_side, LedgerLine.amount),
                  else_=-LedgerLine.amount)
    stmt = (
        select(LedgerLine.account_id, func.sum(signed))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .join(Account, Account.id == LedgerLine.account_id)
        .where(ledger_service.in_books_sql(posted_only))
        .group_by(LedgerLine.account_id)
    )
    if branch_id is not None:
        stmt = stmt.where(
            (LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    if date_from is not None:
        stmt = stmt.where(eff >= date_from)
    if date_to is not None:
        stmt = stmt.where(eff <= date_to)
    return {account_id: to_money(Decimal(str(total or 0)))
            for account_id, total in db.execute(stmt).all()}


def _by_nature(
    db: Session, totals: dict[int, Decimal], nature: AccountNature
) -> tuple[list[ReportLine], Decimal]:
    lines: list[ReportLine] = []
    total = ZERO
    for account_id, amount in totals.items():
        acc = db.get(Account, account_id)
        if acc is None or effective_nature(acc) != nature or amount == ZERO:
            continue
        code, name = _label(acc)
        lines.append(ReportLine(account_id=account_id, code=code, name=name,
                                amount=to_money(amount)))
        total += amount
    lines.sort(key=lambda r: (r.code or "", r.name or ""))
    return lines, to_money(total)


def income_statement(
    db: Session, *, date_from: date | None = None, date_to: date | None = None,
    posted_only: bool = True, branch_id: int | None = None,
) -> IncomeStatement:
    totals = _movements(db, date_from=date_from, date_to=date_to,
                        posted_only=posted_only, branch_id=branch_id)
    income, total_income = _by_nature(db, totals, AccountNature.income)
    expenses, total_expenses = _by_nature(db, totals, AccountNature.expense)
    return IncomeStatement(
        date_from=date_from, date_to=date_to, income=income, expenses=expenses,
        total_income=total_income, total_expenses=total_expenses,
        net_profit=to_money(total_income - total_expenses),
    )


def balance_sheet(db: Session, *, as_of: date | None = None,
                  posted_only: bool = True, branch_id: int | None = None) -> BalanceSheet:
    totals = _movements(db, date_from=None, date_to=as_of, posted_only=posted_only,
                        branch_id=branch_id)
    assets, total_assets = _by_nature(db, totals, AccountNature.asset)
    liabilities, total_liabilities = _by_nature(db, totals, AccountNature.liability)
    equity, total_equity = _by_nature(db, totals, AccountNature.equity)
    _, total_income = _by_nature(db, totals, AccountNature.income)
    _, total_expenses = _by_nature(db, totals, AccountNature.expense)
    net_profit = to_money(total_income - total_expenses)
    balanced = to_money(total_assets) == to_money(total_liabilities + total_equity + net_profit)
    return BalanceSheet(
        as_of=as_of, assets=assets, liabilities=liabilities, equity=equity,
        total_assets=total_assets, total_liabilities=total_liabilities,
        total_equity=total_equity, net_profit=net_profit, balanced=balanced,
    )


def _aging_for_accounts(
    db: Session, *, party_by_account: dict[int, int], names: dict[int, str], as_of: date,
    branch_id: int | None = None,
) -> list[AgingRow]:
    wanted = dict(party_by_account)
    if not wanted:
        return []
    eff = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    stmt = (
        select(LedgerLine.account_id, LedgerLine.amount, LedgerLine.direction,
               LedgerLine.amount_residual, LedgerLine.date_maturity, eff, Account.normal_side)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .join(Account, Account.id == LedgerLine.account_id)
        .where(LedgerLine.account_id.in_(list(wanted)), ledger_service.is_posted_sql(),
               eff <= as_of)
    )
    if branch_id is not None:
        stmt = stmt.where(
            (LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    rows = db.execute(stmt).all()

    per_party: dict[int, list[tuple[date, Decimal, bool]]] = {}
    tracked: dict[int, list[tuple[date, Decimal]]] = {}
    for account_id, amount, direction, amount_residual, date_maturity, when, normal_side in rows:
        party_id = wanted[account_id]
        if amount_residual is not None:
            residual = to_money(amount_residual)
            if residual == ZERO:
                continue
            signed = residual if normal_side == Direction.debit else -residual
            due = date_maturity or when
            tracked.setdefault(party_id, []).append((due, signed))
            continue
        is_charge = direction == normal_side
        per_party.setdefault(party_id, []).append(
            (when, to_money(amount), is_charge))

    result: list[AgingRow] = []
    rows_by_party: dict[int, AgingRow] = {}

    def bucket_of(when: date) -> str:
        age = (as_of - when).days
        return ("0-30" if age <= 30 else "31-60" if age <= 60
                else "61-90" if age <= 90 else "90+")

    def row_for(party_id: int) -> AgingRow:
        row = rows_by_party.get(party_id)
        if row is None:
            row = AgingRow(party_id=party_id, party_name=names.get(party_id, f"#{party_id}"),
                           buckets=dict.fromkeys(BUCKETS, ZERO))
            rows_by_party[party_id] = row
        return row

    for party_id, items in tracked.items():
        row = row_for(party_id)
        for due, signed in items:
            key = bucket_of(due)
            row.buckets[key] = to_money(row.buckets[key] + signed)
            row.total = to_money(row.total + signed)

    for party_id, movements in per_party.items():
        movements.sort(key=lambda m: m[0])
        charges: list[list] = []
        credit_pool = ZERO
        for when, amount, is_charge in movements:
            if is_charge:
                charges.append([when, amount])
            else:
                credit_pool += amount
        for charge in charges:
            if credit_pool <= ZERO:
                break
            applied = min(charge[1], credit_pool)
            charge[1] -= applied
            credit_pool -= applied

        row = row_for(party_id)
        for when, remaining in charges:
            if remaining <= ZERO:
                continue
            bucket = bucket_of(when)
            row.buckets[bucket] = to_money(row.buckets[bucket] + remaining)
            row.total = to_money(row.total + remaining)

    result = [row for row in rows_by_party.values() if row.total != ZERO]
    result.sort(key=lambda r: r.total, reverse=True)
    return result


_AGING_TTL_SECONDS = 60.0
_aging_cache: dict[tuple, tuple[float, list]] = {}


def _cached_aging(key: tuple, build):
    import time

    now = time.monotonic()
    hit = _aging_cache.get(key)
    if hit is not None and now - hit[0] < _AGING_TTL_SECONDS:
        return hit[1]
    value = build()
    _aging_cache[key] = (now, value)
    for k, (stamp, _v) in list(_aging_cache.items()):
        if now - stamp >= _AGING_TTL_SECONDS:
            _aging_cache.pop(k, None)
    return value


def receivables_aging(db: Session, *, as_of: date | None = None,
                      branch_id: int | None = None) -> list[AgingRow]:
    when = as_of or date.today()

    def build() -> list[AgingRow]:
        party_by_account = {
            acc.account_id: acc.customer_id
            for acc in db.scalars(select(CustomerAccount)).all()
        }
        names = {c.id: c.name for c in db.scalars(select(Customer)).all()}
        return _aging_for_accounts(db, party_by_account=party_by_account, names=names,
                                   as_of=when, branch_id=branch_id)

    return _cached_aging(("receivables", when, branch_id), build)


def payables_aging(db: Session, *, as_of: date | None = None,
                   branch_id: int | None = None) -> list[AgingRow]:
    when = as_of or date.today()

    def build() -> list[AgingRow]:
        party_by_account = {
            acc.account_id: acc.supplier_id
            for acc in db.scalars(select(SupplierAccount)).all()
        }
        names = {s.id: s.name for s in db.scalars(select(Supplier)).all()}
        return _aging_for_accounts(db, party_by_account=party_by_account, names=names,
                                   as_of=when, branch_id=branch_id)

    return _cached_aging(("payables", when, branch_id), build)


def income_statement_compared(db: Session, options, *, branch_id: int | None = None) -> dict:
    from src.services import report_options as ro

    current = income_statement(db, date_from=options.date_from, date_to=options.date_to,
                               posted_only=options.posted_only, branch_id=branch_id)
    out = {"current": current, "comparison": None, "comparison_label": None}
    if not options.compares:
        return out
    prev_from, prev_to = ro.comparison_window(options)
    out["comparison"] = income_statement(db, date_from=prev_from, date_to=prev_to,
                                         posted_only=options.posted_only, branch_id=branch_id)
    out["comparison_label"] = ro.comparison_label(options)
    return out


def balance_sheet_compared(db: Session, options, *, branch_id: int | None = None) -> dict:
    from src.services import report_options as ro

    current = balance_sheet(db, as_of=options.date_to, posted_only=options.posted_only,
                            branch_id=branch_id)
    out = {"current": current, "comparison": None, "comparison_label": None}
    if not options.compares:
        return out
    _, prev_to = ro.comparison_window(options)
    out["comparison"] = balance_sheet(db, as_of=prev_to, posted_only=options.posted_only,
                                      branch_id=branch_id)
    out["comparison_label"] = ro.comparison_label(options)
    return out


def delta(now, before) -> dict:
    now, before = to_money(now or 0), to_money(before or 0)
    diff = to_money(now - before)
    return {
        "amount": str(diff),
        "pct": str(to_money(diff / before * 100)) if before else None,
    }


def _tree_nodes(db: Session, totals: dict[int, Decimal], natures: set) -> list[dict]:
    accounts = {a.id: a for a in db.scalars(select(Account)).all()}
    nodes: dict[int, dict] = {}

    type_names = {"customer_receivable": "ذمم عملاء", "supplier_payable": "ذمم موردين",
                  "opening_balance_equity": "أرصدة افتتاحية"}

    def node(acc: Account) -> dict:
        n = nodes.get(acc.id)
        if n is None:
            code, name = _label(acc)
            if not acc.name:
                name = type_names.get(acc.account_type.value, name)
            n = {"account_id": acc.id, "code": code, "name": name, "amount": ZERO,
                 "children": [], "_kids": {}, "parent_id": acc.parent_id}
            nodes[acc.id] = n
        return n

    roots: dict[int, dict] = {}
    for account_id, amount in totals.items():
        acc = accounts.get(account_id)
        if acc is None or amount == ZERO:
            continue
        nature = effective_nature(acc)
        if nature not in natures:
            continue
        leaf = node(acc)
        leaf["amount"] += amount
        cur, child, seen = acc, leaf, {acc.id}
        while cur.parent_id and cur.parent_id not in seen and cur.parent_id in accounts:
            seen.add(cur.parent_id)
            parent_acc = accounts[cur.parent_id]
            parent = node(parent_acc)
            parent["amount"] += amount
            parent["_kids"][child["account_id"]] = child
            cur, child = parent_acc, parent
        roots[child["account_id"]] = child

    def finish(n: dict) -> dict:
        raw = [k for k in n["_kids"].values() if k["amount"] != ZERO]
        own = n["amount"] - sum((k["amount"] for k in raw), ZERO)
        kids = [finish(k) for k in raw]
        kids.sort(key=lambda k: (k["code"] or "", k["name"] or ""))
        if kids and own != ZERO:
            kids.insert(0, {"account_id": n["account_id"], "code": n["code"],
                            "name": f"{n['name']} (مباشر)", "amount": str(to_money(own)),
                            "children": []})
        return {"account_id": n["account_id"], "code": n["code"], "name": n["name"],
                "amount": str(to_money(n["amount"])), "children": kids}

    out = [finish(r) for r in roots.values() if r["amount"] != ZERO]
    out.sort(key=lambda k: (k["code"] or "", k["name"] or ""))
    return out


def balance_sheet_tree(db: Session, *, as_of: date | None = None, posted_only: bool = True,
                       branch_id: int | None = None) -> dict:
    totals = _movements(db, date_from=None, date_to=as_of, posted_only=posted_only,
                        branch_id=branch_id)
    assets = _tree_nodes(db, totals, {AccountNature.asset})
    liabilities = _tree_nodes(db, totals, {AccountNature.liability})
    equity = _tree_nodes(db, totals, {AccountNature.equity})

    def total(rows: list[dict]) -> Decimal:
        return to_money(sum((Decimal(r["amount"]) for r in rows), ZERO))

    accounts = {a.id: a for a in db.scalars(select(Account)).all()}
    income = expense = ZERO
    for account_id, amount in totals.items():
        acc = accounts.get(account_id)
        nature = effective_nature(acc) if acc else None
        if nature == AccountNature.income:
            income += amount
        elif nature == AccountNature.expense:
            expense += amount
    net = to_money(income - expense)
    ta, tl, te = total(assets), total(liabilities), total(equity)
    return {
        "as_of": as_of.isoformat() if as_of else None,
        "assets": assets, "liabilities": liabilities, "equity": equity,
        "total_assets": str(ta), "total_liabilities": str(tl), "total_equity": str(te),
        "net_profit": str(net), "balanced": ta == to_money(tl + te + net),
    }
