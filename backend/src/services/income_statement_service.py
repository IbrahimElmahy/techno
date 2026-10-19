from __future__ import annotations

import copy
import re
from datetime import date, timedelta
from decimal import Decimal
from functools import lru_cache

from sqlalchemy import Date, and_, case, cast, func, literal, or_, select, true
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.catalog import Item
from src.models.coupon_issue import CouponIssue
from src.models.coupon_receipt import CouponReceipt, receipt_counted
from src.models.customer import Customer
from src.models.income_statement_setting import IncomeStatementSetting
from src.models.ledger import Account, AccountType, Direction, LedgerEntry, LedgerLine
from src.models.manufacturing import ManufacturingOrder, ProductionOrderProduct
from src.models.org import Branch
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.models.stock import LocationKind, StockMovement
from src.models.supplier import Supplier
from src.services import costing_service, inventory_valuation_service, ledger_service
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
    "unclassified": "غير مصنف",
}
DOC_ROLES = ("sales", "sales_returns", "sales_discount", "purchases", "purchase_returns")
MFG_ROLES = ("direct_labor", "indirect_materials", "indirect_labor", "other_mfg")
COGS_METHODS = ("periodic", "perpetual")
PROFIT_SIDE = {"sales", "purchase_returns", "other_income", "unclassified"}
PRODUCTION_DOCS = ("production_order", "manufacturing_order")
PRODUCT_MOVES = ("production_in", "reverse_production_in")
NOT_DIFFERENCES = ("sales_invoice", "sales_return", "purchase_invoice", "purchase_return",
                   "stock_transfer", "a5_opening", *PRODUCTION_DOCS)

ADJ_SECTIONS = ("ga", "marketing", "other_income", "other_loss", "cost")


DEFAULT_EXCLUDED_CATEGORIES = ["خدمة العملاء", "ادوات مكتبية", "كوبونات", "سياره جديده"]

DEFAULT_CONFIG: dict = {
    "sales": {
        "include_bonus": False,
        "categories": [
            {"key": "branches", "name": "الفروع", "customer_ids": [],
             "customer_types": ["internal"], "bonus_pct": 0},
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
        "cogs_method": "periodic",
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
        "coupon_item_id": None, "coupon_item_name": "كوع بسن داخلى 25×20",
        "coupon_item_tier": "sale_price", "coupon_discount_pct": 10,
        "gold_coupon_points": 30,
        "ratio_num": 2, "ratio_den": 30,
        "coupon_cost": 180,
        "sales_coupons_source": "received", "sales_coupons_manual": 0,
        "kind_values": {},
    },
    "consolidation": {"eliminate_internal": False},
    "periods": {},
}

_OWN_ROLE_RULES: list[tuple[tuple[str, ...], str]] = [
    (("تحت راتب", "تحت ح راتب"), "excluded"),
    (("المهمات",), "excluded"),
    (("نقاط", "كوبون", "عهده خدمه العملاء"), "marketing"),
]
_TREE_ROLE_RULES: list[tuple[tuple[str, ...], str]] = [
    (("تكلفة المبيعات", "تقدير تكلفة انتاج", "تكاليف صناعية خامات", "فروق مخزون",
      "بضاعة اول المدة", "بضاعة اخر المدة"), "excluded"),
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


@lru_cache(maxsize=8192)
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
    plain = {"periods", "list_factors", "kind_values"}
    for key, value in (saved or {}).items():
        if key == "roles" and isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **copy.deepcopy(value)}
        elif isinstance(value, dict) and isinstance(out.get(key), dict) and key not in plain:
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


Period = tuple[date, date]


def _bucket(when, periods: list[Period]):
    if len(periods) == 1:
        return literal(0)
    return case(*[(and_(when >= f, when <= t), i) for i, (f, t) in enumerate(periods)],
                else_=-1)


def _by(bucket, periods: list[Period]) -> list:
    return [bucket] if len(periods) > 1 else []


def _span(when, periods: list[Period]):
    return and_(when >= min(f for f, _ in periods), when <= max(t for _, t in periods))


def _sales_rows(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
                include_bonus: bool, internal: bool = False) -> list[dict]:
    return _sales_rows_many(db, branch_id=branch_id, periods=[(date_from, date_to)],
                            include_bonus=include_bonus, internal=internal)[0]


def _internal_customers():
    return select(Customer.id).where(Customer.customer_type == "internal")


def _internal_suppliers():
    return select(Supplier.id).where(Supplier.supplier_type == "internal")


def _not_internal(column, ids_select):
    return or_(column.is_(None), column.not_in(ids_select))


def _eliminate_internal(cfg: dict, branch_id: int | None) -> bool:
    return branch_id is None and bool((cfg.get("consolidation") or {}).get("eliminate_internal"))


def _sales_rows_many(db: Session, *, branch_id: int | None, periods: list[Period],
                     include_bonus: bool, internal: bool = False) -> list[list[dict]]:
    out: list[list[dict]] = [[] for _ in periods]

    def run(stmt, sign: int):
        for b, cid, cname, ctype, cat, fam, wh, value in db.execute(stmt).all():
            if 0 <= b < len(periods):
                out[b].append({"customer_id": cid, "customer_name": cname or "",
                               "customer_type": ctype or "", "category": cat or "بدون فئة",
                               "family": fam or "", "warehouse_id": wh,
                               "value": D(value) * sign})

    after = 1 - func.coalesce(SalesInvoice.combined_pct, 0) / 100
    inv_date = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    inv_b = _bucket(inv_date, periods)
    inv = (
        select(inv_b, SalesInvoice.customer_id, Customer.name, Customer.customer_type,
               Item.category, SalesInvoice.family, SalesInvoiceLine.location_id,
               func.sum(SalesInvoiceLine.line_total * after))
        .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
        .join(Item, Item.id == SalesInvoiceLine.item_id)
        .outerjoin(Customer, Customer.id == SalesInvoice.customer_id)
        .where(_span(inv_date, periods))
        .group_by(*_by(inv_b, periods), SalesInvoice.customer_id, Customer.name,
                  Customer.customer_type, Item.category, SalesInvoice.family,
                  SalesInvoiceLine.location_id)
    )
    if not include_bonus:
        inv = inv.where(func.coalesce(SalesInvoice.is_bonus, False).is_(False))
    if branch_id is not None:
        inv = inv.where(SalesInvoice.branch_id == branch_id)
    if internal:
        inv = inv.where(_not_internal(SalesInvoice.customer_id, _internal_customers()))
    run(inv, 1)

    r_after = 1 - func.coalesce(SalesReturn.combined_pct, 0) / 100
    ret_date = func.coalesce(SalesReturn.return_date, cast(SalesReturn.created_at, Date))
    ret_b = _bucket(ret_date, periods)
    ret = (
        select(ret_b, SalesReturn.customer_id, Customer.name, Customer.customer_type,
               Item.category, SalesReturn.family, SalesReturnLine.location_id,
               func.sum(SalesReturnLine.line_total * r_after))
        .join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id)
        .join(Item, Item.id == SalesReturnLine.item_id)
        .outerjoin(Customer, Customer.id == SalesReturn.customer_id)
        .where(_span(ret_date, periods), SalesReturn.reversed_at.is_(None))
        .group_by(*_by(ret_b, periods), SalesReturn.customer_id, Customer.name,
                  Customer.customer_type, Item.category, SalesReturn.family,
                  SalesReturnLine.location_id)
    )
    if branch_id is not None:
        ret = ret.where(SalesReturn.branch_id == branch_id)
    if internal:
        ret = ret.where(_not_internal(SalesReturn.customer_id, _internal_customers()))
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


def classify_sales(rows: list[dict], categories: list[dict],
                   memo: dict | None = None) -> tuple[dict[str, list[dict]], list[dict]]:
    buckets: dict[str, list[dict]] = {c["key"]: [] for c in categories}
    unmatched: list[dict] = []
    memo = {} if memo is None else memo
    for row in rows:
        k = (row["customer_id"], row["customer_name"], row["customer_type"], row["category"],
             row["family"], row["warehouse_id"])
        if k not in memo:
            memo[k] = next((c["key"] for c in categories if _matches(c, row)), None)
        if memo[k] is None:
            unmatched.append(row)
        else:
            buckets[memo[k]].append(row)
    return buckets, unmatched


def sales_breakdown(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
                    category_key: str, config: dict | None = None) -> dict:
    cfg = config or get_config(db, branch_id)
    rows = _sales_rows(db, branch_id=branch_id, date_from=date_from, date_to=date_to,
                       include_bonus=bool(cfg["sales"].get("include_bonus")),
                       internal=_eliminate_internal(cfg, branch_id))
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
    return net_purchases_many(db, branch_id=branch_id, periods=[(date_from, date_to)],
                              exclude_categories=exclude_categories)[0]


def net_purchases_many(db: Session, *, branch_id: int | None, periods: list[Period],
                       exclude_categories, internal: bool = False) -> list[dict]:
    after = 1 - func.coalesce(PurchaseInvoice.combined_pct, 0) / 100
    p_date = func.coalesce(PurchaseInvoice.purchase_date, cast(PurchaseInvoice.created_at, Date))
    p_b = _bucket(p_date, periods)
    stmt = (select(p_b, Item.category, func.sum(PurchaseInvoiceLine.line_total * after))
            .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
            .join(Item, Item.id == PurchaseInvoiceLine.item_id)
            .where(_span(p_date, periods))
            .group_by(*_by(p_b, periods), Item.category))
    if branch_id is not None:
        stmt = stmt.where(PurchaseInvoice.branch_id == branch_id)
    if internal:
        stmt = stmt.where(_not_internal(PurchaseInvoice.supplier_id, _internal_suppliers()))
    gross_by: list[dict[str, Decimal]] = [{} for _ in periods]
    for b, c, v in db.execute(stmt).all():
        if 0 <= b < len(periods):
            gross_by[b][c or "بدون فئة"] = D(v)

    r_date = func.coalesce(PurchaseReturn.return_date, cast(PurchaseReturn.created_at, Date))
    r_b = _bucket(r_date, periods)
    rstmt = (select(r_b, PurchaseReturn.id, PurchaseReturn.value, PurchaseReturn.gross,
                    Item.category, func.sum(PurchaseReturnLine.line_total))
             .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
             .join(Item, Item.id == PurchaseReturnLine.item_id)
             .where(_span(r_date, periods), PurchaseReturn.reversed_at.is_(None))
             .group_by(*_by(r_b, periods), PurchaseReturn.id, PurchaseReturn.value,
                       PurchaseReturn.gross, Item.category))
    if branch_id is not None:
        rstmt = rstmt.where(PurchaseReturn.branch_id == branch_id)
    if internal:
        rstmt = rstmt.where(_not_internal(PurchaseReturn.supplier_id, _internal_suppliers()))
    ret_by: list[dict[str, Decimal]] = [{} for _ in periods]
    for b, _rid, value, gross, cat, line_sum in db.execute(rstmt).all():
        if not 0 <= b < len(periods):
            continue
        ratio = (D(value) / D(gross)) if D(gross) else Decimal(1)
        key = cat or "بدون فئة"
        ret_by[b][key] = ret_by[b].get(key, ZERO) + D(line_sum) * ratio
    return [_purchases_summary(g, r, exclude_categories)
            for g, r in zip(gross_by, ret_by, strict=True)]


def _purchases_summary(gross_by_cat: dict[str, Decimal], ret_by_cat: dict[str, Decimal],
                       exclude_categories) -> dict:
    excluded = list(exclude_categories or [])
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


def _account_movements(db: Session, *, branch_id: int | None, periods: list[Period],
                       posted_only: bool) -> list[dict[int, Decimal]]:
    when = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    bucket = _bucket(when, periods)
    dc = case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
              else_=-LedgerLine.amount)
    stmt = (
        select(bucket, LedgerLine.account_id, func.sum(dc))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(ledger_service.in_books_sql(posted_only), _span(when, periods),
               ledger_service.branch_sql(branch_id))
        .group_by(*_by(bucket, periods), LedgerLine.account_id)
    )
    out: list[dict[int, Decimal]] = [{} for _ in periods]
    for b, acc_id, amount in db.execute(stmt).all():
        if 0 <= b < len(periods):
            out[b][acc_id] = out[b].get(acc_id, ZERO) + D(amount)
    return out


def fallback_role(acc: Account, appears_in: str | None) -> tuple[str, str]:
    if acc.account_type in _ROLE_BY_TYPE:
        return _ROLE_BY_TYPE[acc.account_type], "type"
    nature = effective_nature(acc)
    income = nature is not None and nature.value == "income"
    if appears_in == "none":
        return "excluded", "appears_in"
    if appears_in == "trading":
        return ("other_income" if income else "other_mfg"), "appears_in"
    if appears_in == "profit_loss":
        return ("other_income" if income else "ga"), "appears_in"
    return "unclassified", "none"


def resolve_role(acc: Account, saved: dict) -> tuple[str, str]:
    role = saved.get(str(acc.id))
    if role in ROLES:
        return role, "config"
    return fallback_role(acc, acc.appears_in)


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
        role, source = resolve_role(acc, saved)
        dflt, _ = resolve_role(acc, {})
        out.append({
            "account_id": acc.id, "code": acc.code, "name": acc.name or acc.account_type.value,
            "parent_name": chain[0] if chain else None, "nature": nature.value,
            "postable": bool(acc.is_postable), "default_role": dflt,
            "suggested_role": default_role(acc, chain), "appears_in": acc.appears_in,
            "role": role, "role_source": source, "overridden": str(acc.id) in saved,
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
                   index: dict[int, Account] | None = None,
                   by_parent: bool = False) -> list[dict]:
    by_group: dict[str, dict] = {}
    singles: list[dict] = []
    order = {g.get("name"): i for i, g in enumerate(groups)}
    for acc, amount in items:
        label = acc.name or acc.account_type.value
        entry = {"account_id": acc.id, "code": acc.code, "name": label,
                 "amount": str(to_money(amount))}
        chain = _chain(acc, index) if index else []
        g = _group_of(acc, groups, chain)
        if g is None and by_parent and chain and chain[0]:
            g = chain[0]
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
    return coupons_many(db, branch_id=branch_id, periods=[(date_from, date_to)])[0]


def coupons_many(db: Session, *, branch_id: int | None, periods: list[Period]) -> list[dict]:
    i_b = _bucket(CouponIssue.issue_date, periods)
    issued_stmt = (select(i_b, CouponIssue.coupon_kind,
                          func.coalesce(func.sum(CouponIssue.count), 0))
                   .where(CouponIssue.active.is_(True), _span(CouponIssue.issue_date, periods))
                   .group_by(*_by(i_b, periods), CouponIssue.coupon_kind))
    r_b = _bucket(CouponReceipt.received_date, periods)
    rec_stmt = (select(r_b, CouponReceipt.declared_kind,
                       func.coalesce(func.sum(CouponReceipt.coupon_count), 0))
                .where(receipt_counted(), _span(CouponReceipt.received_date, periods))
                .group_by(*_by(r_b, periods), CouponReceipt.declared_kind))
    if branch_id is not None:
        issued_stmt = issued_stmt.where(CouponIssue.branch_id == branch_id)
        rec_stmt = rec_stmt.where(CouponReceipt.branch_id == branch_id)
    issued: list[dict[str, int]] = [{} for _ in periods]
    received: list[dict[str, int]] = [{} for _ in periods]
    for b, k, v in db.execute(issued_stmt).all():
        if 0 <= b < len(periods):
            issued[b][k or "غير محدد"] = int(v or 0)
    for b, k, v in db.execute(rec_stmt).all():
        if 0 <= b < len(periods):
            received[b][k or "غير محدد"] = int(v or 0)
    return [{"issued": i, "received": r,
             "issued_total": sum(i.values()), "received_total": sum(r.values())}
            for i, r in zip(issued, received, strict=True)]


TIER_LABELS = {"commercial": "تجاري", "semi_commercial": "نصف تجاري", "wholesale": "جملة",
               "semi_wholesale": "نصف جملة", "consumer": "مستهلك", "list_price": "سعر القائمة"}


def coupon_price_item(db: Session, m: dict) -> dict | None:
    from src.models.catalog import ItemPrice, PriceTier

    tier = m.get("coupon_item_tier") or "sale_price"
    try:
        tier_enum = PriceTier(tier)
    except ValueError:
        tier_enum = None
    candidates: list[Item] = []
    if m.get("coupon_item_id"):
        it = db.get(Item, int(m["coupon_item_id"]))
        if it is not None:
            candidates = [it]
    if not candidates and m.get("coupon_item_name"):
        from src.lib.arabic import western_digits

        def key(text: str) -> str:
            return norm(western_digits(text) or "").replace("x", "×").replace("*", "×")

        wanted = key(m["coupon_item_name"])
        candidates = [i for i in db.scalars(select(Item).where(Item.active.is_(True))).all()
                      if key(i.name) == wanted]
    for it in candidates if tier_enum is not None else []:
        price = db.scalar(select(ItemPrice.price).where(ItemPrice.item_id == it.id,
                                                        ItemPrice.tier == tier_enum))
        if price is not None and D(price) > 0:
            return {"id": it.id, "code": it.code, "name": it.name, "tier": tier_enum.value,
                    "tier_label": TIER_LABELS.get(tier_enum.value, tier_enum.value),
                    "price": D(price)}
    for it in candidates:
        if it.sale_price:
            return {"id": it.id, "code": it.code, "name": it.name, "tier": "sale_price",
                    "tier_label": "سعر البيع", "price": D(it.sale_price)}
    return None


def coupon_item_points(db: Session, m: dict, coupon_item: dict | None) -> Decimal | None:
    from src.models.loyalty import ProductPointValue

    ids: list[int] = []
    if coupon_item is not None:
        ids.append(coupon_item["id"])
    if m.get("coupon_item_name"):
        from src.lib.arabic import western_digits

        def key(text: str) -> str:
            return norm(western_digits(text) or "").replace("x", "×").replace("*", "×")

        wanted = key(m["coupon_item_name"])
        ids += [i.id for i in db.scalars(select(Item).where(Item.active.is_(True))).all()
                if key(i.name) == wanted and i.id not in ids]
    for iid in ids:
        v = db.scalar(select(ProductPointValue.point_value).where(ProductPointValue.item_id == iid))
        if v is not None and D(v) > 0:
            return D(v)
    return None


def gold_coupon_type(db: Session):
    from src.models.loyalty import CouponType

    for ct in db.scalars(select(CouponType).where(CouponType.active.is_(True))).all():
        if "ذهب" in norm(ct.name):
            return ct
    return None


def _pct(part: Decimal, whole: Decimal) -> str | None:
    return str((part / whole * 100).quantize(Decimal("0.01"))) if whole else None


PERIOD_UNITS = ("month", "quarter", "year")


def _months_back(day: date, months: int) -> date:
    n = day.year * 12 + day.month - 1 - months
    return date(n // 12, n % 12 + 1, 1)


def trailing_periods(anchor: date, unit: str, count: int) -> list[Period]:
    if unit == "year":
        start, step = date(anchor.year, 1, 1), 12
    elif unit == "quarter":
        start, step = date(anchor.year, (anchor.month - 1) // 3 * 3 + 1, 1), 3
    else:
        start, step = anchor.replace(day=1), 1
    out: list[Period] = []
    for k in range(count):
        first = _months_back(start, k * step)
        out.append((first, _months_back(first, -step) - timedelta(days=1)))
    return out


def build(db: Session, *, branch_id: int | None, date_from: date, date_to: date,
          posted_only: bool = True) -> dict:
    return build_many(db, branch_id=branch_id, periods=[(date_from, date_to)],
                      posted_only=posted_only)[0]


def _category_kept(excluded):
    cat = func.coalesce(Item.category, "بدون فئة")
    return cat.not_in(list(excluded)) if excluded else true()


def _frozen_lines_many(db: Session, *, head, line, fk: str, day, periods: list[Period],
                       branch_id: int | None, excluded, internal: bool, extra=()):
    b = _bucket(day, periods)
    base = (select().select_from(line)
            .join(head, head.id == getattr(line, fk))
            .join(Item, Item.id == line.item_id)
            .where(_span(day, periods), _category_kept(excluded), *extra))
    if branch_id is not None:
        base = base.where(head.branch_id == branch_id)
    if internal:
        base = base.where(_not_internal(head.customer_id, _internal_customers()))
    frozen = [ZERO for _ in periods]
    stmt = base.add_columns(b, func.sum(line.quantity * line.unit_cost)).where(
        line.unit_cost.is_not(None)).group_by(*_by(b, periods))
    for k, v in db.execute(stmt).all():
        if 0 <= k < len(periods):
            frozen[k] += D(v)
    open_rows: list[list[tuple[int, date, Decimal]]] = [[] for _ in periods]
    stmt = base.add_columns(b, line.item_id, day,
                            func.sum(line.quantity * func.coalesce(line.unit_factor, 1))).where(
        line.unit_cost.is_(None)).group_by(*_by(b, periods), line.item_id, day)
    for k, item_id, d, q in db.execute(stmt).all():
        if 0 <= k < len(periods):
            open_rows[k].append((item_id, d, D(q)))
    return frozen, open_rows


def _perpetual_many(db: Session, *, branch_id: int | None, periods: list[Period], excluded,
                    book: costing_service.CostBook, internal: bool) -> list[dict]:
    out = [{"sold": ZERO, "returns": ZERO, "estimated": ZERO, "differences": ZERO,
            "consumption": ZERO, "production": ZERO, "missing": 0} for _ in periods]

    def priced(rows, key: str, sign: int, k: int, estimate: bool = False) -> None:
        for item_id, d, q in rows:
            c = book.at(item_id, d)
            if c is None:
                out[k]["missing"] += 1
                continue
            out[k][key] += sign * q * c
            if estimate:
                out[k]["estimated"] += q * c if key == "sold" else -q * c

    inv_day = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    frozen, open_rows = _frozen_lines_many(
        db, head=SalesInvoice, line=SalesInvoiceLine, fk="invoice_id", day=inv_day,
        periods=periods, branch_id=branch_id, excluded=excluded, internal=internal)
    for k in range(len(periods)):
        out[k]["sold"] += frozen[k]
        priced(open_rows[k], "sold", 1, k, estimate=True)

    ret_day = func.coalesce(SalesReturn.return_date, cast(SalesReturn.created_at, Date))
    frozen, open_rows = _frozen_lines_many(
        db, head=SalesReturn, line=SalesReturnLine, fk="return_id", day=ret_day,
        periods=periods, branch_id=branch_id, excluded=excluded, internal=internal,
        extra=(SalesReturn.reversed_at.is_(None),))
    for k in range(len(periods)):
        out[k]["returns"] += frozen[k]
        priced(open_rows[k], "returns", 1, k, estimate=True)

    day = costing_service.movement_day()
    b = _bucket(day, periods)
    sq = costing_service.signed_quantity()
    mine = inventory_valuation_service.branch_warehouse_ids(db, branch_id)
    where = [StockMovement.location_kind == LocationKind.warehouse, _span(day, periods),
             _category_kept(excluded)]
    if mine is not None:
        where.append(StockMovement.location_id.in_(mine or [-1]))
    doc = func.coalesce(StockMovement.source_doc_type, "")
    kind = case((and_(doc.in_(PRODUCTION_DOCS), StockMovement.movement_type.in_(PRODUCT_MOVES)),
                 "product"),
                (doc.in_(PRODUCTION_DOCS), "consumption"), else_="difference")
    stmt = (select(b, kind, StockMovement.item_id, day, func.sum(sq))
            .join(Item, Item.id == StockMovement.item_id)
            .where(*where, or_(doc.not_in(NOT_DIFFERENCES), doc.in_(PRODUCTION_DOCS)))
            .group_by(*_by(b, periods), kind, StockMovement.item_id, day))
    uncosted: list[list[tuple[int, date, Decimal]]] = [[] for _ in periods]
    for k, what, item_id, d, q in db.execute(stmt).all():
        if not 0 <= k < len(periods):
            continue
        if what == "product":
            continue
        c = book.at(item_id, d)
        if c is None:
            out[k]["missing"] += 1
            continue
        out[k]["consumption" if what == "consumption" else "differences"] += -D(q) * c

    pop = ProductionOrderProduct
    unit = case(
        (and_(pop.total_cost > 0, pop.quantity > 0),
         pop.total_cost / (pop.quantity * func.coalesce(pop.unit_factor, 1))),
        (and_(ManufacturingOrder.total_cost > 0, ManufacturingOrder.quantity > 0),
         ManufacturingOrder.total_cost / ManufacturingOrder.quantity),
        else_=None)
    stmt = (select(b, StockMovement.item_id, day,
                   func.sum(case((unit.is_not(None), sq * unit), else_=0)),
                   func.sum(case((unit.is_(None), sq), else_=0)))
            .select_from(StockMovement)
            .join(Item, Item.id == StockMovement.item_id)
            .outerjoin(ProductionOrderProduct,
                       ProductionOrderProduct.stock_movement_id == StockMovement.id)
            .outerjoin(ManufacturingOrder, ManufacturingOrder.stock_movement_id == StockMovement.id)
            .where(*where, doc.in_(PRODUCTION_DOCS),
                   StockMovement.movement_type.in_(PRODUCT_MOVES))
            .group_by(*_by(b, periods), StockMovement.item_id, day))
    for k, item_id, d, valued, q in db.execute(stmt).all():
        if not 0 <= k < len(periods):
            continue
        out[k]["production"] += D(valued)
        if D(q):
            uncosted[k].append((item_id, d, D(q)))
    for k in range(len(periods)):
        priced(uncosted[k], "production", 1, k)
        o = out[k]
        o["materials"] = (o["sold"] - o["returns"] + o["differences"]
                          + o["consumption"] - o["production"])
    return out


def build_many(db: Session, *, branch_id: int | None, periods: list[Period],
               posted_only: bool = True) -> list[dict]:
    cfg = get_config(db, branch_id)
    excluded_cats = cfg["inventory"].get("exclude_categories") or []
    inv_cfg = cfg["inventory"]
    m = cfg["marketing"]
    internal = _eliminate_internal(cfg, branch_id)
    all_rows = _sales_rows_many(db, branch_id=branch_id, periods=periods,
                                include_bonus=bool(cfg["sales"].get("include_bonus")),
                                internal=internal)
    all_moves = _account_movements(db, branch_id=branch_id, periods=periods,
                                   posted_only=posted_only)
    index = _accounts_index(db, branch_id)
    for moves in all_moves:
        for acc_id in moves:
            if acc_id not in index:
                acc = db.get(Account, acc_id)
                if acc is not None:
                    index[acc_id] = acc
    book = costing_service.cost_book(db, branch_id=branch_id,
                                     until=max(t for _, t in periods))
    vals = inventory_valuation_service.values_at(
        db, branch_id=branch_id,
        dates=[d for f, t in periods for d in (f - timedelta(days=1), t)],
        cost_basis=inv_cfg.get("cost_basis", "average"), exclude_categories=excluded_cats,
        list_factors=inv_cfg.get("list_factors"), book=book)
    all_purchases = net_purchases_many(db, branch_id=branch_id, periods=periods,
                                       exclude_categories=excluded_cats, internal=internal)
    perpetual = _perpetual_many(db, branch_id=branch_id, periods=periods,
                                excluded=excluded_cats, book=book, internal=internal)
    all_coupons = coupons_many(db, branch_id=branch_id, periods=periods)
    coupon_item = coupon_price_item(db, m)
    item_points = coupon_item_points(db, m, coupon_item)
    gold = gold_coupon_type(db)
    branch = db.get(Branch, branch_id) if branch_id else None
    memo: dict = {}
    roles: dict[int, str] = {}
    return [
        _statement(cfg=cfg, branch=branch, branch_id=branch_id, date_from=f, date_to=t,
                   posted_only=posted_only, rows=all_rows[i], moves=all_moves[i], index=index,
                   opening_val=vals[f - timedelta(days=1)], closing_val=vals[t],
                   purchases=all_purchases[i], perpetual=perpetual[i], coupons=all_coupons[i],
                   coupon_item=coupon_item, item_points=item_points, gold=gold, memo=memo,
                   roles=roles, internal=internal)
        for i, (f, t) in enumerate(periods)
    ]


def _statement(*, cfg: dict, branch: Branch | None, branch_id: int | None, date_from: date,
               date_to: date, posted_only: bool, rows: list[dict], moves: dict[int, Decimal],
               index: dict[int, Account], opening_val, closing_val, purchases: dict,
               perpetual: dict, coupons: dict, coupon_item: dict | None,
               item_points: Decimal | None, gold, memo: dict, roles: dict[int, str],
               internal: bool) -> dict:
    period = cfg.get("periods", {}).get(period_key(date_from, date_to)) or {}
    excluded_cats = cfg["inventory"].get("exclude_categories") or []
    cats = cfg["sales"]["categories"]
    buckets, unmatched = classify_sales(rows, cats, memo)
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

    saved_roles = {str(k): v for k, v in (cfg["accounts"].get("roles") or {}).items()}
    by_role: dict[str, list[tuple[Account, Decimal]]] = {}
    ledger_net = ZERO
    for acc_id, dc in moves.items():
        acc = index.get(acc_id)
        if acc is None or dc == ZERO:
            continue
        nature = effective_nature(acc)
        if nature is None or nature.value not in ("income", "expense"):
            continue
        ledger_net -= dc
        if acc_id not in roles:
            roles[acc_id] = resolve_role(acc, saved_roles)[0]
        role = roles[acc_id]
        by_role.setdefault(role, []).append((acc, -dc if role in PROFIT_SIDE else dc))
    groups = cfg["accounts"].get("groups") or []

    def role_total(role: str) -> Decimal:
        return sum((a for _, a in by_role.get(role, [])), ZERO)

    adjustments = [a for a in period.get("adjustments") or [] if a.get("section") in ADJ_SECTIONS]

    def adj_lines(section: str) -> list[dict]:
        return [{"name": a.get("label") or "بند يدوي", "amount": D(a.get("amount")),
                 "accounts": [], "manual": True, "note": a.get("note") or "زيادة"}
                for a in adjustments if a.get("section") == section]

    def section(role: str, manual_section: str | None = None, grouped: bool = True,
                by_parent: bool = False) -> dict:
        lines = _section_lines(by_role.get(role, []), groups if grouped else [], index,
                               by_parent=by_parent)
        if manual_section:
            lines += adj_lines(manual_section)
        total = sum((ln["amount"] for ln in lines), ZERO)
        for ln in lines:
            ln["amount"] = str(to_money(ln["amount"]))
        return {"lines": lines, "total": str(to_money(total)), "_total": total}

    inv_cfg = cfg["inventory"]
    method = inv_cfg.get("cogs_method") if inv_cfg.get("cogs_method") in COGS_METHODS \
        else "periodic"

    def inv_block(val, override_key: str) -> dict:
        override = period.get(override_key)
        used = D(override) if override not in (None, "") else val.total
        return {"amount": str(to_money(used)), "_amount": used,
                "source": "override" if override not in (None, "") else "computed",
                "computed": str(val.total), "as_of": val.as_of.isoformat(),
                "by_category": {k: str(v) for k, v in val.by_category.items()},
                "missing_cost": val.missing_cost, "missing_items": val.missing_items[:20],
                "negative_rows": val.negative_rows, "negative_value": str(val.negative_value)}

    opening = inv_block(opening_val, "opening_inventory")
    closing = inv_block(closing_val, "closing_inventory")
    periodic_materials = opening["_amount"] + purchases["net"] - closing["_amount"]
    perpetual_materials = perpetual["materials"]
    direct_materials = perpetual_materials if method == "perpetual" else periodic_materials
    mfg = {r: role_total(r) for r in MFG_ROLES}
    cost_manual = adj_lines("cost")
    cost_manual_total = sum((ln["amount"] for ln in cost_manual), ZERO)
    for ln in cost_manual:
        ln["amount"] = str(to_money(ln["amount"]))
    cost_of_sales = direct_materials + sum(mfg.values(), ZERO) + cost_manual_total
    gross_profit = sales_total - cost_of_sales

    ga = section("ga", "ga")
    other_income = section("other_income", "other_income", grouped=False, by_parent=True)
    other_loss = section("other_loss", "other_loss", grouped=False, by_parent=True)
    marketing_ledger = section("marketing", grouped=False)
    unclassified_lines = _section_lines(by_role.get("unclassified", []), [], index,
                                        by_parent=True)
    unclassified_total = sum((ln["amount"] for ln in unclassified_lines), ZERO)
    for ln in unclassified_lines:
        ln["amount"] = str(to_money(ln["amount"]))

    m = cfg["marketing"]
    disc = D(m.get("coupon_discount_pct"))
    if coupon_item is not None:
        coupon_price = coupon_item["price"]
        coupon_unit = coupon_price * (100 - disc) / 100
    else:
        coupon_price = D(m.get("coupon_base"))
        coupon_unit = coupon_price * D(m.get("coupon_base_pct")) / 100
    bonus_coupons = bonus_value / coupon_unit if coupon_unit else ZERO
    ratio_num = item_points if item_points is not None else D(m.get("ratio_num"))
    if gold is not None and gold.point_cost:
        ratio_den, den_source = D(gold.point_cost), f"من «أنواع الكوبونات»: {gold.name}"
    else:
        ratio_den, den_source = D(m.get("gold_coupon_points") or m.get("ratio_den")), "من الإعدادات"
    ratio_coupons = bonus_coupons * ratio_num / ratio_den if ratio_den else ZERO
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
    net_profit = (operating_profit + other_income["_total"] - other_loss["_total"]
                  + unclassified_total)

    ledger_net_sales = (role_total("sales") - role_total("sales_returns")
                        - role_total("sales_discount"))
    ledger_net_purchases = role_total("purchases") - role_total("purchase_returns")
    manual_total = sum((D(a.get("amount")) for a in adjustments
                        if a.get("section") in ("ga", "cost", "marketing", "other_loss")), ZERO) \
        - sum((D(a.get("amount")) for a in adjustments if a.get("section") == "other_income"), ZERO)
    bridge = [
        {"key": "ledger", "label": "صافي الربح في الدفاتر", "amount": ledger_net},
        {"key": "sales", "label": "المبيعات من المستندات مقابل الدفاتر",
         "amount": sales_total - ledger_net_sales},
        {"key": "purchases", "label": "المشتريات في الدفاتر مقابل المستندات",
         "amount": ledger_net_purchases - purchases["net"]},
        {"key": "inventory", "label": "تغير المخزون (آخر المدة − أول المدة)",
         "amount": closing["_amount"] - opening["_amount"]},
        {"key": "method", "label": "فرق طريقة التكلفة (الجرد الدوري − التكلفة المجمّدة)",
         "amount": (periodic_materials - perpetual_materials) if method == "perpetual" else ZERO},
        {"key": "excluded", "label": "حسابات مستبعدة من القائمة",
         "amount": role_total("excluded")},
        {"key": "marketing", "label": "التسويق في الدفاتر مقابل القائمة",
         "amount": marketing_ledger["_total"] - base},
        {"key": "manual", "label": "بنود يدوية", "amount": -manual_total},
    ]
    explained = sum((x["amount"] for x in bridge), ZERO)
    bridge.append({"key": "statement", "label": "صافي الربح في القائمة", "amount": net_profit})
    bridge.append({"key": "residual", "label": "فرق غير مفسر", "amount": net_profit - explained})
    for x in bridge:
        x["amount"] = str(to_money(x["amount"]))

    recon = {
        "ledger_sales": str(to_money(role_total("sales"))),
        "ledger_sales_returns": str(to_money(role_total("sales_returns"))),
        "ledger_sales_discount": str(to_money(role_total("sales_discount"))),
        "ledger_net_sales": str(to_money(ledger_net_sales)),
        "documents_net_sales": str(to_money(sales_total)),
        "ledger_purchases": str(to_money(role_total("purchases"))),
        "ledger_purchase_returns": str(to_money(role_total("purchase_returns"))),
        "ledger_net_purchases": str(to_money(ledger_net_purchases)),
        "documents_net_purchases": str(purchases["net"]),
        "documents_excluded_purchases": str(purchases["excluded"]),
        "ledger_net_profit": str(to_money(ledger_net)),
        "bridge": bridge,
        "excluded_accounts": [{"account_id": a.id, "code": a.code, "name": a.name,
                               "amount": str(to_money(v))}
                              for a, v in sorted(by_role.get("excluded", []),
                                                 key=lambda t: -t[1])],
        "doc_role_accounts": [{"account_id": a.id, "code": a.code, "name": a.name,
                               "role": r, "amount": str(to_money(v))}
                              for r in DOC_ROLES for a, v in by_role.get(r, [])],
        "internal_eliminated": internal,
    }

    for blk in (opening, closing):
        blk.pop("_amount", None)
    for s in (ga, other_income, other_loss, marketing_ledger):
        s.pop("_total", None)
    p = perpetual
    return {
        "branch_id": branch_id, "branch_name": branch.name if branch else "كل الفروع",
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "posted_only": posted_only, "period_key": period_key(date_from, date_to),
        "sales": {"lines": sales_lines, "total": str(to_money(sales_total)),
                  "bonus_value": str(to_money(bonus_value)),
                  "unmatched": str(to_money(unmatched_total)),
                  "include_bonus": bool(cfg["sales"].get("include_bonus"))},
        "cost": {
            "method": method,
            "opening_inventory": opening, "closing_inventory": closing,
            "purchases": {k: (str(v) if isinstance(v, Decimal) else v)
                          for k, v in purchases.items()},
            "periodic_materials": str(to_money(periodic_materials)),
            "perpetual": {
                "sold": str(to_money(p["sold"])), "returns": str(to_money(p["returns"])),
                "estimated": str(to_money(p["estimated"])),
                "differences": str(to_money(p["differences"])),
                "consumption": str(to_money(p["consumption"])),
                "production": str(to_money(p["production"])),
                "production_net": str(to_money(p["consumption"] - p["production"])),
                "missing": p["missing"],
                "materials": str(to_money(perpetual_materials)),
            },
            "method_gap": str(to_money(periodic_materials - perpetual_materials)),
            "direct_materials": str(to_money(direct_materials)),
            "direct_labor": str(to_money(mfg["direct_labor"])),
            "indirect_materials": str(to_money(mfg["indirect_materials"])),
            "indirect_labor": str(to_money(mfg["indirect_labor"])),
            "other_mfg": str(to_money(mfg["other_mfg"])),
            "mfg_accounts": [{"account_id": a.id, "code": a.code, "name": a.name, "role": r,
                              "amount": str(to_money(v))}
                             for r in MFG_ROLES for a, v in by_role.get(r, [])],
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
                "coupon_unit": str(to_money(coupon_unit)),
                "coupon_price": str(to_money(coupon_price)),
                "coupon_discount_pct": str(disc) if coupon_item is not None
                else str(100 - D(m.get("coupon_base_pct"))),
                "coupon_item": ({k: v for k, v in coupon_item.items() if k != "price"}
                                if coupon_item is not None else None),
                "bonus_coupons": str(bonus_coupons.quantize(Decimal("0.01"))),
                "ratio_num": f"{ratio_num.normalize():f}" if ratio_num else "0",
                "ratio_num_source": "نقاط الصنف" if item_points is not None else "من الإعدادات",
                "ratio_den": f"{ratio_den.normalize():f}" if ratio_den else "0",
                "ratio_den_source": den_source,
                "ratio_den_editable": gold is None or not gold.point_cost,
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
        "unclassified": {"lines": unclassified_lines, "total": str(to_money(unclassified_total))},
        "net_profit": str(to_money(net_profit)),
        "net_margin_pct": _pct(net_profit, sales_total),
        "expenses_to_sales_pct": _pct(D(ga["total"]), sales_total),
        "reconciliation": recon,
        "period_inputs": period,
    }
