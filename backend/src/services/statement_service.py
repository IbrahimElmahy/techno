"""Account statements — كشف حساب (018-finance-vouchers).

A running-balance statement for one ledger account over a period: the opening balance carried
from everything before `date_from`, every movement inside the window, and the closing balance.
Signed by the account's normal side, so a customer's «مدين» reads positive = he owes us.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.cost_center import CostCenter
from src.models.user import User
from src.models.ledger import Account, LedgerEntry, LedgerLine
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
    balance_before: Decimal  # the balance this movement started from
    balance: Decimal  # running, signed by the account's normal side
    # (031) Their كشف حساب carries a cost-centre column. The journal line has always held it and
    # the statement dropped it, so «which project was this against?» meant opening the entry.
    cost_center_id: int | None = None
    cost_center_name: str | None = None
    # المندوب اللي حرّك السطر ده. `LedgerEntry.rep_id` كان موجود من زمان والكشف مكانش بيقراه —
    # فسؤال «المندوب ده حرّك إيه على الحساب ده» مكانش ليه إجابة من الشاشة، والفلتر اللي
    # المفروض يجاوبه كان مطفي على طول لأن مافيش اسم بيوصل أصلاً.
    #
    # A manual journal entry has no rep, and that is a real answer rather than a gap: `None` means
    # nobody's round put it there.
    rep_id: int | None = None
    rep_name: str | None = None
    # (a5) الكشف المجمّع — الحساب الرئيسي وتحته كل الفرعيين — بيحتاج كل سطر يقول هو بتاع
    # مين: عمود «الحساب الفرعي» عندهم. في كشف الحساب الواحد الاتنين بيبقوا نفس الاسم
    # المكرر، فالشاشة بتخفيهم؛ هنا هما المعلومة.
    account_id: int | None = None
    account_name: str | None = None
    # ── المطابقة (زي أودو) ────────────────────────────────────────────────────
    # السطر بيقول قيمته **واللي لسه مفتوح منها**. الكشف اللي بيعرض القيمة بس بيخلّي
    # اللي بيقراه يجمع الدفعات بنفسه عشان يعرف الفاتورة دي عليها كام لسه — وده
    # بالظبط السؤال اللي بيتفتح الكشف عشانه.
    line_id: int | None = None
    residual: Decimal | None = None        # None = حساب مابيتقفلش (مش ذمم)
    due_date: date | None = None
    days_overdue: int | None = None        # موجب = فات ميعاده، None = مش مستحق بعد
    payment_state: str | None = None
    payment_state_label: str | None = None
    # المستندات اللي قفلت جزء من السطر ده: الدفعة بتقول سدّدت أنهي فواتير، والفاتورة
    # بتقول اتسدّدت بأنهي دفعات — نفس الجدول مقروء من الوشين.
    matches: tuple = ()


@dataclass(frozen=True)
class AgingBuckets:
    """أعمار المستحق على تاريخ الكشف. الشرائح زي أودو: الحالي ثم ٣٠/٦٠/٩٠ ثم أقدم."""

    current: Decimal = ZERO
    d30: Decimal = ZERO
    d60: Decimal = ZERO
    d90: Decimal = ZERO
    older: Decimal = ZERO
    total: Decimal = ZERO


@dataclass(frozen=True)
class Statement:
    account_id: int
    account_name: str
    opening_balance: Decimal
    closing_balance: Decimal
    total_debit: Decimal
    total_credit: Decimal
    lines: list[StatementLine]
    # (031) Their كشف حساب names الحساب الرئيسي beside الحساب الفرعي. Ours showed one name and
    # left the reader to know which book a sub-account sits under — «إيراد المبيعات» is not
    # self-locating, and two charts can hold a name that reads the same at different levels.
    main_account_id: int | None = None
    main_account_name: str | None = None
    # ── المستحق (زي أودو) ─────────────────────────────────────────────────────
    # **بيتحسب على كل السطور المفتوحة لحد تاريخ القفل، مش على الفترة المعروضة.**
    # «هو عليه كام» سؤال عن الحساب، مش عن الشباك اللي فتحته: عميل عليه فاتورة من
    # يناير وأنا فاتح كشف سبتمبر لازم أشوفها في المستحق، وإلا الرقم بيطمّن غلط.
    total_due: Decimal = ZERO
    total_overdue: Decimal = ZERO
    aging: AgingBuckets = AgingBuckets()
    reconcilable: bool = False   # حساب ذمم؟ لو لأ، أعمدة المطابقة مالهاش معنى


def _effective_date(entry: LedgerEntry) -> date:
    return entry.entry_date or entry.created_at.date()


def _matches_by_line(db: Session, line_ids: list[int]) -> dict[int, list[dict]]:
    """المستندات اللي قفلت جزء من كل سطر — استعلامين مهما كان عدد السطور.

    استعلام لكل سطر على كشف فيه ٤٠٠ حركة = ٤٠٠ رحلة للقاعدة، والكشف بيبقى بيفتح
    في تانية بدل ما يفتح.
    """
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

    # الطرف التاني لكل ربط — سطر واحد ممكن يكون مقفول على كذا مستند.
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


def _days_overdue(line: LedgerLine, when: date, as_of: date) -> int | None:
    """كام يوم فات على استحقاق السطر ده. `None` لو مافيش متبقّي — يعني اتقفل خلاص."""
    if line.amount_residual is None or to_money(line.amount_residual) == ZERO:
        return None
    due = line.date_maturity or when
    days = (as_of - due).days
    return days if days > 0 else None


def _age_bucket(days: int) -> str:
    """الشريحة اللي المبلغ ده وقع فيها. السالب = لسه مااستحقّش."""
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
    """المستحق والمتأخر وأعمار الديون على حساب (أو مجموعة حسابات) في تاريخ.

    بيقرا **السطور المفتوحة** — اللي `amount_residual` بتاعها مش صفر — لحد التاريخ
    ده، مش حركة فترة. ده اللي بيخلّي رقم «عليه كام» هو نفسه في الكشف وفي كارت العميل
    وفي تقرير الأعمار: مصدر واحد، مش تلات حسابات بتتفق بالصدفة.
    """
    today = as_of or date.today()
    rows = db.scalars(
        select(LedgerLine)
        .options(selectinload(LedgerLine.entry))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(list(account_ids)),
               LedgerLine.amount_residual.isnot(None),
               ledger_service.is_posted_sql())
    ).all()

    buckets = {"current": ZERO, "d30": ZERO, "d60": ZERO, "d90": ZERO, "older": ZERO}
    total = overdue = ZERO
    for line in rows:
        residual = to_money(line.amount_residual)
        if residual == ZERO:
            continue
        when = _effective_date(line.entry)
        if when > today:
            continue
        total += residual
        # الاستحقاق من السطر لو مكتوب، وإلا من تاريخ القيد — الفاتورة النقدية
        # مستحقة يوم ما اتكتبت، ومعاملتها كأنها مالهاش ميعاد بتخفيها عن المتأخر.
        due = line.date_maturity or when
        days = (today - due).days
        buckets[_age_bucket(days)] += residual
        if days > 0:
            overdue += residual

    return (
        to_money(total),
        to_money(overdue),
        AgingBuckets(
            current=to_money(buckets["current"]), d30=to_money(buckets["d30"]),
            d60=to_money(buckets["d60"]), d90=to_money(buckets["d90"]),
            older=to_money(buckets["older"]), total=to_money(total),
        ),
    )


def account_statement(
    db: Session, *, account_id: int, date_from: date | None = None,
    date_to: date | None = None, also_accounts: Sequence[int] = (),
) -> Statement:
    """كشف حساب — لحساب واحد، أو لكذا حساب مع بعض.

    `also_accounts` exists for one situation: a customer who holds a receivable account per
    product line (031). Posting to him without naming the line is refused, and rightly — money on
    «أبيض» that belonged to «بولي» is a silent error nobody could trace.

    But READING is not posting, and كشف الحساب was inheriting that refusal: a merged customer's
    statement answered 404 «لازم تحدد النوع», which made the screen unopenable for exactly the
    customers the merge had just fixed. «كل المديونية» is not ambiguous — it is his lines from both
    accounts on one running balance, which is the number anybody asking «هو عليه كام» means.
    """
    ids = [account_id, *[a for a in also_accounts if a != account_id]]
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

    # One query for the names rather than one per line: a statement can run to hundreds of rows.
    cost_centers = {c.id: c.name for c in db.scalars(select(CostCenter)).all()}
    # اسم كل حساب في المجموعة — حسابات الأطراف اسمها عند الطرف مش على الحساب.
    from src.services import chart_service
    owner_names = chart_service.bulk_owner_names(db, list(accounts.values()))
    def name_of(aid: int) -> str:
        a = accounts.get(aid)
        if a is None:
            return f"#{aid}"
        return a.name or owner_names.get(aid) or f"#{aid}"
    # نفس المنطق: استعلام واحد للأسماء بدل واحد لكل سطر.
    reps = {u.id: (u.full_name or u.username)
            for u in db.scalars(select(User)).all()}

    def signed(line: LedgerLine) -> Decimal:
        amount = to_money(line.amount)
        # Signed by the line's OWN account's normal side. Reading two accounts together is only
        # correct if each one is read the way it is kept.
        side = accounts[line.account_id].normal_side
        return amount if line.direction == side else -amount

    dated = sorted(
        ((_effective_date(line.entry), line) for line in rows),
        key=lambda pair: (pair[0], pair[1].entry_id, pair[1].id),
    )

    opening = ZERO
    window: list[tuple[date, LedgerLine]] = []
    for when, line in dated:
        if date_from is not None and when < date_from:
            opening += signed(line)
            continue
        if date_to is not None and when > date_to:
            continue
        window.append((when, line))

    balance = to_money(opening)
    total_debit = total_credit = ZERO
    lines: list[StatementLine] = []
    # المطابقة بتتجاب مرة واحدة لكل سطور الشباك — الاستعلام جوّه الحلقة كان هيخلّي
    # الكشف بيفتح في تانية.
    matches = _matches_by_line(db, [line.id for _when, line in window])
    as_of = date_to or date.today()
    for when, line in window:
        amount = to_money(line.amount)
        is_debit = line.direction.value == "debit"
        debit = amount if is_debit else ZERO
        credit = amount if not is_debit else ZERO
        total_debit += debit
        total_credit += credit
        # Both sides of every row: what the account stood at before this movement and after it,
        # so a single line can be read on its own without adding up the ones above it.
        before = balance
        balance = to_money(balance + signed(line))
        lines.append(StatementLine(
            entry_id=line.entry_id, entry_date=when, entry_type=line.entry.entry_type,
            description=line.statement or line.entry.description or "",
            debit=debit, credit=credit, balance_before=before, balance=balance,
            cost_center_id=line.cost_center_id,
            cost_center_name=cost_centers.get(line.cost_center_id),
            # المندوب على القيد مش على السطر: القيد الواحد بيتكتب في جولة مندوب واحد.
            rep_id=line.entry.rep_id,
            rep_name=reps.get(line.entry.rep_id),
            account_id=line.account_id,
            account_name=name_of(line.account_id),
            line_id=line.id,
            residual=(to_money(line.amount_residual)
                      if line.amount_residual is not None else None),
            due_date=line.date_maturity,
            # المتأخر بيتقاس على **تاريخ قفل الكشف** مش على النهاردة: كشف مقفول على
            # آخر يونيو لازم يقول التأخير اللي كان وقتها، وإلا الورقة المطبوعة
            # بتتغيّر كل يوم وهي مفترض تكون صورة لحظة.
            days_overdue=_days_overdue(line, when, as_of),
            payment_state=line.entry.payment_state,
            payment_state_label=reconcile_service.PAYMENT_STATE_LABEL.get(
                line.entry.payment_state or ""),
            matches=tuple(matches.get(line.id, ())),
        ))

    reconcilable = reconcile_service.is_reconcilable(account)
    total_due = total_overdue = ZERO
    aging = AgingBuckets()
    if reconcilable:
        total_due, total_overdue, aging = due_summary(db, account_ids=ids, as_of=date_to)

    parent = db.get(Account, account.parent_id) if account.parent_id else None
    # A customer's or supplier's account carries no `name` — the party's name lives on the party,
    # and the chart resolves it as `owner_name`. Reading only `name` made every party statement
    # open with «#29» as its title, which is precisely the statement people ask for by name.
    return Statement(
        account_id=account_id, account_name=name_of(account_id),
        # A top-level account IS its own book, and saying so by leaving the field empty is more
        # honest than repeating its own name back as its parent.
        main_account_id=parent.id if parent else None,
        main_account_name=(parent.name or f"#{parent.id}") if parent else None,
        opening_balance=to_money(opening), closing_balance=balance,
        total_debit=to_money(total_debit), total_credit=to_money(total_credit), lines=lines,
        total_due=total_due, total_overdue=total_overdue, aging=aging,
        reconcilable=reconcilable,
    )
