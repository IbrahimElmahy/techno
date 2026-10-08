from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import to_money, to_qty
from src.models.catalog import Item, ItemKind, ItemPrice
from src.models.customer import Customer
from src.models.ledger import Account, AccountType, LedgerEntry, LedgerLine
from src.services import ledger_service
from src.models.sales import SalesInvoice, SalesInvoiceLine
from src.models.stock import LocationKind, StockDirection, StockDoc, StockMovement
from src.models.treasury import Treasury
from src.models.employee import Employee
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Custody

ZERO = Decimal("0")


from src.lib import reporting  # noqa: E402

def _with_ids(link: str, ids) -> str:
    ids = [int(i) for i in ids][:MAX_IDS]
    if not ids:
        return link
    sep = "&" if "?" in link else "?"
    return f"{link}{sep}ids={','.join(str(i) for i in ids)}"


def _money(v) -> str:
    return f"{to_money(v or 0):.2f}"

SAMPLE = 5

MAX_IDS = 200

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


@dataclass
class Issue:
    key: str
    title: str
    group: str
    severity: str
    count: int
    hint: str
    link: str
    samples: list[dict] = field(default_factory=list)
    ids: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class Scope:
    branch_id: int | None = None
    warehouses: frozenset[int] | None = None
    custodies: frozenset[int] | None = None
    items: frozenset[int] | None = None
    treasuries: frozenset[int] | None = None

    @property
    def everything(self) -> bool:
        return self.branch_id is None

    def row(self, branch_id) -> bool:
        return self.everything or branch_id is None or branch_id == self.branch_id

    def place(self, kind, location_id: int) -> bool:
        if self.everything:
            return True
        k = getattr(kind, "value", kind)
        if k == LocationKind.warehouse.value:
            return self.warehouses is None or location_id in self.warehouses
        if k == LocationKind.custody.value:
            return self.custodies is None or location_id in self.custodies
        return True

    def item(self, item_id: int) -> bool:
        return self.everything or self.items is None or item_id in self.items


def _scope(db: Session, branch_id: int | None, on_hand) -> Scope:
    if branch_id is None:
        return Scope()
    from src.models.warehouse import Warehouse

    wh = {w.id for w in db.scalars(
        select(Warehouse).where(
            (Warehouse.branch_id == branch_id) | (Warehouse.branch_id.is_(None)))).all()}
    reps = {u.id for u in db.scalars(
        select(User).where((User.branch_id == branch_id) | (User.branch_id.is_(None)))).all()}
    cust = {c.id for c in db.scalars(select(Custody)).all() if c.rep_id in reps}
    tre = {t.id for t in db.scalars(select(Treasury)).all()
           if t.branch_id in (None, branch_id)}

    moved: dict[int, set] = {}
    for iid, kind, lid, _q in on_hand:
        moved.setdefault(iid, set()).add((getattr(kind, "value", kind), lid))
    mine_items = set()
    for iid, places in moved.items():
        for k, lid in places:
            if (k == LocationKind.warehouse.value and lid in wh) or (
                    k == LocationKind.custody.value and lid in cust):
                mine_items.add(iid)
                break
    all_items = {row.id for row in db.execute(select(Item.id)).all()}
    mine_items |= (all_items - set(moved))

    return Scope(branch_id=branch_id, warehouses=frozenset(wh),
                 custodies=frozenset(cust), items=frozenset(mine_items),
                 treasuries=frozenset(tre))


def _branch_sql(model, scope: Scope | None):
    from sqlalchemy import or_, true

    if scope is None or scope.everything:
        return true()
    return or_(model.branch_id == scope.branch_id, model.branch_id.is_(None))


def _on_hand_by_location(db: Session) -> list[tuple[int, str, int, Decimal]]:
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
    return {
        row.id: f"{row.code} — {row.name}"
        for row in db.execute(select(Item.id, Item.code, Item.name)).all()
    }


def _location_labels(db: Session) -> dict[tuple[str, int], str]:
    from src.models.user import User
    from src.models.warehouse import Custody, Warehouse

    out: dict[tuple[str, int], str] = {}
    for w in db.scalars(select(Warehouse)).all():
        out[("warehouse", w.id)] = w.name
    users = {u.id: (u.full_name or u.username) for u in db.scalars(select(User)).all()}
    for c in db.scalars(select(Custody)).all():
        out[("custody", c.id)] = f"عهدة {users.get(c.rep_id or 0, f'#{c.rep_id}')}"
    return out


def check_negative_stock(db: Session, on_hand, labels, places=None,
                         scope: Scope | None = None) -> Issue | None:
    sc = scope or Scope()
    bad = [(iid, kind, lid, qty) for iid, kind, lid, qty in on_hand
           if qty < ZERO and sc.place(kind, lid)]
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
        link=_with_ids("/stock-balance", sorted({iid for iid, _k, _l, _q in bad})),
        ids=sorted({iid for iid, _k, _l, _q in bad}),
        samples=[{"label": labels.get(iid, f"#{iid}"),
                  "detail": f"{qty} في {(places or {}).get((kind, lid)) or f'{kind} #{lid}'}"}
                 for iid, kind, lid, qty in bad[:SAMPLE]],
    )


def check_reorder(db: Session, on_hand, labels, scope: Scope | None = None) -> list[Issue]:
    sc = scope or Scope()
    totals: dict[int, Decimal] = {}
    for iid, kind, lid, qty in on_hand:
        if not sc.place(kind, lid):
            continue
        totals[iid] = totals.get(iid, ZERO) + qty

    below, above = [], []
    for item in db.execute(
        select(Item.id, Item.code, Item.name, Item.min_stock, Item.max_stock)
        .where(Item.active.is_(True))
    ).all():
        if item.min_stock is None and item.max_stock is None:
            continue
        if not sc.item(item.id):
            continue
        have = totals.get(item.id, ZERO)
        if item.min_stock is not None and have < to_qty(item.min_stock):
            below.append({"item_id": item.id, "label": f"{item.code} — {item.name}",
                          "detail": f"عندك {have} والحد الأدنى {to_qty(item.min_stock)}"})
        elif item.max_stock is not None and have > to_qty(item.max_stock):
            above.append({"item_id": item.id, "label": f"{item.code} — {item.name}",
                          "detail": f"عندك {have} والحد الأقصى {to_qty(item.max_stock)}"})

    out: list[Issue] = []
    if below:
        out.append(Issue(
            key="below_min", title="أصناف تحت الحد الأدنى", group="رصيد المنتجات",
            severity="medium", count=len(below),
            hint="هتقف عن البيع لو مااشتريتش — والحد ده انتوا اللي حطتوه.",
            link=_with_ids("/stock-alerts", [b["item_id"] for b in below]),
            ids=[b["item_id"] for b in below], samples=below[:SAMPLE],
        ))
    if above:
        out.append(Issue(
            key="above_max", title="أصناف فوق الحد الأقصى", group="رصيد المنتجات",
            severity="low", count=len(above),
            hint="فلوس واقفة في بضاعة زيادة عن اللي قررتوه.",
            link=_with_ids("/stock-alerts", [a["item_id"] for a in above]),
            ids=[a["item_id"] for a in above], samples=above[:SAMPLE],
        ))
    return out


def _last_sold(db: Session) -> dict[int, date]:
    from src.lib.reporting import last_sold_by_item

    return last_sold_by_item(db)


def check_stagnant(db: Session, on_hand, labels, *, days: int = 90,
                   branch_id: int | None = None, scope: Scope | None = None,
                   now: datetime | None = None) -> Issue | None:
    now = now or datetime.utcnow()
    cutoff = (now.date() if isinstance(now, datetime) else now) - timedelta(days=days)
    last_sold = _last_sold(db)

    mine = reporting.branch_warehouse_ids(db, branch_id)

    held: dict[int, Decimal] = {}
    for iid, kind, lid, qty in on_hand:
        if kind != LocationKind.warehouse.value or qty <= ZERO:
            continue
        if mine is not None and lid not in mine:
            continue
        held[iid] = held.get(iid, ZERO) + qty

    rows = []
    for iid, qty in held.items():
        day = last_sold.get(iid)
        if day is not None and day >= cutoff:
            continue
        rows.append({"item_id": iid, "label": labels.get(iid, f"#{iid}"),
                     "detail": (f"آخر بيع {day} — عندك {to_qty(qty)}" if day
                                else f"مااتباعش ولا مرة — عندك {to_qty(qty)}")})
    if not rows:
        return None
    rows.sort(key=lambda r: r["label"])
    return Issue(
        key="stagnant", title=f"بضاعة راكدة أكتر من {days} يوم", group="رصيد المنتجات",
        severity="low", count=len(rows),
        hint="فلوس نايمة في المخزن — يا تتحرّك بعرض يا تتصفّى.",
        link=_with_ids("/reports?view=stagnant", [r["item_id"] for r in rows]),
        ids=[r["item_id"] for r in rows], samples=rows[:SAMPLE],
    )


def check_items_without_price(db: Session, scope: Scope | None = None) -> Issue | None:
    tiered = {row[0] for row in db.execute(select(ItemPrice.item_id).distinct()).all()}
    rows = [
        {"label": f"{i.code} — {i.name}", "detail": "مفيش سعر لا على الصنف ولا على أي شريحة"}
        for i in db.scalars(
            select(Item).where(Item.active.is_(True), Item.kind == ItemKind.product,
                               Item.sale_price.is_(None))
        ).all()
        if i.id not in tiered and (scope or Scope()).item(i.id)
    ]
    if not rows:
        return None
    return Issue(
        key="item_no_price", title="منتجات من غير سعر بيع", group="المنتجات",
        severity="medium", count=len(rows),
        hint="بيتباعوا بالسعر اللي البايع يكتبه — مش بسعر الشركة.",
        link="/catalog", samples=rows[:SAMPLE],
    )


def check_items_without_category(db: Session, scope: Scope | None = None) -> Issue | None:
    rows = [
        {"label": f"{i.code} — {i.name}", "detail": "مش تحت أي فئة"}
        for i in db.scalars(
            select(Item).where(Item.active.is_(True),
                               (Item.category.is_(None)) | (Item.category == ""))
        ).all()
        if (scope or Scope()).item(i.id)
    ]
    if not rows:
        return None
    return Issue(
        key="item_no_category", title="أصناف من غير فئة", group="المنتجات",
        severity="low", count=len(rows),
        hint="بتختفي من أي تقرير أو فلتر بيتقسّم بالفئة.",
        link="/catalog", samples=rows[:SAMPLE],
    )


def check_min_over_max(db: Session, scope: Scope | None = None) -> Issue | None:
    rows = [
        {"label": f"{i.code} — {i.name}",
         "detail": f"الأدنى {to_qty(i.min_stock)} والأقصى {to_qty(i.max_stock)}"}
        for i in db.scalars(
            select(Item).where(Item.active.is_(True),
                               Item.min_stock.is_not(None), Item.max_stock.is_not(None))
        ).all()
        if to_qty(i.min_stock) > to_qty(i.max_stock) and (scope or Scope()).item(i.id)
    ]
    if not rows:
        return None
    return Issue(
        key="min_over_max", title="حد أدنى أكبر من الحد الأقصى", group="المنتجات",
        severity="medium", count=len(rows),
        hint="تقرير إعادة الطلب بيطلع كلام متناقض على الأصناف دي.",
        link="/catalog", samples=rows[:SAMPLE],
    )


def check_invoice_lines_without_cost(db: Session, scope: Scope | None = None) -> Issue | None:
    rows = db.execute(
        select(SalesInvoice.id, SalesInvoice.document_number, func.count(SalesInvoiceLine.id))
        .join(SalesInvoiceLine, SalesInvoiceLine.invoice_id == SalesInvoice.id)
        .where(SalesInvoiceLine.unit_cost.is_(None))
        .where(_branch_sql(SalesInvoice, scope))
        .group_by(SalesInvoice.id, SalesInvoice.document_number)
    ).all()
    if not rows:
        return None
    ids = [r[0] for r in rows]
    return Issue(
        key="invoice_no_cost", title="فواتير بنودها من غير تكلفة", group="فواتير العملاء",
        severity="high", count=len(rows),
        hint="الربح عليها بيتحسب وكأن التكلفة صفر — يعني ربح الفاتورة والعميل "
             "والصنف والشهر كله أعلى من الحقيقة.",
        link=_with_ids("/invoices", ids), ids=ids,
        samples=[{"label": f"فاتورة {num}", "detail": f"{n} بند من غير تكلفة"}
                 for _i, num, n in rows[:SAMPLE]],
    )


def check_empty_invoices(db: Session, scope: Scope | None = None) -> Issue | None:
    from src.models.sales import SalesInvoiceCoupon

    with_coupons = select(SalesInvoiceCoupon.invoice_id).distinct().scalar_subquery()
    rows = db.execute(
        select(SalesInvoice.id, SalesInvoice.document_number, SalesInvoice.net)
        .outerjoin(SalesInvoiceLine, SalesInvoiceLine.invoice_id == SalesInvoice.id)
        .where(SalesInvoice.id.not_in(with_coupons))
        .where(_branch_sql(SalesInvoice, scope))
        .group_by(SalesInvoice.id, SalesInvoice.document_number, SalesInvoice.net)
        .having(func.count(SalesInvoiceLine.id) == 0)
    ).all()
    if not rows:
        return None
    ids = [r[0] for r in rows]
    return Issue(
        key="invoice_no_lines", title="فواتير من غير بنود", group="فواتير العملاء",
        severity="high", count=len(rows),
        hint="مستند بيحمّل العميل مديونية ومش قايل اتباعله إيه.",
        link=_with_ids("/invoices", ids), ids=ids,
        samples=[{"label": f"فاتورة {num}", "detail": f"صافي {_money(net)}"}
                 for _i, num, net in rows[:SAMPLE]],
    )


def check_unbalanced_entries(db: Session, scope: Scope | None = None) -> Issue | None:
    debit = func.sum(case((LedgerLine.direction == "debit", LedgerLine.amount), else_=0))
    credit = func.sum(case((LedgerLine.direction == "credit", LedgerLine.amount), else_=0))
    rows = db.execute(
        select(LedgerLine.entry_id, debit, credit)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(ledger_service.is_posted_sql())
        .where(_branch_sql(LedgerEntry, scope))
        .group_by(LedgerLine.entry_id)
        .having(debit != credit)
    ).all()
    if not rows:
        return None
    return Issue(
        key="unbalanced_entry", title="قيود غير متوازنة", group="الحسابات",
        severity="high", count=len(rows),
        hint="الميزانية مش هتقفل، وكل تقرير مالي بيقرا القيود دي رقمه غلط.",
        link="/general-ledger?tab=integrity",
        samples=[{"label": f"قيد #{eid}",
                  "detail": f"مدين {_money(d)} — دائن {_money(c)}"}
                 for eid, d, c in rows[:SAMPLE]],
    )


def check_accounts_without_nature(db: Session, scope: Scope | None = None) -> Issue | None:
    signed = func.sum(case(
        (LedgerLine.direction == "debit", LedgerLine.amount), else_=-LedgerLine.amount))
    rows = db.execute(
        select(Account.id, Account.code, Account.name, signed)
        .join(LedgerLine, LedgerLine.account_id == Account.id)
        .where(Account.nature.is_(None),
               Account.account_type == AccountType.user_defined)
        .where(_branch_sql(Account, scope))
        .group_by(Account.id, Account.code, Account.name)
    ).all()
    bad = [(i, c, n, b) for i, c, n, b in rows if abs(to_money(b or 0)) > Decimal("0.005")]
    if not bad:
        return None
    total = sum((to_money(b) for _i, _c, _n, b in bad), ZERO)
    return Issue(
        key="account_no_nature",
        title="حسابات مالهاش تصنيف بتسقط من الميزانية",
        group="الحسابات",
        severity="high",
        count=len(bad),
        hint=f"رصيدهم {_money(total)} ج.م مش ظاهر لا في الأصول ولا الالتزامات — "
             "الميزانية بتقفل بفرق بسببهم.",
        link=_with_ids("/sub-accounts", [i for i, _c, _n, _b in bad]),
        ids=[i for i, _c, _n, _b in bad],
        samples=[{"label": f"{c or ''} {n or f'#{i}'}".strip(), "detail": _money(b)}
                 for i, c, n, b in sorted(bad, key=lambda r: -abs(r[3]))[:SAMPLE]],
    )


def check_negative_treasuries(db: Session, scope: Scope | None = None) -> Issue | None:
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
            .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
            .where(ledger_service.is_posted_sql())
            .group_by(LedgerLine.account_id)
        ).all()
    }
    rows = [
        {"label": t.name, "detail": f"الرصيد {_money(balances.get(t.account_id, ZERO))}"}
        for t in db.scalars(select(Treasury)
                            .where(Treasury.active.is_(True),
                                   _branch_sql(Treasury, scope))).all()
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


def check_duplicate_customers(db: Session, scope: Scope | None = None) -> Issue | None:
    from src.services import customer_merge_service

    plan = customer_merge_service.apply(db, dry_run=True)
    pairs = plan.get("pairs", [])
    sc = scope or Scope()
    if not sc.everything:
        mine = {c.id for c in db.scalars(select(Customer)).all() if sc.row(c.branch_id)}
        pairs = [p for p in pairs
                 if (p.get("keep") or {}).get("id") in mine
                 or (p.get("merge") or {}).get("id") in mine]
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


def check_overdue_cheques(db: Session, *, scope: Scope | None = None,
                          now: datetime | None = None) -> Issue | None:
    from src.models.cheque import Cheque, ChequeDirection, ChequeStatus

    today = (now or datetime.utcnow()).date()
    sc = scope or Scope()
    stmt = (select(Cheque.document_number, Cheque.cheque_number, Cheque.amount,
                   Cheque.due_date, Cheque.direction)
            .where(Cheque.status == ChequeStatus.pending, Cheque.due_date < today))
    if not sc.everything and sc.treasuries is not None:
        stmt = stmt.where((Cheque.treasury_id.is_(None))
                          | (Cheque.treasury_id.in_(sc.treasuries)))
    rows = db.execute(stmt.order_by(Cheque.due_date)).all()
    if not rows:
        return None
    total = sum((to_money(r.amount) for r in rows), ZERO)
    return Issue(
        key="overdue_cheques", title="شيكات فات استحقاقها", group="الحسابات",
        severity="high", count=len(rows),
        hint=f"إجمالي {_money(total)} تاريخ استحقاقه عدّى وهو لسه تحت التحصيل — "
             "يا اتحصّل وماتسجّلش، يا محدش بيجري وراه.",
        link="/ops-reports?view=cheque-wallet",
        samples=[{
            "label": f"{'وارد' if r.direction == ChequeDirection.incoming else 'صادر'} "
                     f"{r.cheque_number}",
            "detail": f"{_money(r.amount)} — استحق {r.due_date} ({(today - r.due_date).days} يوم)",
        } for r in rows[:SAMPLE]],
    )


def check_expired_reservations(db: Session, *, scope: Scope | None = None,
                               now: datetime | None = None) -> Issue | None:
    from src.models.reservation import Reservation, ReservationStatus

    today = (now or datetime.utcnow()).date()
    sc = scope or Scope()
    rows = [r for r in db.execute(
        select(Reservation.document_number, Reservation.quantity, Reservation.expires_on,
               Reservation.location_kind, Reservation.location_id)
        .where(Reservation.status == ReservationStatus.active,
               Reservation.expires_on < today)
        .order_by(Reservation.expires_on)
    ).all() if sc.place(r.location_kind, r.location_id)]
    if not rows:
        return None
    return Issue(
        key="expired_reservations", title="حجوزات منتهية لسه ماسكة بضاعة",
        group="المخزون", severity="medium", count=len(rows),
        hint="الكمية المحجوزة بتتخصم من المتاح للبيع، فالبضاعة دي مش بتتباع لحد "
             "وهي مش محجوزة لحد فعلاً.",
        link="/ops-reports?view=reservations-open",
        samples=[{"label": r.document_number,
                  "detail": f"{to_qty(r.quantity)} — انتهى {r.expires_on}"}
                 for r in rows[:SAMPLE]],
    )


def check_late_orders(db: Session, *, scope: Scope | None = None,
                      now: datetime | None = None) -> Issue | None:
    from src.models.trade_order import OrderStatus, TradeOrder

    today = (now or datetime.utcnow()).date()
    rows = db.execute(
        select(TradeOrder.document_number, TradeOrder.total, TradeOrder.due_date,
               TradeOrder.kind)
        .where(TradeOrder.status == OrderStatus.open,
               TradeOrder.due_date.is_not(None), TradeOrder.due_date < today)
        .where(_branch_sql(TradeOrder, scope))
        .order_by(TradeOrder.due_date)
    ).all()
    if not rows:
        return None
    return Issue(
        key="late_orders", title="طلبات فات ميعادها", group="المبيعات",
        severity="low", count=len(rows),
        hint="اتفق عليها بتاريخ عدّى وهي لسه مفتوحة — يا اتنفّذت وماتحوّلتش لفاتورة، "
             "يا العميل مستني.",
        link="/ops-reports?view=orders-open",
        samples=[{"label": r.document_number,
                  "detail": f"{_money(r.total)} — كان مستحق {r.due_date}"}
                 for r in rows[:SAMPLE]],
    )


def check_reps_without_store(db: Session, scope: Scope | None = None) -> Issue | None:
    reps = db.scalars(
        select(User).where(User.role_id.in_(
            select(Role.id).where(Role.name == RoleName.sales_rep)),
            _branch_sql(User, scope))
    ).all()
    if not reps:
        return None

    custody_reps = {c.rep_id for c in db.scalars(select(Custody)).all() if c.rep_id}
    stores = {
        e.user_id: e.warehouse_id
        for e in db.scalars(select(Employee).where(Employee.user_id.isnot(None))).all()
    }

    rows = []
    for r in reps:
        if not getattr(r, "active", True):
            continue
        has_store = stores.get(r.id) is not None
        has_custody = r.id in custody_reps
        if has_store and has_custody:
            continue
        missing = []
        if not has_store and not has_custody:
            missing.append("مافيش مخزن ولا عهدة — مايقدرش يبيع")
        elif not has_custody:
            missing.append("مافيش عهدة — التحصيل مالوش مكان يتقيّد فيه")
        else:
            continue
        rows.append({"label": r.username, "detail": " · ".join(missing)})

    if not rows:
        return None
    return Issue(
        key="rep_no_store", title="مناديب ناقصهم مخزن أو عهدة", group="المناديب",
        severity="high", count=len(rows),
        hint="المندوب بيبيع من مكانه وبيحصّل في عهدته — الناقص بيقف قدام العميل.",
        link="/employees", samples=rows[:SAMPLE],
    )


def run_all(db: Session, *, now: datetime | None = None,
            branch_id: int | None = None) -> dict:
    on_hand = _on_hand_by_location(db)
    labels = _item_labels(db)
    places = _location_labels(db)
    sc = _scope(db, branch_id, on_hand)

    found: list[Issue | None] = [
        check_negative_stock(db, on_hand, labels, places, scope=sc),
        *check_reorder(db, on_hand, labels, scope=sc),
        check_stagnant(db, on_hand, labels, now=now, branch_id=branch_id, scope=sc),
        check_items_without_price(db, scope=sc),
        check_items_without_category(db, scope=sc),
        check_min_over_max(db, scope=sc),
        check_invoice_lines_without_cost(db, scope=sc),
        check_empty_invoices(db, scope=sc),
        check_unbalanced_entries(db, scope=sc),
        check_negative_treasuries(db, scope=sc),
        check_accounts_without_nature(db, scope=sc),
        check_duplicate_customers(db, scope=sc),
        check_overdue_cheques(db, now=now, scope=sc),
        check_expired_reservations(db, now=now, scope=sc),
        check_late_orders(db, now=now, scope=sc),
        check_reps_without_store(db, scope=sc),
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


__all__ = ["Issue", "Scope", "run_all"]
