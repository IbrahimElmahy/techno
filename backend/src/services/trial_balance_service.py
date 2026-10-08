from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.services import chart_service, ledger_service


@dataclass
class _Bucket:
    opening: Decimal = ZERO
    period_debit: Decimal = ZERO
    period_credit: Decimal = ZERO

    @property
    def closing(self) -> Decimal:
        return self.opening + self.period_debit - self.period_credit


@dataclass
class TrialBalanceRow:
    account_id: int
    code: str | None
    name: str | None
    is_postable: bool
    opening: Decimal
    period_debit: Decimal
    period_credit: Decimal
    closing: Decimal
    nature: str | None = None


@dataclass
class TrialBalanceResult:
    from_date: date
    to_date: date
    branch_id: int | None
    rows: list[TrialBalanceRow] = field(default_factory=list)
    grand_total_debit: Decimal = ZERO
    grand_total_credit: Decimal = ZERO

    @property
    def balanced(self) -> bool:
        return self.grand_total_debit == self.grand_total_credit


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def _account_label(db: Session, acc: Account) -> str | None:
    if acc.name:
        return acc.name
    if acc.owner_ref is not None:
        return f"{acc.account_type.value}#{acc.owner_ref}"
    return acc.account_type.value


def trial_balance(
    db: Session,
    *,
    from_date: date,
    to_date: date,
    branch_id: int | None = None,
    include_groups: bool = True,
    cost_center_id: int | None = None,
) -> TrialBalanceResult:
    _accounts = db.scalars(select(Account)).all()
    eff = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    debit = case((LedgerLine.direction == Direction.debit, LedgerLine.amount), else_=0)
    credit = case((LedgerLine.direction == Direction.debit, 0), else_=LedgerLine.amount)
    before = eff < from_date
    stmt = (
        select(
            LedgerLine.account_id,
            func.sum(case((before, debit - credit), else_=0)),
            func.sum(case((before, 0), else_=debit)),
            func.sum(case((before, 0), else_=credit)),
        )
        .join(LedgerEntry, LedgerLine.entry_id == LedgerEntry.id)
        .where(ledger_service.is_posted_sql(), eff <= to_date)
        .group_by(LedgerLine.account_id)
    )
    if branch_id is not None:
        stmt = stmt.where(LedgerEntry.branch_id == branch_id)
    if cost_center_id is not None:
        from src.models.analytic import LedgerLineDistribution

        stmt = stmt.where(
            (LedgerLine.cost_center_id == cost_center_id)
            | LedgerLine.id.in_(
                select(LedgerLineDistribution.line_id).where(
                    LedgerLineDistribution.cost_center_id == cost_center_id)
            )
        )

    buckets: dict[int, _Bucket] = {}
    for account_id, opening, period_debit, period_credit in db.execute(stmt).all():
        b = buckets.setdefault(account_id, _Bucket())
        b.opening += to_money(Decimal(str(opening or 0)))
        b.period_debit += to_money(Decimal(str(period_debit or 0)))
        b.period_credit += to_money(Decimal(str(period_credit or 0)))

    result = TrialBalanceResult(from_date=from_date, to_date=to_date, branch_id=branch_id)

    leaf_rows: dict[int, TrialBalanceRow] = {}
    for account_id, b in buckets.items():
        acc = db.get(Account, account_id)
        if acc is None or not acc.is_postable:
            continue
        sign = 1 if acc.normal_side == Direction.debit else -1
        row = TrialBalanceRow(
            account_id=account_id,
            code=acc.code,
            name=_account_label(db, acc),
            is_postable=True,
            opening=to_money(b.opening * sign),
            period_debit=to_money(b.period_debit),
            period_credit=to_money(b.period_credit),
            closing=to_money(b.closing * sign),
            nature=acc.nature.value if acc.nature else None,
        )
        leaf_rows[account_id] = row
        result.grand_total_debit += row.period_debit
        result.grand_total_credit += row.period_credit

    result.grand_total_debit = to_money(result.grand_total_debit)
    result.grand_total_credit = to_money(result.grand_total_credit)

    rows: list[TrialBalanceRow] = list(leaf_rows.values())

    if include_groups:
        rows.extend(_group_rows(db, buckets))

    rows.sort(key=lambda r: (r.code or "~", r.account_id))
    result.rows = rows
    del _accounts
    return result


def _group_rows(db: Session, buckets: dict[int, _Bucket]) -> list[TrialBalanceRow]:
    group_acc: dict[int, _Bucket] = {}
    by_code = {a.code: a.id for a in db.scalars(select(Account)).all() if a.code}

    def parent_of(acc: Account) -> int | None:
        if acc.parent_id is not None:
            return acc.parent_id
        return by_code.get(chart_service._GROUP_CODE_BY_TYPE.get(acc.account_type))

    for account_id, b in buckets.items():
        acc = db.get(Account, account_id)
        if acc is None or not acc.is_postable:
            continue
        parent_id = parent_of(acc)
        guard = 0
        while parent_id is not None and guard < 64:
            gb = group_acc.setdefault(parent_id, _Bucket())
            gb.opening += b.opening
            gb.period_debit += b.period_debit
            gb.period_credit += b.period_credit
            parent = db.get(Account, parent_id)
            parent_id = parent.parent_id if parent else None
            guard += 1

    rows: list[TrialBalanceRow] = []
    for group_id, gb in group_acc.items():
        grp = db.get(Account, group_id)
        if grp is None:
            continue
        sign = 1 if grp.normal_side == Direction.debit else -1
        rows.append(
            TrialBalanceRow(
                account_id=group_id,
                code=grp.code,
                name=grp.name,
                is_postable=False,
                opening=to_money(gb.opening * sign),
                period_debit=to_money(gb.period_debit),
                period_credit=to_money(gb.period_credit),
                closing=to_money(gb.closing * sign),
                nature=grp.nature.value if grp.nature else None,
            )
        )
    return rows


def trial_balance_tree(
    db: Session, *, from_date: date, to_date: date, branch_id: int | None = None,
    cost_center_id: int | None = None,
) -> dict:
    accounts = {a.id: a for a in db.scalars(select(Account)).all()}
    by_code = {a.code: a.id for a in accounts.values() if a.code}

    def parent_of(acc: Account) -> int | None:
        if acc.parent_id is not None:
            return acc.parent_id
        return by_code.get(chart_service._GROUP_CODE_BY_TYPE.get(acc.account_type))

    eff = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    debit = case((LedgerLine.direction == Direction.debit, LedgerLine.amount), else_=0)
    credit = case((LedgerLine.direction == Direction.debit, 0), else_=LedgerLine.amount)
    before = eff < from_date
    stmt = (
        select(LedgerLine.account_id,
               func.sum(case((before, debit - credit), else_=0)),
               func.sum(case((before, 0), else_=debit)),
               func.sum(case((before, 0), else_=credit)))
        .join(LedgerEntry, LedgerLine.entry_id == LedgerEntry.id)
        .where(ledger_service.is_posted_sql(), eff <= to_date)
        .group_by(LedgerLine.account_id)
    )
    if branch_id is not None:
        stmt = stmt.where(LedgerEntry.branch_id == branch_id)
    if cost_center_id is not None:
        from src.models.analytic import LedgerLineDistribution

        stmt = stmt.where(
            (LedgerLine.cost_center_id == cost_center_id)
            | LedgerLine.id.in_(select(LedgerLineDistribution.line_id).where(
                LedgerLineDistribution.cost_center_id == cost_center_id)))

    nodes: dict[int, dict] = {}

    def node(acc: Account) -> dict:
        n = nodes.get(acc.id)
        if n is None:
            n = {"account_id": acc.id, "code": acc.code, "name": _account_label(db, acc),
                 "opening": ZERO, "debit": ZERO, "credit": ZERO, "kids": {}, "own": False}
            nodes[acc.id] = n
        return n

    roots: dict[int, dict] = {}
    for account_id, opening, period_debit, period_credit in db.execute(stmt).all():
        acc = accounts.get(account_id)
        if acc is None:
            continue
        o = to_money(Decimal(str(opening or 0)))
        d = to_money(Decimal(str(period_debit or 0)))
        c = to_money(Decimal(str(period_credit or 0)))
        if o == ZERO and d == ZERO and c == ZERO:
            continue
        leaf = node(acc)
        leaf["own"] = True
        cur, child, seen = acc, leaf, {acc.id}
        chain = [leaf]
        while True:
            pid = parent_of(cur)
            if pid is None or pid in seen or pid not in accounts:
                break
            seen.add(pid)
            parent = node(accounts[pid])
            parent["kids"][child["account_id"]] = child
            chain.append(parent)
            cur, child = accounts[pid], parent
        for n in chain:
            n["opening"] += o
            n["debit"] += d
            n["credit"] += c
        roots[child["account_id"]] = child

    def finish(n: dict) -> dict:
        kids = [finish(k) for k in n["kids"].values()]
        kids.sort(key=lambda k: (k["code"] or "~", k["name"] or ""))
        closing = n["opening"] + n["debit"] - n["credit"]
        return {"account_id": n["account_id"], "code": n["code"], "name": n["name"],
                "opening": str(to_money(n["opening"])), "debit": str(to_money(n["debit"])),
                "credit": str(to_money(n["credit"])), "closing": str(to_money(closing)),
                "children": kids}

    out = [finish(r) for r in roots.values()]
    out.sort(key=lambda k: (k["code"] or "~", k["name"] or ""))

    def split(v: Decimal) -> tuple[Decimal, Decimal]:
        return (v, ZERO) if v >= 0 else (ZERO, -v)

    tot = {"opening_debit": ZERO, "opening_credit": ZERO, "debit": ZERO, "credit": ZERO,
           "closing_debit": ZERO, "closing_credit": ZERO}
    for n in nodes.values():
        if not n["own"]:
            continue
        od, oc = split(n["opening"])
        cd, cc = split(n["opening"] + n["debit"] - n["credit"])
        tot["opening_debit"] += od
        tot["opening_credit"] += oc
        tot["debit"] += n["debit"]
        tot["credit"] += n["credit"]
        tot["closing_debit"] += cd
        tot["closing_credit"] += cc
    return {"from": from_date.isoformat(), "to": to_date.isoformat(), "branch_id": branch_id,
            "rows": out, "totals": {k: str(to_money(v)) for k, v in tot.items()}}
