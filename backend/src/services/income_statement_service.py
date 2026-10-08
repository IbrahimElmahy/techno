from __future__ import annotations

import copy
import re
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.catalog import Item
from src.models.coupon_issue import CouponIssue
from src.models.coupon_receipt import CouponReceipt, receipt_counted
from src.models.customer import Customer
from src.models.income_statement_setting import IncomeStatementSetting
from src.models.ledger import Account, AccountType, LedgerEntry, LedgerLine
from src.models.org import Branch
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.services import inventory_valuation_service, ledger_service
from src.services.financial_reports_service import effective_nature


ROLES: dict[str, str] = {
    "ga": "مصاريف عمومية وإدارية",
    "marketing": "مصاريف بيع وتسويق (فعلي)",
    "other_income": "إيرادات أخرى",
    "other_loss": "خسائر أخرى",
    "direct_labor": "أجور مباشرة",
    "indirect_materials": "مواد غير مباشرة",
    "indirect_labor": "أجور غير مباشرة",
    "other_mfg": "مصاريف صناعية أخرى",
    "sales": "مبيعات (من الفواتير)",
    "sales_returns": "مردودات مبيعات (من المستندات)",
    "sales_discount": "خصم مسموح به / بونص",
    "purchases": "مشتريات (من الفواتير)",
    "purchase_returns": "مردودات مشتريات (من المستندات)",
    "excluded": "مستبعد من القائمة",
}
DOC_ROLES = ("sales", "sales_returns", "sales_discount", "purchases", "purchase_returns")
MFG_ROLES = ("direct_labor", "indirect_materials", "indirect_labor", "other_mfg")

ADJ_SECTIONS = ("ga", "marketing", "other_income", "other_loss", "cost")


DEFAULT_EXCLUDED_CATEGORIES = ["خدمة العملاء", "ادوات مكتبية", "كوبونات", "سياره جديده"]

DEFAULT_CONFIG: dict = {
    "sales": {
        "include_bonus": False,
        "categories": [
            {"key": "branches", "name": "الفروع", "customer_ids": [],
             "customer_name_words": ["ثيرم", "فرع"], "bonus_pct": 0},
            {"key": "poly", "name": "بولي",
             "item_categories": ["تكنو ثيرم", "تكنو ثيرم معزول"], "bonus_pct": 15},
            {"key": "retail", "name": "قطعي",
             "customer_types": ["showroom", "company", "employee", "establishment",
                                "plumber", "other"], "bonus_pct": 0},
            {"key": "drain", "name": "صرف", "bonus_pct": 3},
        ],
    },
    "inventory": {
        "cost_basis": "average",
        "exclude_categories": DEFAULT_EXCLUDED_CATEGORIES,
        "list_factors": {"تكنو ثيرم": 40, "تكنو ثيرم معزول": 40, "ابيض تكنوو": 60,
                         "ابيض تكنوو 110": 60, "تكنو جوان": 60},
    },
    "accounts": {
        "roles": {},
        "groups": [
            {"name": "اجور و مرتبات", "keywords": ["مرتبات", "اجور", "رواتب"], "account_ids": []},
            {"name": "قطع غيار وصيانة", "keywords": ["صيانه", "قطع غيار"], "account_ids": []},
            {"name": "سولار سيارة", "keywords": ["سولار", "بنزين"], "account_ids": []},
            {"name": "كارتة السيارات", "keywords": ["كارته"], "account_ids": []},
            {"name": "المكافأة", "keywords": ["مكافاه", "مكافات", "المكافا", "اكراميات"],
             "account_ids": []},
            {"name": "ايجارات", "keywords": ["ايجار"], "account_ids": []},
            {"name": "نولون وتنزيل", "keywords": ["نولون", "تنزيل"], "account_ids": []},
            {"name": "انتقالات وبدلات", "keywords": ["بدل", "انتقالات"], "account_ids": []},
            {"name": "مصروفات مخزنية", "keywords": ["مخزنيه", "مصاريف عامه"], "account_ids": []},
            {"name": "اتصالات ونت", "keywords": ["شحن رصيد", "اتصالات", "انترنت"],
             "account_ids": []},
            {"name": "مياه وكهرباء وغاز", "keywords": ["كهرباء", "مياه", "غاز"], "account_ids": []},
            {"name": "ادوات مكتبية", "keywords": ["مكتبيه"], "account_ids": []},
            {"name": "مصاريف ضيافة", "keywords": ["ضيافه"], "account_ids": []},
            {"name": "م خدمة العملاء", "keywords": ["خدمه العملاء"], "account_ids": []},
            {"name": "مخالفات سيارات الشركة", "keywords": ["مخالف"], "account_ids": []},
            {"name": "زيارات مرضية", "keywords": ["زيارات"], "account_ids": []},
        ],
    },
    "marketing": {
        "source": "model",
        "coupon_base": 73.4, "coupon_base_pct": 90,
        "ratio_num": 2, "ratio_den": 30,
        "coupon_cost": 180,
        "sales_coupons_source": "issued", "sales_coupons_manual": 0,
        "kind_values": {},
    },
    "periods": {},
}

_OWN_ROLE_RULES: list[tuple[tuple[str, ...], str]] = [
    (("تحت راتب", "تحت ح راتب"), "excluded"),
    (("المهمات",), "excluded"),
    (("نقاط", "كوبون", "عهده خدمه العملاء"), "marketing"),
]
_TREE_ROLE_RULES: list[tuple[tuple[str, ...], str]] = [
    (("مردودات المبيعات", "مردودات مبيعات", "مرتجعات المبيعات", "مرتجع مبيعات"), "sales_returns"),
    (("مردودات المشتريات", "مردودات مشتريات", "مرتجعات المشتريات"), "purchase_returns"),
    (("خصم مسموح",), "sales_discount"),
    (("خصم مكتسب",), "other_income"),
    (("المبيعات", "مبيعات"), "sales"),
    (("المشتريات", "مشتريات"), "purchases"),
    (("تحت راتب",), "excluded"),
]
_INCOME_ROLES = {"sales", "purchase_returns", "other_income"}
_EXPENSE_ROLES = {"sales_returns", "sales_discount", "purchases"}
_ROLE_BY_TYPE = {
    AccountType.sales_revenue: "sales",
    AccountType.purchases_expense: "purchases",
    AccountType.loyalty_expense: "marketing",
}

_AR_NORM = str.maketrans({"ة": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ـ": None})


def norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").translate(_AR_NORM)).strip()


def _has_word(name: str, word: str) -> bool:
    return re.search(rf"(^|\s){re.escape(norm(word))}(\s|$)", norm(name)) is not None


def D(value) -> Decimal:
    try:
        return Decimal(str(value)) if value not in (None, "") else ZERO
    except Exception:  # noqa: BLE001
        return ZERO


def _merge(base: dict, saved: dict | None) -> dict:
    out = copy.deepcopy(base)
    for key, value in (saved or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict) and key != "periods" \
                and key != "roles" and key != "list_factors" and key != "kind_values":
            out[key] = _merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _row(db: Session, branch_id: int | None) -> IncomeStatementSetting | None:
    cond = (IncomeStatementSetting.branch_id.is_(None) if branch_id is None
            else IncomeStatementSetting.branch_id == branch_id)
    return db.scalars(select(IncomeStatementSetting).where(cond).limit(1)).first()


def get_config(db: Session, branch_id: int | None) -> dict:
    company = _row(db, None)
    cfg = _merge(DEFAULT_CONFIG, company.config if company else None)
    if branch_id is not None:
        own = _row(db, branch_id)
        if own is not None:
            cfg = _merge(cfg, own.config)
    return cfg


def save_config(db: Session, branch_id: int | None, config: dict, *, actor_user_id: int) -> dict:
    row = _row(db, branch_id)
    if row is None:
        row = IncomeStatementSetting(branch_id=branch_id)
        db.add(row)
    row.config = copy.deepcopy(config)
    row.updated_by_user_id = actor_user_id
    db.flush()
    return get_config(db, branch_id)


def period_key(date_from: date, date_to: date) -> str:
    return f"{date_from.isoformat()}|{date_to.isoformat()}"


def _sales_rows(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
                include_bonus: bool) -> list[dict]:
    out: list[dict] = []

    def run(stmt, sign: int):
        for cid, cname, ctype, cat, fam, wh, value in db.execute(stmt).all():
            out.append({"customer_id": cid, "customer_name": cname or "",
                        "customer_type": ctype or "", "category": cat or "بدون فئة",
                        "family": fam or "", "warehouse_id": wh,
                        "value": D(value) * sign})

    after = 1 - func.coalesce(SalesInvoice.combined_pct, 0) / 100
    inv_date = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    inv = (
        select(SalesInvoice.customer_id, Customer.name, Customer.customer_type, Item.category,
               SalesInvoice.family, SalesInvoiceLine.location_id,
               func.sum(SalesInvoiceLine.line_total * after))
        .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
        .join(Item, Item.id == SalesInvoiceLine.item_id)
        .outerjoin(Customer, Customer.id == SalesInvoice.customer_id)
        .where(inv_date >= date_from, inv_date <= date_to)
        .group_by(SalesInvoice.customer_id, Customer.name, Customer.customer_type, Item.category,
                  SalesInvoice.family, SalesInvoiceLine.location_id)
    )
    if not include_bonus:
        inv = inv.where(func.coalesce(SalesInvoice.is_bonus, False).is_(False))
    if branch_id is not None:
        inv = inv.where(SalesInvoice.branch_id == branch_id)
    run(inv, 1)

    r_after = 1 - func.coalesce(SalesReturn.combined_pct, 0) / 100
    ret_date = func.coalesce(SalesReturn.return_date, cast(SalesReturn.created_at, Date))
    ret = (
        select(SalesReturn.customer_id, Customer.name, Customer.customer_type, Item.category,
               SalesReturn.family, SalesReturnLine.location_id,
               func.sum(SalesReturnLine.line_total * r_after))
        .join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id)
        .join(Item, Item.id == SalesReturnLine.item_id)
        .outerjoin(Customer, Customer.id == SalesReturn.customer_id)
        .where(ret_date >= date_from, ret_date <= date_to, SalesReturn.reversed_at.is_(None))
        .group_by(SalesReturn.customer_id, Customer.name, Customer.customer_type, Item.category,
                  SalesReturn.family, SalesReturnLine.location_id)
    )
    if branch_id is not None:
        ret = ret.where(SalesReturn.branch_id == branch_id)
    run(ret, -1)
    return out


def _matches(rule: dict, row: dict) -> bool:
    ids = {int(x) for x in rule.get("customer_ids") or [] if str(x).strip().lstrip("-").isdigit()}
    words = [w for w in rule.get("customer_name_words") or [] if str(w).strip()]
    if ids or words:
        hit = (row["customer_id"] in ids) or any(_has_word(row["customer_name"], w) for w in words)
        if not hit:
            return False
    types = set(rule.get("customer_types") or [])
    if types and row["customer_type"] not in types:
        return False
    cats = {norm(c) for c in rule.get("item_categories") or []}
    if cats and norm(row["category"]) not in cats:
        return False
    fams = {norm(f) for f in rule.get("families") or []}
    if fams and norm(row["family"]) not in fams:
        return False
    whs = {int(x) for x in rule.get("warehouse_ids") or []}
    if whs and row["warehouse_id"] not in whs:
        return False
    return True


def classify_sales(rows: list[dict],
                   categories: list[dict]) -> tuple[dict[str, list[dict]], list[dict]]:
    buckets: dict[str, list[dict]] = {c["key"]: [] for c in categories}
    unmatched: list[dict] = []
    for row in rows:
        for cat in categories:
            if _matches(cat, row):
                buckets[cat["key"]].append(row)
                break
        else:
            unmatched.append(row)
    return buckets, unmatched


def sales_breakdown(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
                    category_key: str, config: dict | None = None) -> dict:
    cfg = config or get_config(db, branch_id)
    rows = _sales_rows(db, branch_id=branch_id, date_from=date_from, date_to=date_to,
                       include_bonus=bool(cfg["sales"].get("include_bonus")))
    buckets, unmatched = classify_sales(rows, cfg["sales"]["categories"])
    picked = unmatched if category_key == "_unmatched" else buckets.get(category_key, [])
    by_customer: dict = {}
    by_category: dict = {}
    for r in picked:
        k = (r["customer_id"], r["customer_name"], r["customer_type"])
        by_customer[k] = by_customer.get(k, ZERO) + r["value"]
        by_category[r["category"]] = by_category.get(r["category"], ZERO) + r["value"]
    return {
        "total": str(to_money(sum((r["value"] for r in picked), ZERO))),
        "by_customer": [{"customer_id": k[0], "customer_name": k[1], "customer_type": k[2],
                         "amount": str(to_money(v))}
                        for k, v in sorted(by_customer.items(), key=lambda kv: -kv[1])],
        "by_item_category": [{"category": k, "amount": str(to_money(v))}
                             for k, v in sorted(by_category.items(), key=lambda kv: -kv[1])],
    }


def inventory_at(db: Session, *, branch_id: int | None, as_of: date, with_rows: bool = True):
    inv = get_config(db, branch_id)["inventory"]
    return inventory_valuation_service.value_at(
        db, branch_id=branch_id, as_of=as_of, cost_basis=inv.get("cost_basis", "average"),
        exclude_categories=inv.get("exclude_categories") or [],
        list_factors=inv.get("list_factors"), with_rows=with_rows)


def net_purchases(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
                  exclude_categories) -> dict:
    excluded = list(exclude_categories or [])
    after = 1 - func.coalesce(PurchaseInvoice.combined_pct, 0) / 100
    p_date = func.coalesce(PurchaseInvoice.purchase_date, cast(PurchaseInvoice.created_at, Date))
    stmt = (select(Item.category, func.sum(PurchaseInvoiceLine.line_total * after))
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
            .join(Item, Item.id == PurchaseInvoiceLine.item_id)
            .where(p_date >= date_from, p_date <= date_to)
            .group_by(Item.category))
    if branch_id is not None:
        stmt = stmt.where(PurchaseInvoice.branch_id == branch_id)
    gross_by_cat = {c or "بدون فئة": D(v) for c, v in db.execute(stmt).all()}

    r_date = func.coalesce(PurchaseReturn.return_date, cast(PurchaseReturn.created_at, Date))
    rstmt = (select(PurchaseReturn.id, PurchaseReturn.value, PurchaseReturn.gross,
                    Item.category, func.sum(PurchaseReturnLine.line_total))
             .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
             .join(Item, Item.id == PurchaseReturnLine.item_id)
             .where(r_date >= date_from, r_date <= date_to, PurchaseReturn.reversed_at.is_(None))
             .group_by(PurchaseReturn.id, PurchaseReturn.value, PurchaseReturn.gross,
                       Item.category))
    if branch_id is not None:
        rstmt = rstmt.where(PurchaseReturn.branch_id == branch_id)
    ret_by_cat: dict[str, Decimal] = {}
    for _rid, value, gross, cat, line_sum in db.execute(rstmt).all():
        ratio = (D(value) / D(gross)) if D(gross) else Decimal(1)
        key = cat or "بدون فئة"
        ret_by_cat[key] = ret_by_cat.get(key, ZERO) + D(line_sum) * ratio

    gross = sum((v for c, v in gross_by_cat.items() if c not in excluded), ZERO)
    returns = sum((v for c, v in ret_by_cat.items() if c not in excluded), ZERO)
    excl = sum((v for c, v in gross_by_cat.items() if c in excluded), ZERO) \
        - sum((v for c, v in ret_by_cat.items() if c in excluded), ZERO)
    return {
        "gross": to_money(gross), "returns": to_money(returns),
        "net": to_money(gross - returns), "excluded": to_money(excl),
        "by_category": {c: str(to_money(v - ret_by_cat.get(c, ZERO)))
                        for c, v in sorted(gross_by_cat.items(), key=lambda kv: -kv[1])},
    }


def _account_movements(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
                       posted_only: bool) -> dict[int, Decimal]:
    when = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    stmt = (
        select(LedgerLine.account_id, LedgerLine.direction, Account.normal_side,
               func.sum(LedgerLine.amount))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .join(Account, Account.id == LedgerLine.account_id)
        .where(ledger_service.in_books_sql(posted_only), when >= date_from, when <= date_to)
        .group_by(LedgerLine.account_id, LedgerLine.direction, Account.normal_side)
    )
    if branch_id is not None:
        stmt = stmt.where((LedgerEntry.branch_id == branch_id) | LedgerEntry.branch_id.is_(None))
    out: dict[int, Decimal] = {}
    for acc_id, direction, normal, amount in db.execute(stmt).all():
        v = D(amount) if direction == normal else -D(amount)
        out[acc_id] = out.get(acc_id, ZERO) + v
    return out


def default_role(acc: Account, chain_names: list[str]) -> str:
    if acc.account_type in _ROLE_BY_TYPE:
        return _ROLE_BY_TYPE[acc.account_type]
    own = norm(acc.name)
    for words, role in _OWN_ROLE_RULES:
        if any(norm(w) in own for w in words):
            return role
    nature = effective_nature(acc)
    is_income = nature is not None and nature.value == "income"
    for name in [acc.name, *chain_names]:
        n = norm(name)
        for words, role in _TREE_ROLE_RULES:
            if role in _INCOME_ROLES and not is_income or role in _EXPENSE_ROLES and is_income:
                continue
            if any(norm(w) in n for w in words):
                return role
    return "other_income" if is_income else "ga"


def _accounts_index(db: Session, branch_id: int | None) -> dict[int, Account]:
    stmt = select(Account)
    if branch_id is not None:
        stmt = stmt.where((Account.branch_id == branch_id) | Account.branch_id.is_(None))
    return {a.id: a for a in db.scalars(stmt).all()}


def _chain(acc: Account, index: dict[int, Account]) -> list[str]:
    names, seen, cur = [], set(), acc
    while cur.parent_id and cur.parent_id not in seen:
        seen.add(cur.parent_id)
        cur = index.get(cur.parent_id)
        if cur is None:
            break
        names.append(cur.name or "")
    return names


def account_roles(db: Session, *, branch_id: int | None, config: dict) -> list[dict]:
    index = _accounts_index(db, branch_id)
    saved = {str(k): v for k, v in (config["accounts"].get("roles") or {}).items()}
    out = []
    for acc in index.values():
        nature = effective_nature(acc)
        if nature is None or nature.value not in ("income", "expense"):
            continue
        chain = _chain(acc, index)
        dflt = default_role(acc, chain)
        out.append({
            "account_id": acc.id, "code": acc.code, "name": acc.name or acc.account_type.value,
            "parent_name": chain[0] if chain else None, "nature": nature.value,
            "postable": bool(acc.is_postable), "default_role": dflt,
            "role": saved.get(str(acc.id), dflt), "overridden": str(acc.id) in saved,
            "group": _group_of(acc, config["accounts"].get("groups") or [], chain),
        })
    out.sort(key=lambda r: (r["nature"], r["parent_name"] or "", r["code"] or "", r["name"]))
    return out


def _group_of(acc: Account, groups: list[dict], chain: list[str] = ()) -> str | None:
    for g in groups:
        if acc.id in {int(x) for x in g.get("account_ids") or []}:
            return g.get("name")
    for name in [acc.name, *chain]:
        n = norm(name)
        for g in groups:
            if any(norm(k) and norm(k) in n for k in g.get("keywords") or []):
                return g.get("name")
    return None


def _section_lines(items: list[tuple[Account, Decimal]], groups: list[dict],
                   index: dict[int, Account] | None = None) -> list[dict]:
    by_group: dict[str, dict] = {}
    singles: list[dict] = []
    order = {g.get("name"): i for i, g in enumerate(groups)}
    for acc, amount in items:
        label = acc.name or acc.account_type.value
        entry = {"account_id": acc.id, "code": acc.code, "name": label,
                 "amount": str(to_money(amount))}
        g = _group_of(acc, groups, _chain(acc, index) if index else [])
        if g is None:
            singles.append({"name": label, "amount": amount, "accounts": [entry],
                            "manual": False})
            continue
        line = by_group.setdefault(g, {"name": g, "amount": ZERO, "accounts": [], "manual": False})
        line["amount"] += amount
        line["accounts"].append(entry)
    lines = sorted(by_group.values(), key=lambda line: order.get(line["name"], 999)) + \
        sorted(singles, key=lambda line: -line["amount"])
    return lines


def coupons_in_period(db: Session, *, branch_id: int | None, date_from: date,
                      date_to: date) -> dict:
    issued_stmt = (select(CouponIssue.coupon_kind, func.coalesce(func.sum(CouponIssue.count), 0))
                   .where(CouponIssue.active.is_(True), CouponIssue.issue_date >= date_from,
                          CouponIssue.issue_date <= date_to)
                   .group_by(CouponIssue.coupon_kind))
    rec_stmt = (select(CouponReceipt.declared_kind,
                       func.coalesce(func.sum(CouponReceipt.coupon_count), 0))
                .where(receipt_counted(), CouponReceipt.received_date >= date_from,
                       CouponReceipt.received_date <= date_to)
                .group_by(CouponReceipt.declared_kind))
    if branch_id is not None:
        issued_stmt = issued_stmt.where(CouponIssue.branch_id == branch_id)
        rec_stmt = rec_stmt.where(CouponReceipt.branch_id == branch_id)
    issued = {k or "غير محدد": int(v or 0) for k, v in db.execute(issued_stmt).all()}
    received = {k or "غير محدد": int(v or 0) for k, v in db.execute(rec_stmt).all()}
    return {"issued": issued, "received": received,
            "issued_total": sum(issued.values()), "received_total": sum(received.values())}


def _pct(part: Decimal, whole: Decimal) -> str | None:
    return str((part / whole * 100).quantize(Decimal("0.01"))) if whole else None


def build(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
          posted_only: bool = True) -> dict:
    cfg = get_config(db, branch_id)
    period = cfg.get("periods", {}).get(period_key(date_from, date_to)) or {}
    excluded_cats = cfg["inventory"].get("exclude_categories") or []

    rows = _sales_rows(db, branch_id=branch_id, date_from=date_from, date_to=date_to,
                       include_bonus=bool(cfg["sales"].get("include_bonus")))
    cats = cfg["sales"]["categories"]
    buckets, unmatched = classify_sales(rows, cats)
    sales_total = sum((r["value"] for r in rows), ZERO)
    sales_lines = []
    bonus_value = ZERO
    for c in cats:
        amount = sum((r["value"] for r in buckets[c["key"]]), ZERO)
        b_pct = D(c.get("bonus_pct"))
        b_val = amount * b_pct / 100
        bonus_value += b_val
        sales_lines.append({"key": c["key"], "name": c["name"], "amount": str(to_money(amount)),
                            "pct": _pct(amount, sales_total), "bonus_pct": str(b_pct),
                            "bonus_value": str(to_money(b_val))})
    unmatched_total = sum((r["value"] for r in unmatched), ZERO)
    if unmatched:
        sales_lines.append({"key": "_unmatched", "name": "غير مصنّف",
                            "amount": str(to_money(unmatched_total)),
                            "pct": _pct(unmatched_total, sales_total),
                            "bonus_pct": "0", "bonus_value": "0.00"})

    moves = _account_movements(db, branch_id=branch_id, date_from=date_from, date_to=date_to,
                               posted_only=posted_only)
    index = _accounts_index(db, branch_id)
    for acc_id in moves:
        if acc_id not in index:
            acc = db.get(Account, acc_id)
            if acc is not None:
                index[acc_id] = acc
    saved_roles = {str(k): v for k, v in (cfg["accounts"].get("roles") or {}).items()}
    by_role: dict[str, list[tuple[Account, Decimal]]] = {}
    for acc_id, amount in moves.items():
        acc = index.get(acc_id)
        if acc is None or amount == ZERO:
            continue
        nature = effective_nature(acc)
        if nature is None or nature.value not in ("income", "expense"):
            continue
        role = saved_roles.get(str(acc_id)) or default_role(acc, _chain(acc, index))
        by_role.setdefault(role, []).append((acc, amount))
    groups = cfg["accounts"].get("groups") or []

    def role_total(role: str) -> Decimal:
        return sum((a for _, a in by_role.get(role, [])), ZERO)

    adjustments = [a for a in period.get("adjustments") or [] if a.get("section") in ADJ_SECTIONS]

    def adj_lines(section: str) -> list[dict]:
        return [{"name": a.get("label") or "بند يدوي", "amount": D(a.get("amount")),
                 "accounts": [], "manual": True, "note": a.get("note") or "زيادة"}
                for a in adjustments if a.get("section") == section]

    def section(role: str, manual_section: str | None = None, grouped: bool = True) -> dict:
        lines = _section_lines(by_role.get(role, []), groups if grouped else [], index)
        if manual_section:
            lines += adj_lines(manual_section)
        total = sum((ln["amount"] for ln in lines), ZERO)
        for ln in lines:
            ln["amount"] = str(to_money(ln["amount"]))
        return {"lines": lines, "total": str(to_money(total)), "_total": total}

    inv_cfg = cfg["inventory"]
    opening_day = date_from - timedelta(days=1)
    opening_val = inventory_valuation_service.value_at(
        db, branch_id=branch_id, as_of=opening_day, cost_basis=inv_cfg.get("cost_basis", "average"),
        exclude_categories=excluded_cats, list_factors=inv_cfg.get("list_factors"),
        with_rows=False)
    closing_val = inventory_valuation_service.value_at(
        db, branch_id=branch_id, as_of=date_to, cost_basis=inv_cfg.get("cost_basis", "average"),
        exclude_categories=excluded_cats, list_factors=inv_cfg.get("list_factors"),
        with_rows=False)

    def inv_block(val, override_key: str) -> dict:
        override = period.get(override_key)
        used = D(override) if override not in (None, "") else val.total
        return {"amount": str(to_money(used)), "_amount": used,
                "source": "override" if override not in (None, "") else "computed",
                "computed": str(val.total), "as_of": val.as_of.isoformat(),
                "by_category": {k: str(v) for k, v in val.by_category.items()},
                "missing_cost": val.missing_cost, "negative_rows": val.negative_rows}

    opening = inv_block(opening_val, "opening_inventory")
    closing = inv_block(closing_val, "closing_inventory")
    purchases = net_purchases(db, branch_id=branch_id, date_from=date_from, date_to=date_to,
                              exclude_categories=excluded_cats)
    direct_materials = opening["_amount"] + purchases["net"] - closing["_amount"]
    mfg = {r: role_total(r) for r in MFG_ROLES}
    cost_manual = adj_lines("cost")
    cost_manual_total = sum((ln["amount"] for ln in cost_manual), ZERO)
    for ln in cost_manual:
        ln["amount"] = str(to_money(ln["amount"]))
    cost_of_sales = direct_materials + sum(mfg.values(), ZERO) + cost_manual_total
    gross_profit = sales_total - cost_of_sales

    ga = section("ga", "ga")
    other_income = section("other_income", "other_income")
    other_loss = section("other_loss", "other_loss")
    marketing_ledger = section("marketing", grouped=False)

    m = cfg["marketing"]
    coupons = coupons_in_period(db, branch_id=branch_id, date_from=date_from, date_to=date_to)
    coupon_unit = D(m.get("coupon_base")) * D(m.get("coupon_base_pct")) / 100
    bonus_coupons = bonus_value / coupon_unit if coupon_unit else ZERO
    ratio_den = D(m.get("ratio_den"))
    ratio_coupons = bonus_coupons * D(m.get("ratio_num")) / ratio_den if ratio_den else ZERO
    src_sc = m.get("sales_coupons_source") or "issued"
    if period.get("sales_coupons") not in (None, ""):
        sales_coupons, sc_source = D(period.get("sales_coupons")), "period"
    elif src_sc == "manual":
        sales_coupons, sc_source = D(m.get("sales_coupons_manual")), "manual"
    elif src_sc == "received":
        sales_coupons, sc_source = Decimal(coupons["received_total"]), "received"
    else:
        sales_coupons, sc_source = Decimal(coupons["issued_total"]), "issued"
    total_coupons = ratio_coupons + sales_coupons
    model_amount = total_coupons * D(m.get("coupon_cost"))
    kind_values = m.get("kind_values") or {}
    actual_coupons_value = sum(
        (Decimal(n) * (D(kind_values.get(k)) if kind_values.get(k) not in (None, "")
                       else D(m.get("coupon_cost"))) for k, n in coupons["issued"].items()), ZERO)
    marketing_manual = adj_lines("marketing")
    marketing_manual_total = sum((ln["amount"] for ln in marketing_manual), ZERO)
    for ln in marketing_manual:
        ln["amount"] = str(to_money(ln["amount"]))
    source = m.get("source") or "model"
    base = {"model": model_amount, "ledger": marketing_ledger["_total"],
            "coupons": actual_coupons_value}.get(source, model_amount)
    marketing_total = base + marketing_manual_total

    operating_profit = gross_profit - ga["_total"] - marketing_total
    net_profit = operating_profit + other_income["_total"] - other_loss["_total"]

    recon = {
        "ledger_sales": str(to_money(role_total("sales"))),
        "ledger_sales_returns": str(to_money(role_total("sales_returns"))),
        "ledger_sales_discount": str(to_money(role_total("sales_discount"))),
        "ledger_net_sales": str(to_money(role_total("sales") - role_total("sales_returns")
                                         - role_total("sales_discount"))),
        "documents_net_sales": str(to_money(sales_total)),
        "ledger_purchases": str(to_money(role_total("purchases"))),
        "ledger_purchase_returns": str(to_money(role_total("purchase_returns"))),
        "ledger_net_purchases": str(to_money(role_total("purchases")
                                             - role_total("purchase_returns"))),
        "documents_net_purchases": str(purchases["net"]),
        "documents_excluded_purchases": str(purchases["excluded"]),
        "excluded_accounts": [{"account_id": a.id, "code": a.code, "name": a.name,
                               "amount": str(to_money(v))}
                              for a, v in sorted(by_role.get("excluded", []),
                                                 key=lambda t: -t[1])],
        "doc_role_accounts": [{"account_id": a.id, "code": a.code, "name": a.name,
                               "role": r, "amount": str(to_money(v))}
                              for r in DOC_ROLES for a, v in by_role.get(r, [])],
    }

    for blk in (opening, closing):
        blk.pop("_amount", None)
    for s in (ga, other_income, other_loss, marketing_ledger):
        s.pop("_total", None)
    branch = db.get(Branch, branch_id) if branch_id else None
    return {
        "branch_id": branch_id, "branch_name": branch.name if branch else "كل الفروع",
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "posted_only": posted_only, "period_key": period_key(date_from, date_to),
        "sales": {"lines": sales_lines, "total": str(to_money(sales_total)),
                  "bonus_value": str(to_money(bonus_value)),
                  "unmatched": str(to_money(unmatched_total)),
                  "include_bonus": bool(cfg["sales"].get("include_bonus"))},
        "cost": {
            "opening_inventory": opening, "closing_inventory": closing,
            "purchases": {k: (str(v) if isinstance(v, Decimal) else v)
                          for k, v in purchases.items()},
            "direct_materials": str(to_money(direct_materials)),
            "direct_labor": str(to_money(mfg["direct_labor"])),
            "indirect_materials": str(to_money(mfg["indirect_materials"])),
            "indirect_labor": str(to_money(mfg["indirect_labor"])),
            "other_mfg": str(to_money(mfg["other_mfg"])),
            "manual": cost_manual,
            "total": str(to_money(cost_of_sales)),
            "cost_basis": inv_cfg.get("cost_basis", "average"),
            "excluded_categories": excluded_cats,
        },
        "gross_profit": str(to_money(gross_profit)),
        "gross_margin_pct": _pct(gross_profit, sales_total),
        "ga": ga,
        "marketing": {
            "source": source, "amount": str(to_money(marketing_total)),
            "manual": marketing_manual,
            "model": {
                "bonus_value": str(to_money(bonus_value)),
                "coupon_base": str(D(m.get("coupon_base"))),
                "coupon_base_pct": str(D(m.get("coupon_base_pct"))),
                "coupon_unit": str(coupon_unit),
                "bonus_coupons": str(bonus_coupons.quantize(Decimal("0.01"))),
                "ratio_num": str(D(m.get("ratio_num"))), "ratio_den": str(ratio_den),
                "ratio_coupons": str(ratio_coupons.quantize(Decimal("0.01"))),
                "sales_coupons": str(sales_coupons), "sales_coupons_source": sc_source,
                "total_coupons": str(total_coupons.quantize(Decimal("0.01"))),
                "coupon_cost": str(D(m.get("coupon_cost"))),
                "amount": str(to_money(model_amount)),
            },
            "actual": {
                "coupons_issued": coupons["issued"], "coupons_received": coupons["received"],
                "issued_total": coupons["issued_total"],
                "received_total": coupons["received_total"],
                "coupons_value": str(to_money(actual_coupons_value)),
                "ledger": marketing_ledger,
            },
        },
        "operating_profit": str(to_money(operating_profit)),
        "other_income": other_income,
        "other_losses": other_loss,
        "net_profit": str(to_money(net_profit)),
        "net_margin_pct": _pct(net_profit, sales_total),
        "expenses_to_sales_pct": _pct(D(ga["total"]), sales_total),
        "reconciliation": recon,
        "period_inputs": period,
    }
