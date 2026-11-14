from __future__ import annotations

import calendar
from datetime import date
from decimal import ROUND_CEILING, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services.numbering import next_document_number
from src.core.money import ZERO, to_money
from src.lib import depreciation
from src.models.fixed_asset import (
    AssetStatus,
    DepreciationRecord,
    FixedAsset,
    FixedAssetCategory,
)
from src.models.ledger import Account, AccountNature, Direction
from src.services import audit_service, ledger_service
from src.services.ledger_service import LineInput

_ASSET_GROUP = ("1.03", "الأصول الثابتة", AccountNature.asset, "1")
_DEFAULTS = {
    "asset": ("1.03.001", "الأصول الثابتة", AccountNature.asset, Direction.debit),
    "accumulated": ("1.03.002", "مجمع إهلاك الأصول الثابتة", AccountNature.asset,
                    Direction.credit),
    "expense": ("5.003", "مصروف الإهلاك", AccountNature.expense, Direction.debit),
}

DEFAULT_CATEGORIES = [
    ("أراضي", "none", None, None, "admin"),
    ("مباني", "straight_line", Decimal("5"), 240, "admin"),
    ("آلات ومعدات", "straight_line", Decimal("10"), 120, "production"),
    ("عدد وأدوات", "straight_line", Decimal("20"), 60, "production"),
    ("سيارات", "straight_line", Decimal("20"), 60, "admin"),
    ("أثاث ومفروشات", "straight_line", Decimal("10"), 120, "admin"),
    ("كمبيوتر", "straight_line", Decimal("25"), 48, "admin"),
    ("أجهزة كهربية", "straight_line", Decimal("20"), 60, "admin"),
    ("مصاريف تأسيس", "straight_line", Decimal("20"), 60, "admin"),
    ("برامج وتراخيص", "straight_line", Decimal("25"), 48, "admin"),
]

METHODS = depreciation.METHODS
USAGES = ("production", "admin")
USAGE_EXPENSE = {"production": "مصروف إهلاك صناعي", "admin": "مصروف إهلاك إداري"}

_NORM = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"})


class FixedAssetError(Exception):
    pass


def _norm(text: str | None) -> str:
    return " ".join(str(text or "").translate(_NORM).split())


def _get_or_create_account(
    db: Session, code: str, name: str, nature: AccountNature, side: Direction,
    parent_code: str | None,
) -> Account:
    from src.models.ledger import AccountType

    acc = db.scalar(select(Account).where(Account.code == code))
    if acc is not None:
        return acc
    parent = (db.scalar(select(Account).where(Account.code == parent_code))
              if parent_code else None)
    acc = Account(
        account_type=AccountType.user_defined, normal_side=side, code=code, name=name,
        nature=nature, is_postable=parent_code is not None, is_system=True,
        parent_id=parent.id if parent else None,
    )
    db.add(acc)
    db.flush()
    return acc


def default_accounts(db: Session) -> dict[str, Account]:
    code, name, nature, parent = _ASSET_GROUP
    group = db.scalar(select(Account).where(Account.code == code))
    if group is None:
        group = _get_or_create_account(db, code, name, nature, Direction.debit, parent)
        group.is_postable = False
        db.flush()
    out: dict[str, Account] = {}
    for key, (acc_code, acc_name, acc_nature, side) in _DEFAULTS.items():
        parent_code = "1.03" if acc_code.startswith("1.03") else "5"
        out[key] = _get_or_create_account(db, acc_code, acc_name, acc_nature, side, parent_code)
    return out


def ensure_categories(db: Session) -> list[FixedAssetCategory]:
    rows = list(db.scalars(select(FixedAssetCategory).order_by(FixedAssetCategory.id)).all())
    if rows:
        return rows
    for name, method, rate, life, usage in DEFAULT_CATEGORIES:
        db.add(FixedAssetCategory(name=name, method=method, annual_rate=rate,
                                  useful_life_months=life, usage=usage, active=True))
    db.flush()
    return list(db.scalars(select(FixedAssetCategory).order_by(FixedAssetCategory.id)).all())


def list_categories(db: Session) -> list[FixedAssetCategory]:
    return ensure_categories(db)


def save_category(db: Session, *, category_id: int | None, name: str, method: str,
                  annual_rate=None, useful_life_months: int | None = None,
                  usage: str = "admin", active: bool = True) -> FixedAssetCategory:
    name = " ".join(str(name or "").split())
    if not name:
        raise FixedAssetError("اسم الفئة مطلوب.")
    if method not in METHODS:
        raise FixedAssetError("طريقة الإهلاك غير صحيحة.")
    if usage not in USAGES:
        raise FixedAssetError("طبيعة الاستخدام غير صحيحة.")
    clash = db.scalar(select(FixedAssetCategory).where(FixedAssetCategory.name == name))
    if clash is not None and clash.id != category_id:
        raise FixedAssetError("توجد فئة بنفس الاسم.")
    cat = db.get(FixedAssetCategory, category_id) if category_id else FixedAssetCategory()
    if cat is None:
        raise FixedAssetError("الفئة غير موجودة.")
    cat.name = name
    cat.method = method
    cat.annual_rate = Decimal(str(annual_rate)) if annual_rate not in (None, "") else None
    cat.useful_life_months = int(useful_life_months) if useful_life_months else None
    cat.usage = usage
    cat.active = bool(active)
    if not category_id:
        db.add(cat)
    db.flush()
    return cat


def _group(db: Session, branch_id: int | None, suffix: str) -> Account | None:
    from src.services import org_service

    bid = org_service.resolve_branch_id(db, branch_id)
    rows = db.scalars(select(Account).where(
        Account.branch_id == bid, Account.code.like(f"%{suffix}"))).all()
    for acc in rows:
        if acc.code == suffix or acc.code.endswith("-" + suffix):
            return acc
    return None


def _child(db: Session, parent: Account, names: list[str]) -> Account:
    from src.models.ledger import AccountType

    wanted = {_norm(n) for n in names}
    children = db.scalars(select(Account).where(Account.parent_id == parent.id)).all()
    for acc in children:
        if acc.active and acc.is_postable and _norm(acc.name) in wanted:
            return acc
    n = len(children) + 1
    while db.scalar(select(Account.id).where(Account.code == f"{parent.code}.{n}")) is not None:
        n += 1
    acc = Account(
        account_type=AccountType.user_defined, normal_side=parent.normal_side,
        code=f"{parent.code}.{n}", name=names[0], nature=parent.nature,
        is_postable=True, is_system=False, parent_id=parent.id,
        branch_id=parent.branch_id,
    )
    db.add(acc)
    db.flush()
    return acc


def category_accounts(db: Session, category: FixedAssetCategory,
                      branch_id: int | None) -> tuple[Account, Account]:
    assets = _group(db, branch_id, "A5M-18")
    accum = _group(db, branch_id, "A5M-20")
    defaults = default_accounts(db) if assets is None or accum is None else None
    asset_acc = (_child(db, assets, [category.name]) if assets is not None
                 else defaults["asset"])
    accum_acc = (_child(db, accum, [f"مجمع إهلاك {category.name}", category.name])
                 if accum is not None else defaults["accumulated"])
    return asset_acc, accum_acc


def expense_account(db: Session, usage: str, branch_id: int | None) -> Account:
    group = _group(db, branch_id, "A5M-48")
    if group is None:
        return default_accounts(db)["expense"]
    return _child(db, group, [USAGE_EXPENSE.get(usage, USAGE_EXPENSE["admin"])])


def _asset_branch(db: Session, branch_id: int | None, actor_user_id: int) -> int:
    from src.auth.branch_scope import branch_for
    from src.services import org_service

    return org_service.resolve_branch_id(
        db, branch_id or branch_for(db, actor_user_id=actor_user_id))


def _code(db: Session) -> str:
    return next_document_number(db, FixedAsset, "FA", column=FixedAsset.code, width=5)


def create_asset(
    db: Session, *, name: str, acquisition_date: date, cost, actor_user_id: int,
    useful_life_months: int | None = None, salvage_value=0, method: str | None = None,
    category: str | None = None, notes: str | None = None, branch_id: int | None = None,
    cost_center_id: int | None = None, asset_account_id: int | None = None,
    accumulated_account_id: int | None = None, expense_account_id: int | None = None,
    category_id: int | None = None, usage: str | None = None, annual_rate=None,
    opening_accumulated=0, depreciation_start: date | None = None,
    source_kind: str | None = None, source_id: int | None = None,
) -> FixedAsset:
    if not name or not str(name).strip():
        raise FixedAssetError("اسم الأصل مطلوب.")
    money_cost = to_money(cost)
    salvage = to_money(salvage_value or 0)
    opening = to_money(opening_accumulated or 0)
    if money_cost <= ZERO:
        raise FixedAssetError("يجب أن تكون تكلفة الأصل أكبر من صفر.")
    if salvage < ZERO:
        raise FixedAssetError("القيمة التخريدية لا تكون بالسالب.")
    if salvage > money_cost:
        raise FixedAssetError("القيمة التخريدية لا تزيد عن التكلفة.")
    if opening < ZERO:
        raise FixedAssetError("مجمع الإهلاك السابق لا يكون بالسالب.")
    if opening > to_money(money_cost - salvage):
        raise FixedAssetError("مجمع الإهلاك السابق لا يزيد عن القيمة القابلة للإهلاك.")

    cat = None
    if category_id:
        cat = db.get(FixedAssetCategory, category_id)
        if cat is None:
            raise FixedAssetError("فئة الأصل غير موجودة.")
    method = method or (cat.method if cat else "straight_line")
    if method not in METHODS:
        raise FixedAssetError("طريقة الإهلاك غير صحيحة.")
    usage = usage or (cat.usage if cat else "admin")
    if usage not in USAGES:
        raise FixedAssetError("طبيعة استخدام الأصل غير صحيحة.")
    rate = Decimal(str(annual_rate)) if annual_rate not in (None, "") else None
    if rate is not None and (rate < ZERO or rate > Decimal(100)):
        raise FixedAssetError("نسبة الإهلاك من صفر إلى ١٠٠٪.")
    life = int(useful_life_months) if useful_life_months else None
    if cat is not None and not life and rate is None and method == cat.method:
        life = cat.useful_life_months
        rate = Decimal(str(cat.annual_rate)) if cat.annual_rate is not None else None
    if life is not None and life <= 0:
        raise FixedAssetError("يجب ألا يقل العمر الإنتاجي عن شهر واحد.")
    if method == "straight_line" and not life and rate:
        life = depreciation.life_from_rate(rate)
    if method != "none" and not life and not rate:
        raise FixedAssetError("حدد العمر الإنتاجي أو نسبة الإهلاك.")
    if method == "sum_of_years" and not life:
        raise FixedAssetError("طريقة مجموع أرقام السنين تحتاج العمر الإنتاجي.")
    if depreciation_start and depreciation_start < acquisition_date:
        raise FixedAssetError("بداية الإهلاك لا تسبق تاريخ الشراء.")

    bid = _asset_branch(db, branch_id, actor_user_id)
    if cat is not None:
        cat_asset, cat_accum = category_accounts(db, cat, bid)
    else:
        defaults = default_accounts(db)
        cat_asset, cat_accum = defaults["asset"], defaults["accumulated"]
    asset = FixedAsset(
        code=_code(db), name=str(name).strip(),
        category=(cat.name if cat else category), category_id=cat.id if cat else None,
        usage=usage, annual_rate=rate, opening_accumulated=opening,
        depreciation_start=depreciation_start, source_kind=source_kind, source_id=source_id,
        acquisition_date=acquisition_date, cost=money_cost, salvage_value=salvage,
        useful_life_months=life or 0, method=method, status=AssetStatus.active,
        asset_account_id=asset_account_id or cat_asset.id,
        accumulated_account_id=accumulated_account_id or cat_accum.id,
        expense_account_id=expense_account_id or expense_account(db, usage, bid).id,
        branch_id=bid, cost_center_id=cost_center_id, notes=notes,
        actor_user_id=actor_user_id,
    )
    db.add(asset)
    db.flush()
    audit_service.record(
        db, action="fixed_asset.create", actor_user_id=actor_user_id,
        entity_type="fixed_asset", entity_id=asset.id,
        after={"code": asset.code, "name": asset.name, "cost": str(money_cost),
               "source": f"{source_kind}:{source_id}" if source_kind else None},
    )
    return asset


def delete_asset(db: Session, *, asset_id: int, actor_user_id: int,
                 from_source: bool = False) -> None:
    asset = db.get(FixedAsset, asset_id)
    if asset is None:
        raise FixedAssetError("الأصل غير موجود.")
    if asset.source_kind and not from_source:
        raise FixedAssetError("الأصل مسجّل من مستند — احذف المستند أو اعكسه.")
    if db.scalar(select(DepreciationRecord.id).where(
            DepreciationRecord.asset_id == asset.id)) is not None:
        raise FixedAssetError(f"الأصل {asset.code} عليه إهلاك مرحّل — اعكس الإهلاك أولاً.")
    if asset.status == AssetStatus.disposed:
        raise FixedAssetError(f"الأصل {asset.code} مستبعد.")
    audit_service.record(
        db, action="fixed_asset.delete", actor_user_id=actor_user_id,
        entity_type="fixed_asset", entity_id=asset.id,
        before={"code": asset.code, "name": asset.name, "cost": str(asset.cost)},
    )
    db.delete(asset)
    db.flush()


def assets_of_source(db: Session, kind: str, source_id: int) -> list[FixedAsset]:
    return list(db.scalars(select(FixedAsset).where(
        FixedAsset.source_kind == kind, FixedAsset.source_id == source_id)
        .order_by(FixedAsset.id)).all())


def detach_source(db: Session, kind: str, source_id: int, actor_user_id: int) -> None:
    for asset in assets_of_source(db, kind, source_id):
        delete_asset(db, asset_id=asset.id, actor_user_id=actor_user_id, from_source=True)


def accumulated_of(db: Session, asset_id: int, *,
                   upto: tuple[int, int] | None = None) -> Decimal:
    stmt = select(func.coalesce(func.sum(DepreciationRecord.amount), 0)).where(
        DepreciationRecord.asset_id == asset_id)
    if upto is not None:
        y, m = upto
        stmt = stmt.where(
            DepreciationRecord.year * 100 + DepreciationRecord.month <= y * 100 + m)
    total = db.scalar(stmt)
    asset = db.get(FixedAsset, asset_id)
    opening = to_money(asset.opening_accumulated or 0) if asset is not None else ZERO
    return to_money(to_money(total or 0) + opening)


def book_value_of(db: Session, asset: FixedAsset) -> Decimal:
    return to_money(to_money(asset.cost) - accumulated_of(db, asset.id))


def _period_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _start_of(asset: FixedAsset) -> date:
    return asset.depreciation_start or asset.acquisition_date


def month_amount(db: Session, asset: FixedAsset, year: int, month: int,
                 accumulated: Decimal | None = None) -> Decimal:
    start = _start_of(asset)
    if (year, month) < (start.year, start.month):
        return ZERO
    return depreciation.monthly_amount(
        cost=to_money(asset.cost), salvage_value=to_money(asset.salvage_value),
        useful_life_months=asset.useful_life_months or None, method=asset.method,
        accumulated=accumulated if accumulated is not None else accumulated_of(db, asset.id),
        periods_elapsed=depreciation.months_between(asset.acquisition_date, year, month),
        annual_rate=asset.annual_rate,
    )


def run_depreciation(
    db: Session, *, year: int, month: int, actor_user_id: int,
) -> dict:
    if not 1 <= month <= 12:
        raise FixedAssetError("يجب أن يكون الشهر من 1 إلى 12.")
    period_end = _period_end(year, month)

    assets = db.scalars(
        select(FixedAsset).where(FixedAsset.status == AssetStatus.active)).all()
    already = {
        r.asset_id for r in db.scalars(
            select(DepreciationRecord).where(
                DepreciationRecord.year == year, DepreciationRecord.month == month,
            )
        ).all()
    }

    by_branch: dict[int | None, list[tuple[FixedAsset, Decimal]]] = {}
    skipped = 0
    for asset in assets:
        if asset.id in already:
            skipped += 1
            continue
        amount = month_amount(db, asset, year, month)
        if amount <= ZERO:
            continue
        by_branch.setdefault(asset.branch_id, []).append((asset, amount))

    total = ZERO
    count = 0
    entry_ids: list[int] = []
    label = f"إهلاك شهر {year}-{month:02d}"
    for branch_id, pending in by_branch.items():
        sums: dict[tuple[int, Direction, int | None], Decimal] = {}
        for asset, amount in pending:
            for acc_id, side in ((asset.expense_account_id, Direction.debit),
                                 (asset.accumulated_account_id, Direction.credit)):
                key = (acc_id, side, asset.cost_center_id)
                sums[key] = to_money(sums.get(key, ZERO) + amount)
        lines = [LineInput(acc_id, side, amount, statement=label, cost_center_id=cc)
                 for (acc_id, side, cc), amount in sums.items()]
        entry = ledger_service.post_entry(
            db, entry_type="depreciation", actor_user_id=actor_user_id, lines=lines,
            description=label, entry_date=period_end, branch_id=branch_id,
        )
        entry_ids.append(entry.id)
        for asset, amount in pending:
            db.add(DepreciationRecord(
                asset_id=asset.id, year=year, month=month, amount=amount,
                ledger_entry_id=entry.id, actor_user_id=actor_user_id,
            ))
            total = to_money(total + amount)
            count += 1
    db.flush()

    if count:
        audit_service.record(
            db, action="depreciation.run", actor_user_id=actor_user_id,
            entity_type="ledger_entry", entity_id=entry_ids[0],
            after={"period": f"{year}-{month:02d}", "assets": count, "total": str(total)},
        )
    return {"year": year, "month": month, "assets": count, "skipped": skipped,
            "total": str(total), "ledger_entry_id": entry_ids[0] if entry_ids else None,
            "ledger_entry_ids": entry_ids}


def reverse_depreciation(db: Session, *, year: int, month: int, actor_user_id: int) -> dict:
    records = db.scalars(
        select(DepreciationRecord).where(
            DepreciationRecord.year == year, DepreciationRecord.month == month,
        )
    ).all()
    if not records:
        raise FixedAssetError("لا يوجد إهلاك مرحّل لهذا الشهر.")

    entry_ids = {r.ledger_entry_id for r in records if r.ledger_entry_id}
    reversals = []
    for entry_id in entry_ids:
        reversals.append(ledger_service.reverse_entry(
            db, original_id=entry_id, actor_user_id=actor_user_id).id)
    for record in records:
        db.delete(record)
    db.flush()
    audit_service.record(
        db, action="depreciation.reverse", actor_user_id=actor_user_id,
        entity_type="ledger_entry", entity_id=next(iter(entry_ids), None),
        after={"period": f"{year}-{month:02d}", "records": len(records)},
    )
    return {"year": year, "month": month, "records": len(records),
            "reversal_entry_ids": reversals}


def dispose_asset(
    db: Session, *, asset_id: int, disposal_date: date, proceeds, actor_user_id: int,
    cash_account_id: int | None = None,
) -> FixedAsset:
    from src.services import account_resolver

    asset = db.get(FixedAsset, asset_id)
    if asset is None:
        raise FixedAssetError("الأصل غير موجود.")
    if asset.status == AssetStatus.disposed:
        raise FixedAssetError("الأصل مستبعد بالفعل.")

    amount = to_money(proceeds or 0)
    if amount < ZERO:
        raise FixedAssetError("قيمة البيع لا تكون بالسالب.")

    accumulated = accumulated_of(db, asset.id)
    cost = to_money(asset.cost)
    book_value = to_money(cost - accumulated)
    gain_loss = to_money(amount - book_value)

    cash = (db.get(Account, cash_account_id) if cash_account_id
            else account_resolver.treasury_account(db, branch_id=asset.branch_id))
    if cash is None:
        raise FixedAssetError("حساب النقدية غير موجود.")

    statement = f"استبعاد {asset.code} — {asset.name}"
    lines = [
        LineInput(asset.asset_account_id, Direction.credit, cost, statement=statement),
    ]
    if accumulated > ZERO:
        lines.append(LineInput(asset.accumulated_account_id, Direction.debit, accumulated,
                               statement=statement))
    if amount > ZERO:
        lines.append(LineInput(cash.id, Direction.debit, amount, statement=statement))
    if gain_loss > ZERO:
        gain = _get_or_create_account(db, "4.002", "أرباح بيع أصول ثابتة",
                                      AccountNature.income, Direction.credit, "4")
        lines.append(LineInput(gain.id, Direction.credit, gain_loss, statement=statement))
    elif gain_loss < ZERO:
        loss = _get_or_create_account(db, "5.004", "خسائر بيع أصول ثابتة",
                                      AccountNature.expense, Direction.debit, "5")
        lines.append(LineInput(loss.id, Direction.debit, -gain_loss, statement=statement))

    entry = ledger_service.post_entry(
        db, entry_type="asset_disposal", actor_user_id=actor_user_id, lines=lines,
        description=statement, entry_date=disposal_date, branch_id=asset.branch_id,
    )

    asset.status = AssetStatus.disposed
    asset.disposal_date = disposal_date
    asset.disposal_proceeds = amount
    asset.disposal_gain_loss = gain_loss
    asset.disposal_entry_id = entry.id
    db.flush()
    audit_service.record(
        db, action="fixed_asset.dispose", actor_user_id=actor_user_id,
        entity_type="fixed_asset", entity_id=asset.id,
        after={"code": asset.code, "proceeds": str(amount), "gain_loss": str(gain_loss)},
    )
    return asset


def list_assets(
    db: Session, *, status: str | None = None, category: str | None = None,
) -> list[FixedAsset]:
    stmt = select(FixedAsset)
    if status:
        stmt = stmt.where(FixedAsset.status == AssetStatus(status))
    if category:
        stmt = stmt.where(FixedAsset.category == category)
    return list(db.scalars(
        stmt.order_by(FixedAsset.acquisition_date.desc(), FixedAsset.id.desc())).all())


def get_asset(db: Session, asset_id: int) -> FixedAsset:
    asset = db.get(FixedAsset, asset_id)
    if asset is None:
        raise FixedAssetError("الأصل غير موجود.")
    return asset


def schedule_of(db: Session, asset_id: int) -> list[DepreciationRecord]:
    return list(db.scalars(
        select(DepreciationRecord)
        .where(DepreciationRecord.asset_id == asset_id)
        .order_by(DepreciationRecord.year.desc(), DepreciationRecord.month.desc())
    ).all())


def remaining_months(db: Session, asset: FixedAsset, ym: tuple[int, int],
                     accumulated: Decimal, monthly: Decimal) -> int | None:
    if asset.method == "none":
        return None
    left = to_money(to_money(asset.cost) - to_money(asset.salvage_value) - accumulated)
    if left <= ZERO:
        return 0
    if asset.method == "straight_line":
        depreciable = to_money(to_money(asset.cost) - to_money(asset.salvage_value))
        life = asset.useful_life_months or depreciation.life_from_rate(asset.annual_rate)
        if life and depreciable > ZERO:
            exact = (left * Decimal(life) / depreciable).quantize(Decimal("0.0001"))
            return int(exact.to_integral_value(rounding=ROUND_CEILING))
        if monthly > ZERO:
            return int((left / monthly).to_integral_value(rounding=ROUND_CEILING))
    if asset.useful_life_months:
        used = depreciation.months_between(asset.acquisition_date, *ym) + 1
        return max(asset.useful_life_months - used, 0)
    return None


def report(db: Session, *, as_of: date | None = None, branch_id: int | None = None,
           category_id: int | None = None, usage: str | None = None,
           include_disposed: bool = False) -> dict:
    as_of = as_of or date.today()
    ym = (as_of.year, as_of.month)
    stmt = select(FixedAsset).where(FixedAsset.acquisition_date <= as_of)
    if not include_disposed:
        stmt = stmt.where(FixedAsset.status == AssetStatus.active)
    if branch_id:
        stmt = stmt.where(FixedAsset.branch_id == branch_id)
    if category_id:
        stmt = stmt.where(FixedAsset.category_id == category_id)
    if usage:
        stmt = stmt.where(FixedAsset.usage == usage)
    rows = []
    totals = {"cost": ZERO, "accumulated": ZERO, "book_value": ZERO, "monthly": ZERO}
    ny, nm = (ym[0] + 1, 1) if ym[1] == 12 else (ym[0], ym[1] + 1)
    for a in db.scalars(stmt.order_by(FixedAsset.category, FixedAsset.code)).all():
        accumulated = accumulated_of(db, a.id, upto=ym)
        cost = to_money(a.cost)
        book = to_money(cost - accumulated)
        monthly = month_amount(db, a, ny, nm, accumulated)
        remaining = remaining_months(db, a, ym, accumulated, monthly)
        end = None
        if remaining is not None:
            months = ym[0] * 12 + ym[1] - 1 + remaining
            end = f"{months // 12}-{months % 12 + 1:02d}"
        rows.append({
            "id": a.id, "code": a.code, "name": a.name, "category": a.category,
            "category_id": a.category_id, "usage": a.usage, "branch_id": a.branch_id,
            "acquisition_date": a.acquisition_date.isoformat(), "method": a.method,
            "annual_rate": str(a.annual_rate) if a.annual_rate is not None else None,
            "useful_life_months": a.useful_life_months or None,
            "cost": str(cost), "salvage_value": str(to_money(a.salvage_value)),
            "accumulated": str(accumulated), "book_value": str(book),
            "monthly": str(monthly), "remaining_months": remaining, "end_month": end,
            "status": a.status.value,
        })
        totals["cost"] += cost
        totals["accumulated"] += accumulated
        totals["book_value"] += book
        totals["monthly"] += monthly
    return {"as_of": as_of.isoformat(), "rows": rows,
            "totals": {k: str(to_money(v)) for k, v in totals.items()}}
