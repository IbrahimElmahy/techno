from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee
from src.models.hr_advance import AdvanceStatus, EmployeeAdvance, EmployeeAdvanceInstalment
from src.models.ledger import Account, AccountType, Direction, LedgerEntry, LedgerLine
from src.models.lookup import LookupOption
from src.models.org import Branch, Territory
from src.models.period_closing import (
    ClosingProductLine,
    PeriodClosing,
    PeriodClosingConfig,
    PeriodClosingLine,
)
from src.models.user import User
from src.models.warehouse import Warehouse
from src.services import inventory_valuation_service, ledger_service


class ClosingError(Exception):
    pass


def _d(v) -> Decimal:
    return Decimal(str(v)) if v is not None else ZERO


def _s(v: Decimal) -> str:
    return str(to_money(v))


_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def _norm(text: str | None) -> str:
    t = (text or "").translate(_ARABIC_DIGITS).strip()
    t = re.sub("[إأآ]", "ا", t).replace("ى", "ي").replace("ة", "ه").replace("ـ", "")
    return re.sub(r"\s+", " ", t)


def quarter_ends(upto: date, count: int = 6) -> list[date]:
    out: list[date] = []
    y, m = upto.year, upto.month
    q_end_month = ((m - 1) // 3) * 3 + 3
    cur = _month_end(y, q_end_month)
    if cur > upto:
        q_end_month -= 3
        if q_end_month <= 0:
            q_end_month += 12
            y -= 1
        cur = _month_end(y, q_end_month)
    if cur != upto:
        out.append(upto)
    while len(out) < count:
        out.append(cur)
        q_end_month -= 3
        if q_end_month <= 0:
            q_end_month += 12
            y -= 1
        cur = _month_end(y, q_end_month)
    return sorted(out)


def _month_end(y: int, m: int) -> date:
    nxt = date(y + (m // 12), (m % 12) + 1, 1)
    return nxt - timedelta(days=1)


ACCOUNT_KEYS: dict[str, tuple[str, tuple[str, ...]]] = {
    "customers": ("العملاء", ("العملاء",)),
    "suppliers": ("الموردين", ("الموردون", "الموردين")),
    "partners": ("جاري الشركاء / المسحوبات", ("جاري الشركاء", "المسحوبات")),
    "cash": ("النقدية (الخزائن والبنوك)", ("الخزينه", "البنوك")),
    "advances": ("سلف وذمم الموظفين", ("ذمم الموظفين",)),
    "accrued": ("مصروفات مستحقة", ("مصروفات مستحقه",)),
}


def _branch_accounts(db: Session, branch_id: int) -> list[Account]:
    return list(db.scalars(select(Account).where(Account.branch_id == branch_id)).all())


def _default_accounts(db: Session, branch_id: int) -> dict[str, list[int]]:
    accs = _branch_accounts(db, branch_id)
    groups = [a for a in accs if not a.is_postable]
    out: dict[str, list[int]] = {}
    for key, (_label, names) in ACCOUNT_KEYS.items():
        wanted = {_norm(n) for n in names}
        out[key] = [g.id for g in groups if _norm(g.name) in wanted]
    treas = [a.id for a in accs if a.account_type == AccountType.treasury]
    under = _descendants(db, out["cash"])
    out["cash"] += [t for t in treas if t not in under]
    return out


def _default_main_warehouses(db: Session, branch_id: int) -> list[int]:
    whs = db.scalars(select(Warehouse).where(Warehouse.branch_id == branch_id)
                     .order_by(Warehouse.id)).all()
    main = [w.id for w in whs if "رئيس" in _norm(w.name)]
    return main or ([whs[0].id] if whs else [])


def get_config(db: Session, branch_id: int) -> dict:
    row = db.scalar(select(PeriodClosingConfig).where(PeriodClosingConfig.branch_id == branch_id))
    saved = (row.data or {}) if row else {}
    defaults = _default_accounts(db, branch_id)
    accounts: dict[str, list[int]] = {}
    is_default: dict[str, bool] = {}
    for key in ACCOUNT_KEYS:
        ids = (saved.get("accounts") or {}).get(key)
        if ids:
            accounts[key] = [int(i) for i in ids]
            is_default[key] = False
        else:
            accounts[key] = defaults.get(key, [])
            is_default[key] = True
    mains = saved.get("main_warehouse_ids")
    return {
        "branch_id": branch_id,
        "accounts": accounts,
        "accounts_default": is_default,
        "account_labels": {k: v[0] for k, v in ACCOUNT_KEYS.items()},
        "main_warehouse_ids": [int(i) for i in mains] if mains
        else _default_main_warehouses(db, branch_id),
        "main_warehouse_default": not bool(mains),
    }


def save_config(db: Session, branch_id: int, data: dict, actor_id: int) -> dict:
    row = db.scalar(select(PeriodClosingConfig).where(PeriodClosingConfig.branch_id == branch_id))
    clean = {
        "accounts": {k: [int(i) for i in (data.get("accounts") or {}).get(k) or []]
                     for k in ACCOUNT_KEYS},
        "main_warehouse_ids": [int(i) for i in data.get("main_warehouse_ids") or []],
    }
    if row is None:
        row = PeriodClosingConfig(branch_id=branch_id, data=clean, updated_by=actor_id)
        db.add(row)
    else:
        row.data = clean
        row.updated_by = actor_id
    db.flush()
    return get_config(db, branch_id)


def _children_map(db: Session) -> dict[int, list[int]]:
    kids: dict[int, list[int]] = defaultdict(list)
    for aid, pid in db.execute(select(Account.id, Account.parent_id)).all():
        if pid is not None:
            kids[pid].append(aid)
    return kids


def _descendants(db: Session, ids, kids: dict[int, list[int]] | None = None) -> set[int]:
    kids = kids if kids is not None else _children_map(db)
    out: set[int] = set()
    stack = [int(i) for i in ids or []]
    while stack:
        cur = stack.pop()
        if cur in out:
            continue
        out.add(cur)
        stack.extend(kids.get(cur, []))
    return out


def balances_at(db: Session, account_ids, as_of: date) -> dict[int, Decimal]:
    ids = list({int(i) for i in account_ids or []})
    if not ids:
        return {}
    when = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    signed = case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
                  else_=-LedgerLine.amount)
    out: dict[int, Decimal] = {}
    for i in range(0, len(ids), 900):
        chunk = ids[i:i + 900]
        for aid, total in db.execute(
            select(LedgerLine.account_id, func.coalesce(func.sum(signed), 0))
            .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
            .where(LedgerLine.account_id.in_(chunk), ledger_service.is_posted_sql(),
                   when <= as_of)
            .group_by(LedgerLine.account_id)
        ).all():
            out[aid] = to_money(total or 0)
    return out


def _accounts_by_id(db: Session, ids) -> dict[int, Account]:
    ids = list({int(i) for i in ids or []})
    if not ids:
        return {}
    return {a.id: a for a in db.scalars(select(Account).where(Account.id.in_(ids))).all()}


def _leaf_rows(db: Session, group_ids, as_of: date, *, credit_positive: bool,
               kids=None, include_zero: bool = False) -> list[dict]:
    under = _descendants(db, group_ids, kids)
    bal = balances_at(db, under, as_of)
    accs = _accounts_by_id(db, under)
    rows = []
    for aid in under:
        acc = accs.get(aid)
        if acc is None or not acc.is_postable:
            continue
        v = bal.get(aid, ZERO)
        if credit_positive:
            v = -v
        if v == ZERO and not include_zero:
            continue
        parent = accs.get(acc.parent_id) if acc.parent_id else None
        rows.append({"account_id": aid, "code": acc.code, "name": acc.name or acc.code,
                     "group": parent.name if parent else None, "amount": _s(v)})
    rows.sort(key=lambda r: -abs(Decimal(r["amount"])))
    return rows


def _sum(rows, key="amount") -> Decimal:
    return to_money(sum((Decimal(str(r[key])) for r in rows), ZERO))


SECTIONS = {
    "customers_adj": "تعديلات مديونية العملاء",
    "suppliers_adj": "تعديلات الموردين",
    "technicians": "مستحقات الفنيين",
    "gifts": "رصيد الهدايا",
    "accrued": "مصروفات مستحقة",
    "partners_adj": "تعديلات جاري الشركاء",
    "cash": "النقدية (يدوي)",
    "bonuses": "بوانص التجار",
    "inventory_override": "قيمة يدوية لخط إنتاج",
    "inventory_extra": "مخزون إضافي",
    "balance_sheet": "بنود الميزانية اليدوية",
    "settlement": "تسوية المناطق",
}

DEFAULT_PARAMS = {
    "bonus": {"coupon_value": "73.4", "coupons_pct": "90", "cost_pct": "45",
              "per_count": "2", "per_base": "30", "unit_value": "180", "cash_bonus": "0"},
    "customers_group_by": "rep",
}


def _template_lines(year: int) -> list[dict]:
    L = []

    def add(section, label, *, qty=None, rate=None, amount=None, sign=1, group=None):
        L.append({"section": section, "label": label, "quantity": qty, "rate": rate,
                  "amount": amount, "sign": sign, "group_key": group})

    add("customers_adj", "مخصص ديون معدومة", amount="0", sign=-1)
    for y in (year - 2, year - 1, year):
        add("technicians", f"كوبونات {y}", qty="0", rate="5.5")
    add("technicians", "كوبونات التجار (ذهبي)", qty="0", rate="180")
    add("technicians", "مخصص حفلات", amount="0")
    add("technicians", "نقاط البنك", qty="0", rate="7.5")
    add("gifts", "رصيد هدايا المشتريات", amount="0")
    add("gifts", "رصيد مخزن خدمة العملاء", amount="0")
    add("gifts", "هدايا مستحقة للفنيين", qty="0", rate="40", sign=-1)
    for y in (year - 2, year - 1, year):
        add("gifts", f"نقاط مستحقة {y}", qty="0", rate="0.5", sign=-1)
    for label in ("مخصص صيانة للسيارات", "مرتبات مستحقة", "عمولة خدمة عملاء مستحقة",
                  "عمولة بيع مستحقة", "ضرائب"):
        add("accrued", label, amount="0")
    add("cash", "عملة أجنبية (دولار)", qty="0", rate="0")
    add("cash", "عهدة خدمة العملاء", amount="0")
    add("balance_sheet", "الأصول الثابتة", amount="0", group="asset")
    add("balance_sheet", "الإهلاك", amount="0", group="liability")
    return L


def _line_amount(ln) -> Decimal:
    q, r = getattr(ln, "quantity", None), getattr(ln, "rate", None)
    if isinstance(ln, dict):
        q, r = ln.get("quantity"), ln.get("rate")
    if q not in (None, "") and r not in (None, ""):
        return to_money(_d(q) * _d(r))
    a = ln.get("amount") if isinstance(ln, dict) else ln.amount
    return to_money(_d(a or 0))


def _line_out(ln: PeriodClosingLine) -> dict:
    amt = _line_amount(ln)
    return {
        "id": ln.id, "section": ln.section, "group_key": ln.group_key, "label": ln.label,
        "quantity": None if ln.quantity is None else str(to_qty(ln.quantity)),
        "rate": None if ln.rate is None else str(Decimal(str(ln.rate)).normalize()),
        "amount": _s(amt), "sign": ln.sign or 1, "signed": _s(amt * (ln.sign or 1)),
        "sort_order": ln.sort_order, "note": ln.note, "source": "manual",
    }


def closing_out(db: Session, c: PeriodClosing, *, with_lines: bool = True) -> dict:
    out = {
        "id": c.id, "branch_id": c.branch_id, "closing_date": c.closing_date.isoformat(),
        "status": c.status, "notes": c.notes,
        "params": _params(c), "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "finalized_at": c.finalized_at.isoformat() if c.finalized_at else None,
    }
    if with_lines:
        lines = db.scalars(select(PeriodClosingLine).where(PeriodClosingLine.closing_id == c.id)
                           .order_by(PeriodClosingLine.section, PeriodClosingLine.sort_order,
                                     PeriodClosingLine.id)).all()
        out["lines"] = [_line_out(ln) for ln in lines]
    return out


def _params(c: PeriodClosing | None) -> dict:
    p = {"bonus": dict(DEFAULT_PARAMS["bonus"]),
         "customers_group_by": DEFAULT_PARAMS["customers_group_by"]}
    if c is not None and c.params:
        p["bonus"].update({k: str(v) for k, v in (c.params.get("bonus") or {}).items()
                           if v not in (None, "")})
        if c.params.get("customers_group_by") in ("rep", "territory"):
            p["customers_group_by"] = c.params["customers_group_by"]
    return p


def list_closings(db: Session, branch_id: int) -> list[dict]:
    rows = db.scalars(select(PeriodClosing).where(PeriodClosing.branch_id == branch_id)
                      .order_by(PeriodClosing.closing_date.desc())).all()
    return [closing_out(db, c, with_lines=False) for c in rows]


def find_closing(db: Session, branch_id: int, as_of: date) -> PeriodClosing | None:
    return db.scalar(select(PeriodClosing).where(PeriodClosing.branch_id == branch_id,
                                                 PeriodClosing.closing_date == as_of))


def create_closing(db: Session, *, branch_id: int, closing_date: date, actor_id: int,
                   copy_previous: bool = True) -> PeriodClosing:
    if find_closing(db, branch_id, closing_date):
        raise ClosingError("يوجد إقفال لهذا الفرع في التاريخ نفسه.")
    prev = None
    if copy_previous:
        prev = db.scalar(select(PeriodClosing).where(
            PeriodClosing.branch_id == branch_id, PeriodClosing.closing_date < closing_date)
            .order_by(PeriodClosing.closing_date.desc()).limit(1))
    c = PeriodClosing(branch_id=branch_id, closing_date=closing_date, status="draft",
                      params=(prev.params if prev else None), created_by=actor_id)
    db.add(c)
    db.flush()
    if prev is not None:
        src = db.scalars(select(PeriodClosingLine).where(
            PeriodClosingLine.closing_id == prev.id)).all()
        for ln in src:
            db.add(PeriodClosingLine(
                closing_id=c.id, section=ln.section, group_key=ln.group_key, label=ln.label,
                quantity=ln.quantity, rate=ln.rate, amount=ln.amount, sign=ln.sign,
                sort_order=ln.sort_order, note=ln.note))
    else:
        for i, t in enumerate(_template_lines(closing_date.year)):
            db.add(PeriodClosingLine(
                closing_id=c.id, section=t["section"], group_key=t.get("group_key"),
                label=t["label"], quantity=_opt(t.get("quantity")), rate=_opt(t.get("rate")),
                amount=_line_amount(t), sign=t.get("sign") or 1, sort_order=i))
    db.flush()
    return c


def _opt(v):
    return None if v in (None, "") else Decimal(str(v))


def save_closing(db: Session, c: PeriodClosing, *, notes: str | None, params: dict | None,
                 lines: list[dict] | None) -> PeriodClosing:
    if c.status == "final":
        raise ClosingError("الإقفال معتمد، ويجب إعادته إلى مسودة قبل التعديل.")
    if notes is not None:
        c.notes = notes[:500] or None
    if params is not None:
        c.params = {"bonus": {k: str(v) for k, v in (params.get("bonus") or {}).items()
                              if v not in (None, "")},
                    "customers_group_by": params.get("customers_group_by") or "rep"}
    if lines is not None:
        for old in db.scalars(select(PeriodClosingLine).where(
                PeriodClosingLine.closing_id == c.id)).all():
            db.delete(old)
        db.flush()
        for i, ln in enumerate(lines):
            section = str(ln.get("section") or "")
            if section not in SECTIONS:
                raise ClosingError(f"قسم غير معروف: {section}")
            db.add(PeriodClosingLine(
                closing_id=c.id, section=section,
                group_key=(str(ln["group_key"])[:60] if ln.get("group_key") not in (None, "")
                           else None),
                label=str(ln.get("label") or "")[:160], quantity=_opt(ln.get("quantity")),
                rate=_opt(ln.get("rate")), amount=_line_amount(ln),
                sign=-1 if int(ln.get("sign") or 1) < 0 else 1,
                sort_order=int(ln.get("sort_order") if ln.get("sort_order") is not None else i),
                note=(str(ln["note"])[:255] if ln.get("note") else None)))
    db.flush()
    return c


def _lines_of(db: Session, c: PeriodClosing | None) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    if c is None:
        return out
    for ln in db.scalars(select(PeriodClosingLine).where(PeriodClosingLine.closing_id == c.id)
                         .order_by(PeriodClosingLine.sort_order, PeriodClosingLine.id)).all():
        out[ln.section].append(_line_out(ln))
    return out


def _item_category_labels(db: Session) -> dict[str, str]:
    from src.services import lookup_service

    return dict(db.execute(select(LookupOption.value, LookupOption.label).where(
        LookupOption.category == lookup_service.ITEM_CATEGORY)).all())


def product_lines(db: Session, branch_id: int) -> list[ClosingProductLine]:
    return list(db.scalars(select(ClosingProductLine).where(
        ClosingProductLine.branch_id == branch_id)
        .order_by(ClosingProductLine.sort_order, ClosingProductLine.id)).all())


def product_line_out(pl: ClosingProductLine) -> dict:
    return {"id": pl.id, "name": pl.name, "sort_order": pl.sort_order,
            "categories": list(pl.categories or []), "name_prefixes": list(pl.name_prefixes or []),
            "basis": pl.basis, "factor_pct": str(Decimal(str(pl.factor_pct)).normalize()),
            "active": pl.active}


def save_product_lines(db: Session, branch_id: int, lines: list[dict]) -> list[dict]:
    for old in product_lines(db, branch_id):
        db.delete(old)
    db.flush()
    for i, ln in enumerate(lines):
        name = str(ln.get("name") or "").strip()
        if not name:
            raise ClosingError("يجب إدخال اسم لكل خط إنتاج.")
        basis = ln.get("basis") if ln.get("basis") in ("cost", "list") else "cost"
        factor = _d(ln.get("factor_pct") if ln.get("factor_pct") not in (None, "") else 100)
        if factor < 0 or factor > 1000:
            raise ClosingError(f"نسبة التقييم غير صحيحة في «{name}».")
        db.add(ClosingProductLine(
            branch_id=branch_id, name=name[:80], sort_order=i,
            categories=[str(c) for c in ln.get("categories") or []],
            name_prefixes=[str(p) for p in ln.get("name_prefixes") or [] if str(p).strip()],
            basis=basis, factor_pct=factor, active=bool(ln.get("active", True))))
    db.flush()
    return [product_line_out(p) for p in product_lines(db, branch_id)]


def inventory(db: Session, branch_id: int, as_of: date, *, closing: PeriodClosing | None = None,
              cfg: dict | None = None, lines_by_section=None, with_items: bool = True) -> dict:
    cfg = cfg or get_config(db, branch_id)
    lines_by_section = lines_by_section if lines_by_section is not None else _lines_of(db, closing)
    val = inventory_valuation_service.value_at(db, branch_id=branch_id, as_of=as_of,
                                               cost_basis="average", with_rows=True)
    mains = set(cfg["main_warehouse_ids"])
    labels = _item_category_labels(db)
    item_ids = {r["item_id"] for r in val.rows}
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(item_ids or [-1]))).all()}

    configured = [pl for pl in product_lines(db, branch_id) if pl.active]
    auto = not configured
    if auto:
        cats = sorted({r["category"] for r in val.rows})
        plines = [{"id": f"cat:{c}", "name": labels.get(c, c), "categories": [c],
                   "prefixes": [], "basis": "cost", "factor": Decimal(100)} for c in cats]
    else:
        plines = [{"id": pl.id, "name": pl.name, "categories": list(pl.categories or []),
                   "prefixes": [_norm(p) for p in pl.name_prefixes or [] if p],
                   "basis": pl.basis, "factor": _d(pl.factor_pct)} for pl in configured]

    def line_of(item: Item | None, category: str):
        name = _norm(item.name if item else "")
        for pl in plines:
            if pl["categories"] and category not in pl["categories"]:
                continue
            if not pl["categories"] and not pl["prefixes"]:
                continue
            if pl["prefixes"] and not any(name.startswith(p) for p in pl["prefixes"]):
                continue
            return pl
        return None

    buckets: dict = {}
    for r in val.rows:
        item = items.get(r["item_id"])
        pl = line_of(item, r["category"])
        key = pl["id"] if pl else "__unassigned__"
        basis = pl["basis"] if pl else "cost"
        cost = _d(r["unit_cost"])
        has_price = item is not None and item.sale_price is not None
        list_price = _d(item.sale_price) if has_price else ZERO
        price = list_price if basis == "list" else cost
        price_source = "list" if basis == "list" else r["cost_source"]
        if basis == "list" and list_price <= 0:
            price, price_source = cost, f"fallback:{r['cost_source']}"
        qty = _d(r["quantity"])
        b = buckets.setdefault((key, r["item_id"]), {
            "item_id": r["item_id"], "code": r["item_code"], "name": r["item_name"],
            "category": labels.get(r["category"], r["category"]),
            "unit_price": _s(price), "price_source": price_source,
            "qty_main": Decimal(0), "qty_other": Decimal(0)})
        if r["warehouse_id"] in mains:
            b["qty_main"] += qty
        else:
            b["qty_other"] += qty

    overrides = {ln["group_key"]: ln for ln in lines_by_section.get("inventory_override", [])
                 if ln.get("group_key")}
    out_lines = []
    unassigned = None
    grand = ZERO
    for pl in plines + [{"id": "__unassigned__", "name": "أصناف خارج الخطوط",
                         "basis": "cost", "factor": Decimal(100), "categories": [],
                         "prefixes": []}]:
        rows = [b for (k, _), b in buckets.items() if k == pl["id"]]
        gm = go = ZERO
        item_rows = []
        for b in sorted(rows, key=lambda x: x["name"] or ""):
            price = _d(b["unit_price"])
            vm, vo = to_money(b["qty_main"] * price), to_money(b["qty_other"] * price)
            gm += vm
            go += vo
            if with_items:
                item_rows.append({**b, "qty_main": str(to_qty(b["qty_main"])),
                                  "qty_other": str(to_qty(b["qty_other"])),
                                  "value_main": _s(vm), "value_other": _s(vo),
                                  "value": _s(vm + vo)})
        factor = pl["factor"]
        net_system = to_money((gm + go) * factor / 100)
        ov = overrides.get(str(pl["id"]))
        net = _d(ov["amount"]) if ov else net_system
        block = {
            "id": pl["id"], "name": pl["name"], "basis": pl["basis"], "factor_pct": str(factor),
            "categories": [labels.get(c, c) for c in pl["categories"]],
            "gross_main": _s(gm), "gross_other": _s(go), "gross": _s(gm + go),
            "net_main": _s(gm * factor / 100), "net_other": _s(go * factor / 100),
            "net_system": _s(net_system), "value": _s(net),
            "source": "manual" if ov else "system",
            "override_note": ov.get("label") if ov else None,
            "items_count": len(rows),
        }
        if with_items:
            block["items"] = item_rows
        if pl["id"] == "__unassigned__":
            if rows:
                unassigned = block
            continue
        grand += net
        out_lines.append(block)

    extras = lines_by_section.get("inventory_extra", [])
    extra_total = _sum(extras, "signed")
    total = to_money(grand + extra_total)
    return {
        "as_of": as_of.isoformat(), "auto_lines": auto, "lines": out_lines,
        "unassigned": unassigned, "extras": extras, "extras_total": _s(extra_total),
        "lines_total": _s(grand), "total": _s(total),
        "main_warehouses": [{"id": w.id, "name": w.name} for w in db.scalars(
            select(Warehouse).where(Warehouse.id.in_(mains or {-1}))).all()],
        "missing_cost": val.missing_cost,
    }


def _rep_names(db: Session, ids) -> dict[int, str]:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    return {u.id: (u.full_name or u.username) for u in db.scalars(
        select(User).where(User.id.in_(ids))).all()}


def customers_block(db: Session, cfg: dict, as_of: date, *, group_by: str, adj: list[dict],
                    kids=None) -> dict:
    under = _descendants(db, cfg["accounts"]["customers"], kids)
    bal = balances_at(db, under, as_of)
    links = db.execute(select(CustomerAccount.account_id, Customer.id, Customer.rep_id,
                              Customer.territory_id)
                       .join(Customer, Customer.id == CustomerAccount.customer_id)
                       .where(CustomerAccount.account_id.in_(under or {-1}))).all()
    by_acc = {a: (cid, rep, terr) for a, cid, rep, terr in links}
    groups: dict = {}
    for aid, v in bal.items():
        if v == ZERO:
            continue
        cid, rep, terr = by_acc.get(aid, (None, None, None))
        key = (rep if group_by == "rep" else terr) if cid else "none"
        g = groups.setdefault(key, {"key": key, "amount": ZERO, "accounts": 0, "customers": set()})
        g["amount"] += v
        g["accounts"] += 1
        if cid:
            g["customers"].add(cid)
    names = (_rep_names(db, [k for k in groups if isinstance(k, int)]) if group_by == "rep"
             else {t.id: t.name for t in db.scalars(select(Territory).where(
                 Territory.id.in_([k for k in groups if isinstance(k, int)] or [-1]))).all()})
    rows = []
    for k, g in groups.items():
        label = ("حسابات غير مرتبطة بعميل" if k == "none"
                 else ("بدون مندوب" if group_by == "rep" else "بدون منطقة") if k is None
                 else names.get(k, f"#{k}"))
        rows.append({"key": k, "label": label, "amount": _s(g["amount"]),
                     "customers": len(g["customers"]), "source": "system"})
    rows.sort(key=lambda r: -Decimal(r["amount"]))
    system = _sum(rows)
    adj_total = _sum(adj, "signed")
    return {"group_by": group_by, "rows": rows, "system_total": _s(system),
            "adjustments": adj, "adjustments_total": _s(adj_total),
            "total": _s(system + adj_total), "account_ids": cfg["accounts"]["customers"]}


def _system_and_manual(rows: list[dict], manual: list[dict], account_ids) -> dict:
    system = _sum(rows)
    m = _sum(manual, "signed")
    return {"rows": rows, "system_total": _s(system), "manual": manual,
            "manual_total": _s(m), "total": _s(system + m), "account_ids": list(account_ids)}


def bonuses_block(lines: list[dict], params: dict) -> dict:
    p = {k: _d(v) for k, v in params.items()}
    years = sorted({ln["group_key"] or "" for ln in lines})
    cars: dict[str, dict] = {}
    for ln in lines:
        row = cars.setdefault(ln["label"], {"label": ln["label"], "years": {}, "total": ZERO})
        row["years"][ln["group_key"] or ""] = ln["amount"]
        row["total"] += _d(ln["signed"])
    by_year = {y: _s(sum((_d(ln["signed"]) for ln in lines if (ln["group_key"] or "") == y),
                         ZERO)) for y in years}
    total = to_money(sum((_d(ln["signed"]) for ln in lines), ZERO))
    cv = p.get("coupon_value") or ZERO
    coupons = (total / (cv * p["coupons_pct"] / 100)) if cv and p.get("coupons_pct") else ZERO
    coupon_cost = to_money(coupons * cv * p["cost_pct"] / 100)
    extra_count = (coupons * p["per_count"] / p["per_base"]) if p.get("per_base") else ZERO
    extra_value = to_money(extra_count * p["unit_value"])
    cash = to_money(p.get("cash_bonus") or ZERO)
    net = to_money(coupon_cost + extra_value + cash)
    return {
        "years": years, "rows": [{**r, "total": _s(r["total"])} for r in cars.values()],
        "by_year": by_year, "total": _s(total),
        "calc": [
            {"label": "إجمالي البوانص", "value": _s(total)},
            {"label": f"عدد الكوبونات المكافئة (÷ {p['coupon_value']} × {p['coupons_pct']}٪)",
             "value": str(coupons.quantize(Decimal('0.01')))},
            {"label": f"تكلفة الكوبونات ({p['cost_pct']}٪ من قيمتها)", "value": _s(coupon_cost)},
            {"label": f"كوبونات البوانص ({p['per_count']} لكل {p['per_base']})",
             "value": str(extra_count.quantize(Decimal('0.01')))},
            {"label": f"قيمة كوبونات البوانص (× {p['unit_value']})", "value": _s(extra_value)},
            {"label": "بوانص نقدي", "value": _s(cash)},
        ],
        "net": _s(net), "params": {k: str(v) for k, v in p.items()},
    }


def advances_block(db: Session, cfg: dict, branch_id: int, dates: list[date], kids=None) -> dict:
    group_ids = cfg["accounts"]["advances"]
    under = _descendants(db, group_ids, kids)
    accs = _accounts_by_id(db, under)
    per_date = {d: balances_at(db, under, d) for d in dates}
    rows: dict = {}
    for d, bal in per_date.items():
        for aid, v in bal.items():
            acc = accs.get(aid)
            if acc is None or not acc.is_postable:
                continue
            r = rows.setdefault(f"acc:{aid}", {"key": f"acc:{aid}", "account_id": aid,
                                               "label": acc.name or acc.code, "code": acc.code,
                                               "source": "system", "values": {}})
            r["values"][d.isoformat()] = _s(v)

    advs = db.scalars(select(EmployeeAdvance).where(
        EmployeeAdvance.status != AdvanceStatus.cancelled,
        (EmployeeAdvance.branch_id == branch_id) | EmployeeAdvance.branch_id.is_(None))).all()
    if advs:
        skip_entries: set[int] = set()
        entry_ids = [a.ledger_entry_id for a in advs if a.ledger_entry_id]
        if entry_ids and under:
            skip_entries = set(db.scalars(select(LedgerLine.entry_id).where(
                LedgerLine.entry_id.in_(entry_ids), LedgerLine.account_id.in_(under))).all())
        inst = defaultdict(list)
        for p in db.scalars(select(EmployeeAdvanceInstalment).where(
                EmployeeAdvanceInstalment.advance_id.in_([a.id for a in advs]))).all():
            inst[p.advance_id].append(p)
        emps = {e.id: e.name for e in db.scalars(select(Employee).where(
            Employee.id.in_({a.employee_id for a in advs}))).all()}
        for a in advs:
            if a.ledger_entry_id in skip_entries:
                continue
            for d in dates:
                if a.advance_date > d:
                    continue
                left = sum((_d(p.amount) for p in inst[a.id]
                            if (p.year, p.month) > (d.year, d.month) or p.payroll_line_id is None),
                           ZERO)
                if left == ZERO:
                    continue
                r = rows.setdefault(f"emp:{a.employee_id}", {
                    "key": f"emp:{a.employee_id}", "account_id": None,
                    "label": f"{emps.get(a.employee_id, '')} (سلفة مرتب)", "code": None,
                    "source": "system", "values": {}})
                r["values"][d.isoformat()] = _s(_d(r["values"].get(d.isoformat())) + left)

    out_rows = [r for r in rows.values()
                if any(_d(v) != ZERO for v in r["values"].values())]
    out_rows.sort(key=lambda r: -abs(_d(r["values"].get(dates[-1].isoformat()))))
    totals = {d.isoformat(): _s(sum((_d(r["values"].get(d.isoformat())) for r in out_rows),
                                    ZERO)) for d in dates}
    return {"dates": [d.isoformat() for d in dates], "rows": out_rows, "totals": totals,
            "account_ids": list(group_ids)}


def balances(db: Session, branch_id: int, as_of: date, *, closing: PeriodClosing | None = None,
             cfg: dict | None = None, lines_by_section=None, kids=None) -> dict:
    cfg = cfg or get_config(db, branch_id)
    kids = kids if kids is not None else _children_map(db)
    L = lines_by_section if lines_by_section is not None else _lines_of(db, closing)
    params = _params(closing)
    acc = cfg["accounts"]

    customers = customers_block(db, cfg, as_of, group_by=params["customers_group_by"],
                                adj=L.get("customers_adj", []), kids=kids)
    suppliers = _system_and_manual(
        _leaf_rows(db, acc["suppliers"], as_of, credit_positive=True, kids=kids),
        L.get("suppliers_adj", []), acc["suppliers"])
    partners = _system_and_manual(
        _leaf_rows(db, acc["partners"], as_of, credit_positive=False, kids=kids),
        L.get("partners_adj", []), acc["partners"])
    accrued = _system_and_manual(
        _leaf_rows(db, acc["accrued"], as_of, credit_positive=True, kids=kids),
        L.get("accrued", []), acc["accrued"])
    adv = advances_block(db, cfg, branch_id, [as_of], kids=kids)
    cash_rows = _leaf_rows(db, acc["cash"], as_of, credit_positive=False, kids=kids)
    adv_total = _d(adv["totals"][as_of.isoformat()])
    if adv_total != ZERO:
        cash_rows.append({"account_id": None, "code": None, "name": "السلف (سلف الموظفين)",
                          "group": None, "amount": _s(adv_total), "link": "advances"})
    cash = _system_and_manual(cash_rows, L.get("cash", []), acc["cash"])
    technicians = {"rows": L.get("technicians", []),
                   "total": _s(_sum(L.get("technicians", []), "signed"))}
    gifts = {"rows": L.get("gifts", []), "total": _s(_sum(L.get("gifts", []), "signed"))}
    bonuses = bonuses_block(L.get("bonuses", []), params["bonus"])
    return {"as_of": as_of.isoformat(), "customers": customers, "suppliers": suppliers,
            "technicians": technicians, "gifts": gifts, "accrued": accrued,
            "partners": partners, "cash": cash, "bonuses": bonuses, "params": params}


def balance_sheet(inv: dict, bal: dict, manual: list[dict]) -> dict:
    def item(key, label, amount, source, link=None):
        return {"key": key, "label": label, "amount": _s(_d(amount)), "source": source,
                "link": link}

    cash, inv_total = _d(bal["cash"]["total"]), _d(inv["total"])
    cust = _d(bal["customers"]["total"])
    current = [
        item("cash", "النقدية", cash, "mixed", {"accounts": bal["cash"]["account_ids"]}),
        item("inventory", "المخزون", inv_total, "mixed", {"block": "inventory"}),
        item("customers", "العملاء", cust, "mixed", {"accounts": bal["customers"]["account_ids"]}),
    ]
    m_assets = [m for m in manual if (m.get("group_key") or "asset") == "asset"]
    m_liab = [m for m in manual if m.get("group_key") == "liability"]
    m_memo = [m for m in manual if m.get("group_key") == "memo"]
    fixed = [item(f"m{m['id']}", m["label"], m["signed"], "manual") for m in m_assets]
    other = [item("partners", "مسحوبات الشركاء", bal["partners"]["total"], "mixed",
                  {"accounts": bal["partners"]["account_ids"]})]
    current_total = to_money(sum((_d(x["amount"]) for x in current), ZERO))
    fixed_total = to_money(sum((_d(x["amount"]) for x in fixed), ZERO))
    other_total = to_money(sum((_d(x["amount"]) for x in other), ZERO))
    assets_total = to_money(current_total + fixed_total + other_total)

    liabilities = [
        item("suppliers", "الموردين", bal["suppliers"]["total"], "mixed",
             {"accounts": bal["suppliers"]["account_ids"]}),
        item("accrued", "مصروفات مستحقة", bal["accrued"]["total"], "mixed",
             {"accounts": bal["accrued"]["account_ids"]}),
        item("bonuses", "قيمة بوانص التجار", bal["bonuses"]["net"], "manual",
             {"block": "bonuses"}),
        item("technicians", "مستحقات الفنيين", bal["technicians"]["total"], "manual",
             {"block": "technicians"}),
    ] + [item(f"m{m['id']}", m["label"], m["signed"], "manual") for m in m_liab]
    liab_total = to_money(sum((_d(x["amount"]) for x in liabilities), ZERO))
    equity = to_money(assets_total - liab_total)
    return {
        "assets": {"current": current, "current_total": _s(current_total),
                   "fixed": fixed, "fixed_total": _s(fixed_total),
                   "other": other, "other_total": _s(other_total), "total": _s(assets_total)},
        "liabilities": {"rows": liabilities, "total": _s(liab_total)},
        "equity": {"rows": [item("partners_equity", "جاري الشركاء (الفرق)", equity, "computed")],
                   "total": _s(equity)},
        "total": _s(liab_total + equity),
        "memo": [item(f"m{m['id']}", m["label"], m["signed"], "manual") for m in m_memo],
    }


def territory_debt(db: Session, cfg: dict, as_of: date, territory_ids,
                   kids=None) -> dict[int, Decimal]:
    under = _descendants(db, cfg["accounts"]["customers"], kids)
    links = db.execute(select(CustomerAccount.account_id, Customer.territory_id)
                       .join(Customer, Customer.id == CustomerAccount.customer_id)
                       .where(CustomerAccount.account_id.in_(under or {-1}),
                              Customer.territory_id.in_(list(territory_ids) or [-1]))).all()
    bal = balances_at(db, [a for a, _ in links], as_of)
    out: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for aid, terr in links:
        out[terr] += bal.get(aid, ZERO)
    return out


def settlement(db: Session, branch_id: int, as_of: date, *, cfg: dict | None = None,
               lines_by_section=None, closing=None, kids=None) -> dict:
    cfg = cfg or get_config(db, branch_id)
    L = lines_by_section if lines_by_section is not None else _lines_of(db, closing)
    lines = L.get("settlement", [])
    terr_ids = []
    for ln in lines:
        try:
            terr_ids.append(int(ln["group_key"]))
        except (TypeError, ValueError):
            pass
    terr_ids = list(dict.fromkeys(terr_ids))
    debt = territory_debt(db, cfg, as_of, terr_ids, kids)
    names = {t.id: t.name for t in db.scalars(select(Territory).where(
        Territory.id.in_(terr_ids or [-1]))).all()}
    areas = []
    for tid in terr_ids:
        mine = [ln for ln in lines if ln["group_key"] == str(tid) and ln["label"]]
        ded = _sum(mine, "signed")
        d = to_money(debt.get(tid, ZERO))
        areas.append({"territory_id": tid, "name": names.get(tid, f"#{tid}"), "debt": _s(d),
                      "deductions": mine, "deductions_total": _s(ded),
                      "net": _s(d - ded)})
    return {"areas": areas, "territories": [
        {"id": t.id, "name": t.name} for t in db.scalars(select(Territory).where(
            Territory.branch_id == branch_id).order_by(Territory.name)).all()]}


def package(db: Session, branch_id: int, as_of: date, *, blocks=None,
            advance_dates: list[date] | None = None, use_snapshot: bool = True,
            with_items: bool = True) -> dict:
    closing = find_closing(db, branch_id, as_of)
    want = set(blocks or ("inventory", "balances", "balance_sheet", "settlement", "advances"))
    branch = db.get(Branch, branch_id)
    head = {"branch_id": branch_id, "branch_name": branch.name if branch else None,
            "as_of": as_of.isoformat(),
            "closing": closing_out(db, closing) if closing else None}
    if closing is not None and closing.status == "final" and closing.snapshot and use_snapshot:
        snap = dict(closing.snapshot)
        snap.update(head)
        snap["frozen"] = True
        return snap
    cfg = get_config(db, branch_id)
    kids = _children_map(db)
    L = _lines_of(db, closing)
    out = {**head, "frozen": False, "config": cfg}
    inv = bal = None
    if want & {"inventory", "balance_sheet"}:
        inv = inventory(db, branch_id, as_of, closing=closing, cfg=cfg, lines_by_section=L,
                        with_items=with_items)
        if "inventory" in want:
            out["inventory"] = inv
    if want & {"balances", "balance_sheet"}:
        bal = balances(db, branch_id, as_of, closing=closing, cfg=cfg, lines_by_section=L,
                       kids=kids)
        if "balances" in want:
            out["balances"] = bal
    if "balance_sheet" in want:
        out["balance_sheet"] = balance_sheet(inv, bal, L.get("balance_sheet", []))
        if "inventory" not in want:
            out["inventory_total"] = inv["total"]
    if "settlement" in want:
        out["settlement"] = settlement(db, branch_id, as_of, cfg=cfg, lines_by_section=L,
                                       kids=kids)
    if "advances" in want:
        out["advances"] = advances_block(db, cfg, branch_id,
                                         advance_dates or quarter_ends(as_of), kids=kids)
    return out


def finalize(db: Session, c: PeriodClosing, actor_id: int) -> PeriodClosing:
    from datetime import datetime

    if c.status == "final":
        raise ClosingError("الإقفال معتمد بالفعل.")
    snap = package(db, c.branch_id, c.closing_date, use_snapshot=False)
    snap.pop("closing", None)
    c.snapshot = snap
    c.status = "final"
    c.finalized_by = actor_id
    c.finalized_at = datetime.utcnow()
    db.flush()
    return c


def reopen(db: Session, c: PeriodClosing) -> PeriodClosing:
    c.status = "draft"
    c.snapshot = None
    c.finalized_by = None
    c.finalized_at = None
    db.flush()
    return c


def account_tree(db: Session, branch_id: int) -> list[dict]:
    return [{"id": a.id, "parent_id": a.parent_id, "code": a.code, "name": a.name,
             "postable": a.is_postable}
            for a in db.scalars(select(Account).where(Account.branch_id == branch_id)
                                .order_by(Account.code)).all()]


def branch_warehouses(db: Session, branch_id: int) -> list[dict]:
    return [{"id": w.id, "name": w.name, "active": w.active} for w in db.scalars(
        select(Warehouse).where(Warehouse.branch_id == branch_id).order_by(Warehouse.id)).all()]


def category_options(db: Session, branch_id: int) -> list[dict]:
    from src.models.stock import LocationKind, StockMovement

    whs = select(Warehouse.id).where(Warehouse.branch_id == branch_id)
    cats = db.scalars(select(Item.category).distinct().join(
        StockMovement, StockMovement.item_id == Item.id).where(
        StockMovement.location_kind == LocationKind.warehouse,
        StockMovement.location_id.in_(whs), Item.category.is_not(None))).all()
    labels = _item_category_labels(db)
    return sorted([{"value": c, "label": labels.get(c, c)} for c in cats],
                  key=lambda x: x["label"])
