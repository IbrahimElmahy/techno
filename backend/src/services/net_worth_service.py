from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee
from src.models.fixed_asset import AssetStatus, DepreciationRecord, FixedAsset, FixedAssetEvent
from src.models.ledger import Direction, LedgerEntry, LedgerLine
from src.models.org import Branch
from src.models.supplier import Supplier, SupplierAccount
from src.models.treasury import Treasury
from src.services import inventory_valuation_service, ledger_service

CAP_NET_WORTH = "report.net_worth"


def can_view(current) -> bool:
    from src.models.role import RoleName

    return current.role == RoleName.owner or CAP_NET_WORTH in current.grants


def _balances(db: Session, account_ids: set[int], as_of: date) -> dict[int, Decimal]:
    if not account_ids:
        return {}
    day = func.coalesce(LedgerEntry.entry_date, cast(LedgerEntry.created_at, Date))
    signed = case((LedgerLine.direction == Direction.debit, LedgerLine.amount),
                  else_=-LedgerLine.amount)
    rows = db.execute(
        select(LedgerLine.account_id, func.sum(signed))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(account_ids), ledger_service.is_posted_sql(),
               day <= as_of)
        .group_by(LedgerLine.account_id)).all()
    return {aid: to_money(v or 0) for aid, v in rows}


def _section(key: str, label: str, rows: list[dict], *, liability: bool = False) -> dict:
    rows = [r for r in rows if r["value"] != ZERO]
    rows.sort(key=lambda r: -abs(r["value"]))
    total = to_money(sum((r["value"] for r in rows), ZERO))
    return {"key": key, "label": label, "liability": liability, "total": total, "rows": rows}


def _cash(db: Session, branch_id: int | None, as_of: date, names: dict) -> dict:
    stmt = select(Treasury).where(Treasury.active.is_(True))
    if branch_id is not None:
        stmt = stmt.where(Treasury.branch_id == branch_id)
    boxes = db.scalars(stmt).all()
    bal = _balances(db, {t.account_id for t in boxes}, as_of)
    rows = [{"name": t.name, "branch": names.get(t.branch_id),
             "kind": "بنك" if t.kind.value == "bank" else "خزينة",
             "value": bal.get(t.account_id, ZERO)} for t in boxes]
    return _section("cash", "النقدية بالخزائن والبنوك", rows)


BASES = {
    "average": "متوسط التكلفة",
    "avg_purchase": "متوسط سعر الشراء خلال الفترة",
    "last_purchase": "آخر سعر شراء",
    "avg_list": "متوسط سعر القائمة خلال الفترة",
    "list": "سعر القائمة في التاريخ",
}


def _inventory(db: Session, branch_id: int | None, as_of: date, names: dict, *,
               basis: str, price_field: str, period_from: date) -> dict:
    from src.models.catalog import Item
    from src.models.warehouse import Warehouse
    from src.services import costing_service, price_list_service

    qtys = inventory_valuation_service.quantities_at(db, branch_id=branch_id, as_of=as_of)
    ids = {iid for iid, _ in qtys}
    book = costing_service.cost_book(db, branch_id=branch_id, until=as_of)
    avco = {iid: c for iid in ids if (c := book.at(iid, as_of)) is not None}
    chosen: dict[int, Decimal] = {}
    if basis == "avg_purchase":
        chosen = price_list_service.purchase_prices(db, item_ids=ids, start=period_from, end=as_of)
    elif basis == "last_purchase":
        chosen = price_list_service.last_purchase_prices(db, item_ids=ids, end=as_of)
    elif basis in ("avg_list", "list"):
        tls = price_list_service.timelines(db, fields=[price_field], item_ids=ids)
        for iid in ids:
            tl = tls.get((iid, price_field))
            if tl is None:
                continue
            v = tl.average(period_from, as_of) if basis == "avg_list" else tl.at(as_of)
            if v is not None and v > 0:
                chosen[iid] = v
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(ids or [-1]))).all()}
    wh = {w.id: w for w in db.scalars(select(Warehouse)).all()}
    per_wh: dict[int, Decimal] = {}
    per_cat: dict[str, Decimal] = {}
    fallback, missing = set(), set()
    for (iid, wid), qty in qtys.items():
        unit = chosen.get(iid)
        if unit is None and basis != "average":
            unit = avco.get(iid)
            if unit is not None:
                fallback.add(iid)
        if unit is None:
            unit = avco.get(iid) if basis == "average" else None
        if unit is None:
            missing.add(iid)
            continue
        v = to_money(qty * unit)
        per_wh[wid] = per_wh.get(wid, ZERO) + v
        cat = (items[iid].category if iid in items else None) or "بدون فئة"
        per_cat[cat] = per_cat.get(cat, ZERO) + v
    rows = [{"name": wh[w].name if w in wh else f"#{w}",
             "branch": names.get(wh[w].branch_id) if w in wh else None,
             "value": to_money(v)} for w, v in per_wh.items()]
    out = _section("inventory", "المخزون", rows)
    out["missing_cost"] = len(missing)
    out["fallback"] = len(fallback)
    out["by_category"] = sorted(
        ({"name": k, "value": str(to_money(v))} for k, v in per_cat.items() if v != ZERO),
        key=lambda r: -abs(Decimal(r["value"])))
    return out


def _fixed_assets(db: Session, branch_id: int | None, as_of: date, names: dict) -> dict:
    period = as_of.year * 100 + as_of.month
    dep = (select(DepreciationRecord.asset_id, func.sum(DepreciationRecord.amount).label("v"))
           .where(DepreciationRecord.year * 100 + DepreciationRecord.month <= period)
           .group_by(DepreciationRecord.asset_id).subquery())
    dec = (select(FixedAssetEvent.asset_id, func.sum(FixedAssetEvent.amount).label("v"))
           .where(FixedAssetEvent.kind == "decrease", FixedAssetEvent.event_date <= as_of)
           .group_by(FixedAssetEvent.asset_id).subquery())
    book = (FixedAsset.cost - func.coalesce(FixedAsset.opening_accumulated, 0)
            - func.coalesce(dep.c.v, 0) - func.coalesce(dec.c.v, 0))
    stmt = (select(func.coalesce(FixedAsset.category, "بدون فئة"), FixedAsset.branch_id,
                   func.count(), func.sum(book))
            .select_from(FixedAsset)
            .outerjoin(dep, dep.c.asset_id == FixedAsset.id)
            .outerjoin(dec, dec.c.asset_id == FixedAsset.id)
            .where(FixedAsset.status == AssetStatus.active,
                   FixedAsset.acquisition_date <= as_of)
            .group_by(func.coalesce(FixedAsset.category, "بدون فئة"), FixedAsset.branch_id))
    if branch_id is not None:
        stmt = stmt.where(FixedAsset.branch_id == branch_id)
    rows = [{"name": cat, "branch": names.get(b), "count": n, "value": to_money(v or 0)}
            for cat, b, n, v in db.execute(stmt).all()]
    return _section("fixed_assets", "الأصول الثابتة بالقيمة الدفترية", rows)


def _parties(db: Session, branch_id: int | None, as_of: date, names: dict) -> tuple[dict, dict]:
    cust = db.execute(
        select(CustomerAccount.account_id, Customer.branch_id)
        .join(Customer, Customer.id == CustomerAccount.customer_id)
        .where(Customer.customer_type != "owner")).all()
    supp = db.execute(
        select(SupplierAccount.account_id, Supplier.branch_id)
        .join(Supplier, Supplier.id == SupplierAccount.supplier_id)).all()
    emps = db.execute(
        select(Employee.receivable_account_id, Employee.branch_id)
        .where(Employee.receivable_account_id.is_not(None))).all()
    kind: dict[int, tuple[str, int | None]] = {}
    for aid, b in emps:
        kind[aid] = ("employee", b)
    for aid, b in supp:
        kind[aid] = ("supplier", b)
    for aid, b in cust:
        kind[aid] = ("customer", b)
    if branch_id is not None:
        kind = {a: v for a, v in kind.items() if v[1] == branch_id}
    bal = _balances(db, set(kind), as_of)
    sums: dict[tuple[str, str, int | None], list] = {}
    for aid, v in bal.items():
        if v == ZERO:
            continue
        k, b = kind[aid]
        side = "in" if v > 0 else "out"
        cell = sums.setdefault((k, side, b), [ZERO, 0])
        cell[0] += v
        cell[1] += 1
    labels = {
        ("customer", "in"): "مديونية العملاء",
        ("supplier", "in"): "دفعات مقدمة للموردين",
        ("employee", "in"): "سلف وذمم الموظفين",
        ("customer", "out"): "أرصدة دائنة للعملاء",
        ("supplier", "out"): "مستحقات الموردين",
        ("employee", "out"): "مستحقات للموظفين",
    }
    due, owed = [], []
    for (k, side, b), (v, n) in sums.items():
        row = {"name": labels[(k, side)], "branch": names.get(b), "count": n,
               "value": to_money(abs(v))}
        (due if side == "in" else owed).append(row)
    return (_section("receivables", "مستحقات لنا", due),
            _section("payables", "مستحقات علينا", owed, liability=True))


def build(db: Session, *, branch_id: int | None, as_of: date, basis: str = "average",
          price_field: str = "purchase_price", period_from: date | None = None) -> dict:
    from src.services.price_list_service import FIELDS

    if basis not in BASES:
        basis = "average"
    if price_field not in FIELDS:
        price_field = "purchase_price"
    if period_from is None or period_from > as_of:
        period_from = as_of.replace(year=as_of.year - 1)
    names = dict(db.execute(select(Branch.id, Branch.name)).all())
    receivables, payables = _parties(db, branch_id, as_of, names)
    sections = [
        _cash(db, branch_id, as_of, names),
        _inventory(db, branch_id, as_of, names, basis=basis, price_field=price_field,
                   period_from=period_from),
        _fixed_assets(db, branch_id, as_of, names),
        receivables,
        payables,
    ]
    assets = to_money(sum((s["total"] for s in sections if not s["liability"]), ZERO))
    liabilities = to_money(sum((s["total"] for s in sections if s["liability"]), ZERO))
    return {
        "as_of": as_of.isoformat(), "branch_id": branch_id,
        "basis": basis, "price_field": price_field, "period_from": period_from.isoformat(),
        "bases": [{"key": k, "label": v} for k, v in BASES.items()],
        "price_fields": [{"key": k, "label": v} for k, v in FIELDS.items()],
        "sections": [{**s, "total": str(s["total"]),
                      "rows": [{**r, "value": str(r["value"])} for r in s["rows"]]}
                     for s in sections],
        "assets": str(assets), "liabilities": str(liabilities),
        "net": str(to_money(assets - liabilities)),
    }
