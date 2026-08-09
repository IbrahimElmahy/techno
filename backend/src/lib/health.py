"""فحص النظام — كل حاجة فيها خلل، في مكان واحد.

The problems this looks for are already discoverable: each one has a screen that shows it, and
somebody who opens all fourteen of those screens every morning would find everything here. Nobody
does that. So an item priced at nothing keeps being sold at nothing, a warehouse holding negative
stock stays negative, and an invoice whose cost was never captured quietly reports infinite profit
— each one visible, none of them looked at.

What makes this a page rather than a report is that it answers «فيه إيه غلط» without being asked
about anything in particular. Every check names what is wrong, how many, what it costs to leave
alone, and the screen that fixes it. A clean system produces an empty page, which is the point:
the absence of findings has to be a readable answer, not an unpopulated dashboard.

Two rules hold everything here honest:

* **Read-only.** Nothing writes. A diagnosis that changes the patient is not a diagnosis, and this
  runs unattended on every dashboard load.
* **No opinions dressed as faults.** «مبيعات الشهر أقل من اللي قبله» is a business fact somebody
  may want on a chart; it is not a خلل and it is not here. Everything below is either a broken
  invariant, a missing value that makes some other number wrong, or a threshold the company itself
  set and the data has crossed.

Cost note: this runs on every dashboard load against the live database, and the customer merge
already taught us what an N+1 does to a serverless request — 233 round trips, past the timeout,
503. Every check here is aggregate queries whose count does not grow with the data.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import to_money, to_qty
from src.models.catalog import Item, ItemKind, ItemPrice
from src.models.ledger import Account, LedgerLine
from src.models.sales import SalesInvoice, SalesInvoiceLine
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.treasury import Treasury

ZERO = Decimal("0")


def _money(v) -> str:
    """Readable money in a sample line. `-36047.66` is a number; `-36,047.66` is an amount."""
    return f"{to_money(v or 0):,.2f}"

# How many examples travel with each finding. Enough to recognise the problem without turning the
# response into the report it links to.
SAMPLE = 5

# Severity is about consequence, not about how many rows matched.
#
#   high    — a number somewhere in the system is now WRONG. Stock that cannot physically exist,
#             a ledger entry that does not balance, profit computed against a missing cost.
#   medium  — nothing is wrong yet, but a decision is being made on incomplete data: an item with
#             no price, a customer duplicated across two files.
#   low     — the company's own threshold has been crossed. Worth knowing, not broken.
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


@dataclass
class Issue:
    """واحدة من الحاجات اللي فيها خلل."""

    key: str
    title: str
    group: str
    severity: str
    count: int
    # What it costs to leave alone — the sentence that turns a count into a reason to click.
    hint: str
    # The screen that fixes it. A finding with nowhere to go is a complaint.
    link: str
    samples: list[dict] = field(default_factory=list)


def _on_hand_by_location(db: Session) -> list[tuple[int, str, int, Decimal]]:
    """الرصيد لكل صنف في كل مكان — استعلام واحد."""
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    rows = db.execute(
        select(StockMovement.item_id, StockMovement.location_kind,
               StockMovement.location_id, signed)
        .group_by(StockMovement.item_id, StockMovement.location_kind,
                  StockMovement.location_id)
    ).all()
    return [(iid, getattr(kind, "value", kind), lid, to_qty(q or 0)) for iid, kind, lid, q in rows]


def _item_labels(db: Session) -> dict[int, str]:
    """«كود — اسم» لكل صنف. A finding that names an id names nothing."""
    return {
        row.id: f"{row.code} — {row.name}"
        for row in db.execute(select(Item.id, Item.code, Item.name)).all()
    }


# ---------------------------------------------------------------------------
# المخزون — الأرقام اللي بتبقى غلط فعلاً
# ---------------------------------------------------------------------------

def check_negative_stock(db: Session, on_hand, labels) -> Issue | None:
    """رصيد سالب.

    The invariant the whole system is built on (Principle XI): no item is negative anywhere, ever.
    A negative balance is not a warning about the future — it says goods left a location that did
    not have them, so every cost, every valuation and every availability check downstream of that
    location is now computed from a quantity that never existed.
    """
    bad = [(iid, kind, lid, qty) for iid, kind, lid, qty in on_hand if qty < ZERO]
    if not bad:
        return None
    return Issue(
        key="negative_stock",
        title="رصيد سالب في المخزن",
        group="رصيد المنتجات",
        severity="high",
        count=len(bad),
        hint="الصنف طلع من مكان مكانش فيه — التكلفة والجرد والمتاح كلهم "
             "بيتحسبوا على كمية مش موجودة.",
        link="/stock-balance",
        samples=[{"label": labels.get(iid, f"#{iid}"), "detail": f"{qty} في {kind} #{lid}"}
                 for iid, kind, lid, qty in bad[:SAMPLE]],
    )


def check_reorder(db: Session, on_hand, labels) -> list[Issue]:
    """تحت الحد الأدنى / فوق الحد الأقصى — الحدود اللي الشركة نفسها حطتها (011)."""
    totals: dict[int, Decimal] = {}
    for iid, _kind, _lid, qty in on_hand:
        totals[iid] = totals.get(iid, ZERO) + qty

    below, above = [], []
    for item in db.scalars(select(Item).where(Item.active.is_(True))).all():
        if item.min_stock is None and item.max_stock is None:
            continue
        have = totals.get(item.id, ZERO)
        if item.min_stock is not None and have < to_qty(item.min_stock):
            below.append({"label": f"{item.code} — {item.name}",
                          "detail": f"عندك {have} والحد الأدنى {to_qty(item.min_stock)}"})
        elif item.max_stock is not None and have > to_qty(item.max_stock):
            above.append({"label": f"{item.code} — {item.name}",
                          "detail": f"عندك {have} والحد الأقصى {to_qty(item.max_stock)}"})

    out: list[Issue] = []
    if below:
        out.append(Issue(
            key="below_min", title="أصناف تحت الحد الأدنى", group="رصيد المنتجات",
            severity="medium", count=len(below),
            hint="هتقف عن البيع لو مااشتريتش — والحد ده انتوا اللي حطتوه.",
            link="/stock-alerts", samples=below[:SAMPLE],
        ))
    if above:
        out.append(Issue(
            key="above_max", title="أصناف فوق الحد الأقصى", group="رصيد المنتجات",
            severity="low", count=len(above),
            hint="فلوس واقفة في بضاعة زيادة عن اللي قررتوه.",
            link="/stock-alerts", samples=above[:SAMPLE],
        ))
    return out


def check_stagnant(db: Session, on_hand, labels, *, days: int = 90,
                   now: datetime | None = None) -> Issue | None:
    """بضاعة راكدة — رصيد موجود ومحصلش عليه بيع من كذا شهر.

    The last-out date comes from ONE grouped query rather than one query per item×warehouse, which
    is the difference between a page that loads and a request that times out.
    """
    now = now or datetime.utcnow()
    cutoff = (now.date() if isinstance(now, datetime) else now) - timedelta(days=days)

    last_out = {
        (iid, lid): when
        for iid, lid, when in db.execute(
            select(StockMovement.item_id, StockMovement.location_id,
                   func.max(StockMovement.created_at))
            .where(StockMovement.location_kind == LocationKind.warehouse,
                   StockMovement.direction == StockDirection.out)
            .group_by(StockMovement.item_id, StockMovement.location_id)
        ).all()
    }

    rows = []
    for iid, kind, lid, qty in on_hand:
        if kind != LocationKind.warehouse.value or qty <= ZERO:
            continue
        when = last_out.get((iid, lid))
        day = when.date() if isinstance(when, datetime) else when
        if day is not None and day >= cutoff:
            continue
        rows.append({"label": labels.get(iid, f"#{iid}"),
                     "detail": f"آخر بيع {day}" if day else "مخرجش من المخزن ولا مرة"})
    if not rows:
        return None
    return Issue(
        key="stagnant", title=f"بضاعة راكدة أكتر من {days} يوم", group="رصيد المنتجات",
        severity="low", count=len(rows),
        hint="فلوس نايمة في المخزن — يا تتحرّك بعرض يا تتصفّى.",
        link="/reports", samples=rows[:SAMPLE],
    )


# ---------------------------------------------------------------------------
# المنتجات — الحقول الناقصة اللي بتخلي أرقام تانية غلط
# ---------------------------------------------------------------------------

def check_items_without_price(db: Session) -> Issue | None:
    """منتج من غير سعر بيع — لا على الصنف ولا على أي شريحة.

    Not pedantry about a blank field: this is the number the invoice line reaches for. An item with
    no price anywhere is sold at whatever the salesman types, or at zero, and neither is a price
    the company set.
    """
    tiered = {row[0] for row in db.execute(select(ItemPrice.item_id).distinct()).all()}
    rows = [
        {"label": f"{i.code} — {i.name}", "detail": "مفيش سعر لا على الصنف ولا على أي شريحة"}
        for i in db.scalars(
            select(Item).where(Item.active.is_(True), Item.kind == ItemKind.product,
                               Item.sale_price.is_(None))
        ).all()
        if i.id not in tiered
    ]
    if not rows:
        return None
    return Issue(
        key="item_no_price", title="منتجات من غير سعر بيع", group="المنتجات",
        severity="medium", count=len(rows),
        hint="بيتباعوا بالسعر اللي البايع يكتبه — مش بسعر الشركة.",
        link="/catalog", samples=rows[:SAMPLE],
    )


def check_items_without_category(db: Session) -> Issue | None:
    """صنف من غير فئة — بيقع من كل تقرير وفلتر بيتقسّم بالفئة."""
    rows = [
        {"label": f"{i.code} — {i.name}", "detail": "مش تحت أي فئة"}
        for i in db.scalars(
            select(Item).where(Item.active.is_(True),
                               (Item.category.is_(None)) | (Item.category == ""))
        ).all()
    ]
    if not rows:
        return None
    return Issue(
        key="item_no_category", title="أصناف من غير فئة", group="المنتجات",
        severity="low", count=len(rows),
        hint="بتختفي من أي تقرير أو فلتر بيتقسّم بالفئة.",
        link="/catalog", samples=rows[:SAMPLE],
    )


def check_min_over_max(db: Session) -> Issue | None:
    """حد أدنى أكبر من الحد الأقصى — الصنف تحت وفوق في نفس الوقت."""
    rows = [
        {"label": f"{i.code} — {i.name}",
         "detail": f"الأدنى {to_qty(i.min_stock)} والأقصى {to_qty(i.max_stock)}"}
        for i in db.scalars(
            select(Item).where(Item.active.is_(True),
                               Item.min_stock.is_not(None), Item.max_stock.is_not(None))
        ).all()
        if to_qty(i.min_stock) > to_qty(i.max_stock)
    ]
    if not rows:
        return None
    return Issue(
        key="min_over_max", title="حد أدنى أكبر من الحد الأقصى", group="المنتجات",
        severity="medium", count=len(rows),
        hint="تقرير إعادة الطلب بيطلع كلام متناقض على الأصناف دي.",
        link="/catalog", samples=rows[:SAMPLE],
    )


# ---------------------------------------------------------------------------
# فواتير العملاء
# ---------------------------------------------------------------------------

def check_invoice_lines_without_cost(db: Session) -> Issue | None:
    """بنود اتباعت من غير تكلفة محفوظة — الربح عليها مش معروف.

    Cost is frozen onto the line when the invoice is written (030) so that past profit never moves.
    A line where it is NULL reports its entire price as profit in any report that subtracts cost,
    which overstates the margin of the invoice, the customer, the item and the period at once.
    """
    rows = db.execute(
        select(SalesInvoice.document_number, func.count(SalesInvoiceLine.id))
        .join(SalesInvoiceLine, SalesInvoiceLine.invoice_id == SalesInvoice.id)
        .where(SalesInvoiceLine.unit_cost.is_(None))
        .group_by(SalesInvoice.id, SalesInvoice.document_number)
    ).all()
    if not rows:
        return None
    return Issue(
        key="invoice_no_cost", title="فواتير بنودها من غير تكلفة", group="فواتير العملاء",
        severity="high", count=len(rows),
        hint="الربح عليها بيتحسب وكأن التكلفة صفر — يعني ربح الفاتورة والعميل "
             "والصنف والشهر كله أعلى من الحقيقة.",
        link="/invoices",
        samples=[{"label": f"فاتورة {num}", "detail": f"{n} بند من غير تكلفة"}
                 for num, n in rows[:SAMPLE]],
    )


def check_empty_invoices(db: Session) -> Issue | None:
    """فاتورة من غير بنود — مستند بيقول باع ومش قايل باع إيه."""
    rows = db.execute(
        select(SalesInvoice.document_number, SalesInvoice.net)
        .outerjoin(SalesInvoiceLine, SalesInvoiceLine.invoice_id == SalesInvoice.id)
        .group_by(SalesInvoice.id, SalesInvoice.document_number, SalesInvoice.net)
        .having(func.count(SalesInvoiceLine.id) == 0)
    ).all()
    if not rows:
        return None
    return Issue(
        key="invoice_no_lines", title="فواتير من غير بنود", group="فواتير العملاء",
        severity="high", count=len(rows),
        hint="مستند بيحمّل العميل مديونية ومش قايل اتباعله إيه.",
        link="/invoices",
        samples=[{"label": f"فاتورة {num}", "detail": f"صافي {_money(net)}"}
                 for num, net in rows[:SAMPLE]],
    )


# ---------------------------------------------------------------------------
# الحسابات والفلوس
# ---------------------------------------------------------------------------

def check_unbalanced_entries(db: Session) -> Issue | None:
    """قيد مدينه مش قد دائنه — القاعدة الوحيدة اللي القيد المزدوج قايم عليها."""
    debit = func.sum(case((LedgerLine.direction == "debit", LedgerLine.amount), else_=0))
    credit = func.sum(case((LedgerLine.direction == "credit", LedgerLine.amount), else_=0))
    rows = db.execute(
        select(LedgerLine.entry_id, debit, credit)
        .group_by(LedgerLine.entry_id)
        .having(debit != credit)
    ).all()
    if not rows:
        return None
    return Issue(
        key="unbalanced_entry", title="قيود غير متوازنة", group="الحسابات",
        severity="high", count=len(rows),
        hint="الميزانية مش هتقفل، وكل تقرير مالي بيقرا القيود دي رقمه غلط.",
        link="/general-ledger",
        samples=[{"label": f"قيد #{eid}",
                  "detail": f"مدين {_money(d)} — دائن {_money(c)}"}
                 for eid, d, c in rows[:SAMPLE]],
    )


def check_negative_treasuries(db: Session) -> Issue | None:
    """خزنة برصيد سالب — مفيش خزنة بتطلع أكتر من اللي فيها."""
    signed = case(
        (LedgerLine.direction == Account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    balances = {
        acc_id: to_money(total or 0)
        for acc_id, total in db.execute(
            select(LedgerLine.account_id, func.coalesce(func.sum(signed), 0))
            .select_from(LedgerLine)
            .join(Account, Account.id == LedgerLine.account_id)
            .group_by(LedgerLine.account_id)
        ).all()
    }
    rows = [
        {"label": t.name, "detail": f"الرصيد {_money(balances.get(t.account_id, ZERO))}"}
        for t in db.scalars(select(Treasury).where(Treasury.active.is_(True))).all()
        if balances.get(t.account_id, ZERO) < ZERO
    ]
    if not rows:
        return None
    return Issue(
        key="negative_treasury", title="خزائن برصيد سالب", group="الحسابات",
        severity="high", count=len(rows),
        hint="اتصرف منها أكتر من اللي دخلها — يا صرف اتسجّل مرتين يا قبض مااتسجّلش.",
        link="/treasuries", samples=rows[:SAMPLE],
    )


def check_duplicate_customers(db: Session) -> Issue | None:
    """عميل واحد في ملفين — «تكنو فلان» و«فلان».

    Two files means two balances, and neither one is what he owes.
    """
    from src.services import customer_merge_service

    plan = customer_merge_service.apply(db, dry_run=True)
    pairs = plan.get("pairs", [])
    if not pairs:
        return None
    return Issue(
        key="duplicate_customers", title="عملاء مكرّرين", group="فواتير العملاء",
        severity="medium", count=len(pairs),
        hint="العميل بمديونيتين في ملفين، ومفيش واحدة فيهم هي اللي عليه.",
        link="/customers",
        samples=[{"label": p.get("base_name", ""),
                  "detail": f"{p['keep']['name']} + {p['merge']['name']}"}
                 for p in pairs[:SAMPLE] if p.get("keep") and p.get("merge")],
    )


# ---------------------------------------------------------------------------

def run_all(db: Session, *, now: datetime | None = None) -> dict:
    """كل الفحوصات — والصفحة الفاضية إجابة برضه."""
    on_hand = _on_hand_by_location(db)
    labels = _item_labels(db)

    found: list[Issue | None] = [
        check_negative_stock(db, on_hand, labels),
        *check_reorder(db, on_hand, labels),
        check_stagnant(db, on_hand, labels, now=now),
        check_items_without_price(db),
        check_items_without_category(db),
        check_min_over_max(db),
        check_invoice_lines_without_cost(db),
        check_empty_invoices(db),
        check_unbalanced_entries(db),
        check_negative_treasuries(db),
        check_duplicate_customers(db),
    ]
    issues = [i for i in found if i is not None]
    issues.sort(key=lambda i: (SEVERITY_ORDER.get(i.severity, 9), -i.count))

    return {
        "generated_at": (now or datetime.utcnow()).isoformat(),
        "clean": not issues,
        "totals": {
            "high": sum(1 for i in issues if i.severity == "high"),
            "medium": sum(1 for i in issues if i.severity == "medium"),
            "low": sum(1 for i in issues if i.severity == "low"),
        },
        "issues": [asdict(i) for i in issues],
    }


__all__ = ["Issue", "run_all"]
