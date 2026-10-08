from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, String, and_, case, cast, func, literal, or_, select, true, union_all
from sqlalchemy.orm import Session, aliased

from src.core.money import to_money
from src.models.cost_center import CostCenter
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.models.org import Branch, Territory
from src.models.supplier import Supplier, SupplierAccount
from src.models.user import User
from src.services import ledger_service

DIMENSIONS = ("account", "main_account", "account_type", "nature", "branch", "cost_center",
              "entry_type", "party", "party_kind", "territory", "rep", "family",
              "day", "month", "year")

TYPE_LABELS = {
    "treasury": "خزائن وبنوك", "custody": "عهد", "customer_receivable": "عملاء",
    "supplier_payable": "موردين", "sales_revenue": "إيرادات مبيعات",
    "purchases_expense": "مشتريات", "loyalty_expense": "مصروفات ولاء",
    "opening_balance_equity": "أرصدة افتتاحية", "user_defined": "حسابات أخرى",
}
NATURE_LABELS = {"asset": "أصول", "liability": "خصوم", "equity": "حقوق ملكية",
                 "income": "إيرادات", "expense": "مصروفات"}
PARTY_KIND_LABELS = {"customer": "عملاء", "supplier": "موردين"}

MAX_ROWS = 20000


class LedgerAnalysisError(Exception):
    pass


def _party_map():
    c = select(CustomerAccount.account_id.label("account_id"),
               literal("customer").label("kind"),
               CustomerAccount.customer_id.label("party_id"),
               CustomerAccount.family.label("family"))
    s = select(SupplierAccount.account_id.label("account_id"),
               literal("supplier").label("kind"),
               SupplierAccount.supplier_id.label("party_id"),
               cast(literal(None), String(40)).label("family"))
    u = union_all(c, s).subquery("pmu")
    return (select(u.c.account_id, func.min(u.c.kind).label("kind"),
                   func.min(u.c.party_id).label("party_id"), func.min(u.c.family).label("family"))
            .group_by(u.c.account_id).subquery("pm"))


def analyse(
    db: Session,
    *,
    dims: list[str] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    branch_id: int | None = None,
    account_id: int | None = None,
    account_type: str | None = None,
    party_kind: str | None = None,
    party_id: int | None = None,
    territory_id: int | None = None,
    rep_id: int | None = None,
    cost_center_id: int | None = None,
    nonzero: bool = True,
    posted_only: bool = True,
) -> dict:
    dims = [d for d in (dims or []) if d]
    bad = [d for d in dims if d not in DIMENSIONS]
    if bad:
        raise LedgerAnalysisError(f"بعد غير معروف: {', '.join(bad)}")

    ln, en, acc = LedgerLine, LedgerEntry, Account
    parent = aliased(Account)
    pm = _party_map()
    when = func.coalesce(en.entry_date, cast(en.created_at, Date))
    debit = case((ln.direction == Direction.debit, ln.amount), else_=0)
    credit = case((ln.direction == Direction.credit, ln.amount), else_=0)
    signed = debit - credit
    has_period = any(d in ("day", "month", "year") for d in dims)

    inside = []
    if date_from:
        inside.append(when >= date_from)
    if date_to:
        inside.append(when <= date_to)
    in_range = and_(*inside) if inside else true()
    before = (when < date_from) if date_from else None

    def s(expr):
        return func.coalesce(func.sum(expr), 0)

    exprs = {
        "account": (acc.id, func.max(func.coalesce(acc.code, "") + " " + func.coalesce(acc.name, ""))),
        "main_account": (func.coalesce(acc.parent_id, acc.id),
                         func.max(func.coalesce(parent.code, acc.code, "") + " "
                                  + func.coalesce(parent.name, acc.name, ""))),
        "account_type": (cast(acc.account_type, String), None),
        "nature": (cast(acc.nature, String), None),
        "branch": (func.coalesce(en.branch_id, acc.branch_id), func.max(Branch.name)),
        "cost_center": (ln.cost_center_id, func.max(CostCenter.name)),
        "entry_type": (en.entry_type, None),
        "party": (func.concat(pm.c.kind, ":", pm.c.party_id),
                  func.max(func.coalesce(Customer.name, Supplier.name))),
        "party_kind": (pm.c.kind, None),
        "territory": (Customer.territory_id, func.max(Territory.name)),
        "rep": (Customer.rep_id, func.max(User.full_name)),
        "family": (pm.c.family, None),
        "day": (when, None),
        "month": (func.date_trunc("month", when), None),
        "year": (func.date_trunc("year", when), None),
    }

    cols, group = [], []
    for d in dims:
        k, lab = exprs[d]
        cols.append(k.label(f"{d}__k"))
        group.append(k)
        if lab is not None:
            cols.append(lab.label(f"{d}__l"))
    if "party" in dims:
        cols.append(func.max(func.coalesce(Customer.code, Supplier.code)).label("party_code"))
        cols.append(func.max(func.coalesce(Customer.phone, Supplier.phone)).label("party_phone"))
    if "account" in dims:
        cols.append(func.max(cast(acc.normal_side, String)).label("normal_side"))

    measures = [
        (s(case((before, signed), else_=0)) if before is not None and not has_period
         else literal(0)).label("opening"),
        s(case((in_range, debit), else_=0)).label("debit"),
        s(case((in_range, credit), else_=0)).label("credit"),
        func.count(func.distinct(case((in_range, en.id)))).label("entries"),
    ]

    stmt = (select(*cols, *measures).select_from(ln)
            .join(en, en.id == ln.entry_id)
            .join(acc, acc.id == ln.account_id)
            .outerjoin(parent, parent.id == acc.parent_id)
            .outerjoin(pm, pm.c.account_id == acc.id)
            .outerjoin(Customer, and_(pm.c.kind == "customer", Customer.id == pm.c.party_id))
            .outerjoin(Supplier, and_(pm.c.kind == "supplier", Supplier.id == pm.c.party_id))
            .outerjoin(Territory, Territory.id == Customer.territory_id)
            .outerjoin(User, User.id == Customer.rep_id)
            .outerjoin(Branch, Branch.id == func.coalesce(en.branch_id, acc.branch_id))
            .outerjoin(CostCenter, CostCenter.id == ln.cost_center_id)
            .where(ledger_service.in_books_sql(posted_only)))
    if date_to:
        stmt = stmt.where(when <= date_to)
    if has_period and date_from:
        stmt = stmt.where(when >= date_from)
    if branch_id is not None:
        stmt = stmt.where(or_(en.branch_id == branch_id,
                              and_(en.branch_id.is_(None), acc.branch_id == branch_id)))
    if account_id is not None:
        stmt = stmt.where(or_(acc.id == account_id, acc.parent_id == account_id,
                              parent.parent_id == account_id))
    if account_type:
        stmt = stmt.where(cast(acc.account_type, String) == account_type)
    if party_kind:
        stmt = stmt.where(pm.c.kind == party_kind)
    if party_id is not None:
        stmt = stmt.where(pm.c.party_id == party_id)
    if territory_id is not None:
        stmt = stmt.where(Customer.territory_id == territory_id)
    if rep_id is not None:
        stmt = stmt.where(Customer.rep_id == rep_id)
    if cost_center_id is not None:
        stmt = stmt.where(ln.cost_center_id == cost_center_id)
    if group:
        stmt = stmt.group_by(*group)

    raw = db.execute(stmt.limit(MAX_ROWS + 1)).mappings().all()
    truncated = len(raw) > MAX_ROWS

    def label(d, k, r):
        if k is None:
            return {"cost_center": "بدون مركز تكلفة", "territory": "بدون منطقة",
                    "rep": "بدون مندوب", "branch": "بدون فرع", "party": "—",
                    "party_kind": "حسابات عامة", "family": "—"}.get(d, "—")
        if d == "account_type":
            return TYPE_LABELS.get(k, k)
        if d == "nature":
            return NATURE_LABELS.get(k, k)
        if d == "party_kind":
            return PARTY_KIND_LABELS.get(k, k)
        if d == "day":
            return str(k)[:10]
        if d == "month":
            return str(k)[:7]
        if d == "year":
            return str(k)[:4]
        lab = r.get(f"{d}__l")
        return (lab or "").strip() or str(k)

    rows = []
    zero = Decimal(0)
    tot = {"opening": zero, "debit": zero, "credit": zero, "closing": zero, "entries": 0}
    for r in raw[:MAX_ROWS]:
        opening = Decimal(str(r["opening"] or 0))
        dr = Decimal(str(r["debit"] or 0))
        cr = Decimal(str(r["credit"] or 0))
        closing = opening + dr - cr
        if nonzero and not (opening or dr or cr):
            continue
        out = {}
        for d in dims:
            k = r[f"{d}__k"]
            if d in ("day", "month", "year") and k is not None:
                k = str(k)[:10]
            out[d] = label(d, k, r)
            out[f"{d}_id"] = k
        if "party" in dims:
            out["party_code"] = r["party_code"]
            out["party_phone"] = r["party_phone"]
        if "account" in dims:
            out["normal_side"] = "مدين" if r["normal_side"] == "debit" else "دائن"
        out.update({
            "opening": str(to_money(opening)),
            "opening_debit": str(to_money(max(opening, zero))),
            "opening_credit": str(to_money(max(-opening, zero))),
            "debit": str(to_money(dr)), "credit": str(to_money(cr)),
            "net": str(to_money(dr - cr)),
            "closing": str(to_money(closing)),
            "closing_debit": str(to_money(max(closing, zero))),
            "closing_credit": str(to_money(max(-closing, zero))),
            "entries": int(r["entries"] or 0),
        })
        rows.append(out)
        tot["opening"] += opening
        tot["debit"] += dr
        tot["credit"] += cr
        tot["closing"] += closing
        tot["entries"] += int(r["entries"] or 0)
    rows.sort(key=lambda x: tuple(str(x.get(f"{d}_id") if d in ("day", "month", "year") else x.get(d) or "")
                                  for d in dims))
    totals = {k: (v if k == "entries" else str(to_money(v))) for k, v in tot.items()}
    totals["closing_debit"] = str(to_money(sum((Decimal(r["closing_debit"]) for r in rows), zero)))
    totals["closing_credit"] = str(to_money(sum((Decimal(r["closing_credit"]) for r in rows), zero)))
    return {"dims": dims, "rows": rows, "totals": totals, "truncated": truncated}
