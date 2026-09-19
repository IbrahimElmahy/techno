"""Income statement, balance sheet and receivables aging — 020-finance-reports.

All three read the same ledger the trial balance reads; nothing is stored. Accounts are
classified by their `nature`, so a user-defined chart account lands in the right statement
without any extra bookkeeping.

Aging reads the **residual** left on each line after reconciliation (المرحلة ٣) and buckets
it by the line's own due date. The line that has no residual yet — written before the phase-3
backfill ran — falls back to the old rule: apply credits against debits oldest-first per
party. الاتنين بيشتغلوا جنب بعض في نفس التقرير عشان النقل مايحتاجش وقفة.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
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
    net_profit: Decimal          # current-period result, folded into equity
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
    """The account's classification.

    System accounts (treasury, receivables, revenue, …) only carry an explicit `nature` once
    the standard chart has been seeded; before that it is NULL. Falling back to the type map
    keeps the statements correct on any database instead of silently dropping those balances.
    """
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
    """account_id -> signed movement (by the account's normal side) within the window.

    `branch_id` بيحصر القراءة على فرع واحد. ده قلب التقارير المالية كلها — قائمة
    الدخل والميزانية وميزان المراجعة بيعدّوا من هنا — فالفلترة هنا بتقفل التلاتة
    مرة واحدة بدل ما تتكرر في كل تقرير.

    القيد اللي مالوش فرع (`NULL`) بيدخل مع الكل: دي قيود اتكتبت قبل ما العزل
    يتعمل، وإخفاؤها بيخلّي الميزانية تنقص من غير سبب ظاهر.
    """
    stmt = (
        select(LedgerLine).options(selectinload(LedgerLine.entry),
                                   selectinload(LedgerLine.account))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        # «المرحّل بس» افتراضياً؛ «كل القيود» بتضم المسودة. الملغي بره في الحالتين.
        .where(ledger_service.in_books_sql(posted_only))
    )
    if branch_id is not None:
        stmt = stmt.where(
            (LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    rows = db.scalars(stmt).all()
    totals: dict[int, Decimal] = {}
    for line in rows:
        when = _effective_date(line.entry)
        if date_from is not None and when < date_from:
            continue
        if date_to is not None and when > date_to:
            continue
        amount = to_money(line.amount)
        signed = amount if line.direction == line.account.normal_side else -amount
        totals[line.account_id] = totals.get(line.account_id, ZERO) + signed
    return totals


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
    """قائمة الدخل — الإيرادات ناقص المصروفات خلال الفترة."""
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
    """الميزانية — الأصول = الالتزامات + حقوق الملكية (متضمنة أرباح الفترة)."""
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
    db: Session, *, account_by_party: dict[int, int], names: dict[int, str], as_of: date,
    branch_id: int | None = None,
) -> list[AgingRow]:
    """FIFO-apply credits against debits per party, then bucket what is left by age."""
    wanted = {account_id: party_id for party_id, account_id in account_by_party.items()}
    if not wanted:
        return []
    stmt = (
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry), selectinload(LedgerLine.account))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(list(wanted)), ledger_service.is_posted_sql())
    )
    if branch_id is not None:
        stmt = stmt.where(
            (LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    rows = db.scalars(stmt).all()

    # السطر اللي ليه متبقّي بيتقرا من متبقّيه بتاريخ استحقاقه؛ واللي لسه NULL (قبل ما
    # سكربت النقل يعدّي) بياخد الطريقة القديمة. الفصل ده مؤقت بطبعه وبيفضى لوحده.
    per_party: dict[int, list[tuple[date, Decimal, bool]]] = {}
    tracked: dict[int, list[tuple[date, Decimal]]] = {}
    for line in rows:
        when = _effective_date(line.entry)
        if when > as_of:
            continue
        party_id = wanted[line.account_id]
        if line.amount_residual is not None:
            residual = to_money(line.amount_residual)
            if residual == ZERO:
                continue  # اتقفل — مش مستحق ولا بيقدّم عمر
            # الإشارة: مدين موجب. للدائنين (الحساب دائن بطبعه) بنقلبها عشان «المستحق»
            # يطلع موجب في التقريرين.
            signed = residual if line.account.normal_side == Direction.debit else -residual
            due = line.date_maturity or when
            tracked.setdefault(party_id, []).append((due, signed))
            continue
        is_charge = line.direction == line.account.normal_side  # debit for AR, credit for AP
        per_party.setdefault(party_id, []).append(
            (when, to_money(line.amount), is_charge))

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
        charges: list[list] = []  # [date, remaining]
        credit_pool = ZERO
        for when, amount, is_charge in movements:
            if is_charge:
                charges.append([when, amount])
            else:
                credit_pool += amount
        # Oldest charge is settled first.
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


# --------------------------------------------------------- كاش قصير لأعمار الديون
#
# **الحساب ده تقيل، وبيتنده من شاشتين مع بعض.**
#
# `_aging_for_accounts` بتحمّل كل سطور الدفتر على حسابات العملاء وبتقاصّها واحد واحد.
# قِيس: أربع ثواني ونص. وكارت «المتبقي آجل على العملاء» في سجل الفواتير بينده عليها
# كمان — يعني كل دخلة على أكتر شاشة بتتفتح في النظام بتدفع التمن ده.
#
# الكاش زمنه **دقيقة واحدة**: طويل كفاية إن الشاشتين اللي بيفتحوا ورا بعض يدفعوا الحساب
# مرة، وقصير كفاية إن التحصيل اللي اتسجّل دلوقتي يبان في الكارت وانت لسه واقف.
#
# ومتقفل على المفتاح كامل (النوع والتاريخ والفرع): مدير فرع ومدير تاني بيشوفوا أرقام
# مختلفة، ولو المفتاح ماخدش الفرع كان واحد فيهم هيقرا رقم التاني.
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
    # الكاش مايكبرش: مفاتيح قديمة بتتشال مع كل بناء جديد.
    for k, (stamp, _v) in list(_aging_cache.items()):
        if now - stamp >= _AGING_TTL_SECONDS:
            _aging_cache.pop(k, None)
    return value


def receivables_aging(db: Session, *, as_of: date | None = None,
                      branch_id: int | None = None) -> list[AgingRow]:
    """أعمار ديون العملاء."""
    when = as_of or date.today()

    def build() -> list[AgingRow]:
        account_by_party = {
            acc.customer_id: acc.account_id
            for acc in db.scalars(select(CustomerAccount)).all()
        }
        names = {c.id: c.name for c in db.scalars(select(Customer)).all()}
        return _aging_for_accounts(db, account_by_party=account_by_party, names=names,
                                   as_of=when, branch_id=branch_id)

    return _cached_aging(("receivables", when, branch_id), build)


def payables_aging(db: Session, *, as_of: date | None = None,
                   branch_id: int | None = None) -> list[AgingRow]:
    """أعمار مستحقات الموردين."""
    when = as_of or date.today()

    def build() -> list[AgingRow]:
        account_by_party = {
            acc.supplier_id: acc.account_id
            for acc in db.scalars(select(SupplierAccount)).all()
        }
        names = {s.id: s.name for s in db.scalars(select(Supplier)).all()}
        return _aging_for_accounts(db, account_by_party=account_by_party, names=names,
                                   as_of=when, branch_id=branch_id)

    return _cached_aging(("payables", when, branch_id), build)


# --------------------------------------------------- المقارنة (سلوك تقارير أودو المشترك)


def income_statement_compared(db: Session, options, *, branch_id: int | None = None) -> dict:
    """قائمة الدخل ومعاها نفس التقرير لفترة المقارنة — ونسبة الفرق.

    الرقم لوحده مابيقولش «كويس ولا وحش»؛ اللي بيقول هو اللي جنبه. الفرق بيتحسب
    على مستوى الحساب مش الإجمالي بس، عشان اللي شايف مصروف زاد ٢٠٪ يعرف أنهي حساب
    فيه زوّد.
    """
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
    """الميزانية ومعاها نفس التقرير على تاريخ المقارنة."""
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
    """الفرق ونسبته. النسبة `None` لما اللي قبله صفر — القسمة على صفر مش «زيادة ١٠٠٪»."""
    now, before = to_money(now or 0), to_money(before or 0)
    diff = to_money(now - before)
    return {
        "amount": str(diff),
        "pct": str(to_money(diff / before * 100)) if before else None,
    }
