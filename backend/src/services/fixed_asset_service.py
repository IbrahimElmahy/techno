from __future__ import annotations

import calendar
import json
from datetime import date
from decimal import Decimal

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
    FixedAssetEvent,
)
from src.models.ledger import Account, AccountNature, Direction, LedgerEntry
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
STATES = ("draft", "running", "paused", "closed")
USAGE_EXPENSE = {"production": "مصروف إهلاك صناعي", "admin": "مصروف إهلاك إداري"}
IMPAIRMENT_ACCOUNT = "خسائر هبوط قيمة الأصول"
EVENT_LABELS = {
    "create": "إنشاء الأصل", "confirm": "تأكيد الأصل", "draft": "إرجاع إلى مسودة",
    "pause": "إيقاف الإهلاك", "resume": "استئناف الإهلاك", "modify": "تعديل الإهلاك",
    "increase": "زيادة القيمة", "decrease": "تخفيض القيمة", "dispose": "بيع أو استبعاد",
    "edit": "تعديل البيانات",
}
_HORIZON = 720

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
                                  useful_life_months=life, usage=usage, active=True,
                                  prorata=False, auto_confirm=True))
    db.flush()
    return list(db.scalars(select(FixedAssetCategory).order_by(FixedAssetCategory.id)).all())


def list_categories(db: Session) -> list[FixedAssetCategory]:
    return ensure_categories(db)


def category_counts(db: Session) -> dict[int, int]:
    return dict(db.execute(select(FixedAsset.category_id, func.count(FixedAsset.id))
                           .group_by(FixedAsset.category_id)).all())


def save_category(db: Session, *, category_id: int | None, name: str, method: str,
                  annual_rate=None, useful_life_months: int | None = None,
                  usage: str = "admin", active: bool = True, prorata: bool = False,
                  auto_confirm: bool = True) -> FixedAssetCategory:
    name = " ".join(str(name or "").split())
    if not name:
        raise FixedAssetError("اسم الفئة مطلوب.")
    if method not in METHODS:
        raise FixedAssetError("طريقة الإهلاك غير صحيحة.")
    if usage not in USAGES:
        raise FixedAssetError("طبيعة الاستخدام غير صحيحة.")
    rate = Decimal(str(annual_rate)) if annual_rate not in (None, "") else None
    life = int(useful_life_months) if useful_life_months else None
    if method != "none" and not rate and not life:
        raise FixedAssetError("حدد النسبة السنوية أو العمر الإنتاجي.")
    clash = db.scalar(select(FixedAssetCategory).where(FixedAssetCategory.name == name))
    if clash is not None and clash.id != category_id:
        raise FixedAssetError("توجد فئة بنفس الاسم.")
    cat = db.get(FixedAssetCategory, category_id) if category_id else FixedAssetCategory()
    if cat is None:
        raise FixedAssetError("الفئة غير موجودة.")
    cat.name = name
    cat.method = method
    cat.annual_rate = rate
    cat.useful_life_months = life
    cat.usage = usage
    cat.active = bool(active)
    cat.prorata = bool(prorata)
    cat.auto_confirm = bool(auto_confirm)
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


def impairment_account(db: Session, branch_id: int | None) -> Account:
    group = _group(db, branch_id, "A5M-48")
    if group is None:
        return _get_or_create_account(db, "5.005", IMPAIRMENT_ACCOUNT, AccountNature.expense,
                                      Direction.debit, "5")
    return _child(db, group, [IMPAIRMENT_ACCOUNT])


def _asset_branch(db: Session, branch_id: int | None, actor_user_id: int) -> int:
    from src.auth.branch_scope import branch_for
    from src.services import org_service

    return org_service.resolve_branch_id(
        db, branch_id or branch_for(db, actor_user_id=actor_user_id))


def _code(db: Session) -> str:
    return next_document_number(db, FixedAsset, "FA", column=FixedAsset.code, width=5)


def _event(db: Session, asset: FixedAsset, kind: str, actor_user_id: int, *,
           event_date: date | None = None, amount=None, details: dict | str | None = None,
           ledger_entry_id: int | None = None) -> FixedAssetEvent:
    text = details if isinstance(details, str) or details is None else json.dumps(
        details, ensure_ascii=False, default=str)
    ev = FixedAssetEvent(asset_id=asset.id, kind=kind, event_date=event_date or date.today(),
                         amount=to_money(amount) if amount is not None else None,
                         details=(text or None) and text[:1000],
                         ledger_entry_id=ledger_entry_id, actor_user_id=actor_user_id)
    db.add(ev)
    db.flush()
    return ev


def _validate_method(method: str, rate, life: int | None) -> tuple[Decimal | None, int | None]:
    if method not in METHODS:
        raise FixedAssetError("طريقة الإهلاك غير صحيحة.")
    rate = Decimal(str(rate)) if rate not in (None, "") else None
    if rate is not None and (rate < ZERO or rate > Decimal(100)):
        raise FixedAssetError("نسبة الإهلاك من صفر إلى ١٠٠٪.")
    life = int(life) if life else None
    if life is not None and life <= 0:
        raise FixedAssetError("يجب ألا يقل العمر الإنتاجي عن شهر واحد.")
    if method in ("straight_line", "declining_then_linear") and not life and rate:
        life = depreciation.life_from_rate(rate)
    if method != "none" and not life and not rate:
        raise FixedAssetError("حدد العمر الإنتاجي أو نسبة الإهلاك.")
    if method in ("sum_of_years", "declining_then_linear") and not life:
        raise FixedAssetError("هذه الطريقة تحتاج العمر الإنتاجي.")
    return rate, life


def _start_of(asset: FixedAsset) -> date:
    return asset.depreciation_start or asset.acquisition_date


def _rebase(asset: FixedAsset, accumulated: Decimal, remaining_months: int | None) -> None:
    if asset.method == "none":
        asset.base_value = None
        asset.base_months = None
        return
    left = to_money(to_money(asset.cost) - to_money(asset.salvage_value) - accumulated)
    asset.base_value = left if left > ZERO else ZERO
    asset.base_months = max(int(remaining_months or 1), 1)


def _initial_remaining(asset: FixedAsset) -> int | None:
    life = asset.useful_life_months or depreciation.life_from_rate(asset.annual_rate)
    if not life:
        return None
    start = _start_of(asset)
    used = depreciation.months_between(asset.acquisition_date, start.year, start.month)
    return max(life - max(used, 0), 1)


def create_asset(
    db: Session, *, name: str, acquisition_date: date, cost, actor_user_id: int,
    useful_life_months: int | None = None, salvage_value=0, method: str | None = None,
    category: str | None = None, notes: str | None = None, branch_id: int | None = None,
    cost_center_id: int | None = None, asset_account_id: int | None = None,
    accumulated_account_id: int | None = None, expense_account_id: int | None = None,
    category_id: int | None = None, usage: str | None = None, annual_rate=None,
    opening_accumulated=0, depreciation_start: date | None = None,
    source_kind: str | None = None, source_id: int | None = None,
    prorata: bool | None = None, state: str | None = None,
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
        raise FixedAssetError("الإهلاك السابق لا يكون بالسالب.")
    if opening > to_money(money_cost - salvage):
        raise FixedAssetError("الإهلاك السابق لا يزيد عن القيمة القابلة للإهلاك.")

    cat = None
    if category_id:
        cat = db.get(FixedAssetCategory, category_id)
        if cat is None:
            raise FixedAssetError("فئة الأصل غير موجودة.")
    method = method or (cat.method if cat else "straight_line")
    usage = usage or (cat.usage if cat else "admin")
    if usage not in USAGES:
        raise FixedAssetError("طبيعة استخدام الأصل غير صحيحة.")
    if (cat is not None and not useful_life_months and annual_rate in (None, "")
            and method == cat.method):
        useful_life_months = cat.useful_life_months
        annual_rate = cat.annual_rate
    rate, life = _validate_method(method, annual_rate, useful_life_months)
    if depreciation_start and depreciation_start < acquisition_date:
        raise FixedAssetError("بداية الإهلاك لا تسبق تاريخ الشراء.")
    if state is None:
        if source_kind:
            state = "running" if (cat is None or cat.auto_confirm) else "draft"
        else:
            state = "draft"
    if state not in ("draft", "running"):
        raise FixedAssetError("حالة الأصل غير صحيحة.")

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
        state=state, prorata=bool(prorata if prorata is not None else (cat.prorata if cat else False)),
        asset_account_id=asset_account_id or cat_asset.id,
        accumulated_account_id=accumulated_account_id or cat_accum.id,
        expense_account_id=expense_account_id or expense_account(db, usage, bid).id,
        branch_id=bid, cost_center_id=cost_center_id, notes=notes,
        actor_user_id=actor_user_id,
    )
    _rebase(asset, opening, _initial_remaining(asset))
    db.add(asset)
    db.flush()
    _event(db, asset, "create", actor_user_id, event_date=acquisition_date, amount=money_cost,
           details={"source": source_kind, "state": state})
    audit_service.record(
        db, action="fixed_asset.create", actor_user_id=actor_user_id,
        entity_type="fixed_asset", entity_id=asset.id,
        after={"code": asset.code, "name": asset.name, "cost": str(money_cost),
               "source": f"{source_kind}:{source_id}" if source_kind else None},
    )
    return asset


def get_asset(db: Session, asset_id: int) -> FixedAsset:
    asset = db.get(FixedAsset, asset_id)
    if asset is None:
        raise FixedAssetError("الأصل غير موجود.")
    return asset


def _posted(db: Session, asset_id: int) -> list[DepreciationRecord]:
    return list(db.scalars(select(DepreciationRecord).where(
        DepreciationRecord.asset_id == asset_id)
        .order_by(DepreciationRecord.year, DepreciationRecord.month)).all())


def _has_entries(db: Session, asset: FixedAsset) -> bool:
    if db.scalar(select(DepreciationRecord.id).where(
            DepreciationRecord.asset_id == asset.id)) is not None:
        return True
    return db.scalar(select(FixedAssetEvent.id).where(
        FixedAssetEvent.asset_id == asset.id,
        FixedAssetEvent.ledger_entry_id.is_not(None))) is not None


def update_asset(db: Session, *, asset_id: int, actor_user_id: int, **fields) -> FixedAsset:
    asset = get_asset(db, asset_id)
    if asset.state == "closed":
        raise FixedAssetError("الأصل مغلق ولا يمكن تعديله.")
    before = {"name": asset.name, "usage": asset.usage, "notes": asset.notes}
    if fields.get("name") is not None:
        if not str(fields["name"]).strip():
            raise FixedAssetError("اسم الأصل مطلوب.")
        asset.name = str(fields["name"]).strip()
    if "notes" in fields:
        asset.notes = fields.get("notes") or None
    if "cost_center_id" in fields:
        asset.cost_center_id = fields.get("cost_center_id")
    if fields.get("usage") and fields["usage"] != asset.usage:
        if fields["usage"] not in USAGES:
            raise FixedAssetError("طبيعة الاستخدام غير صحيحة.")
        asset.usage = fields["usage"]
        asset.expense_account_id = expense_account(db, asset.usage, asset.branch_id).id

    if asset.state == "draft":
        if fields.get("category_id") and fields["category_id"] != asset.category_id:
            cat = db.get(FixedAssetCategory, fields["category_id"])
            if cat is None:
                raise FixedAssetError("فئة الأصل غير موجودة.")
            asset.category_id = cat.id
            asset.category = cat.name
            acc, accum = category_accounts(db, cat, asset.branch_id)
            asset.asset_account_id = acc.id
            asset.accumulated_account_id = accum.id
        if fields.get("branch_id") and fields["branch_id"] != asset.branch_id:
            if asset.source_kind:
                raise FixedAssetError("فرع الأصل من مستند الشراء ولا يتغير.")
            asset.branch_id = fields["branch_id"]
            cat = db.get(FixedAssetCategory, asset.category_id) if asset.category_id else None
            if cat is not None:
                acc, accum = category_accounts(db, cat, asset.branch_id)
                asset.asset_account_id = acc.id
                asset.accumulated_account_id = accum.id
            asset.expense_account_id = expense_account(db, asset.usage, asset.branch_id).id
        if not asset.source_kind:
            if fields.get("cost") is not None:
                c = to_money(fields["cost"])
                if c <= ZERO:
                    raise FixedAssetError("يجب أن تكون تكلفة الأصل أكبر من صفر.")
                asset.cost = c
            if fields.get("acquisition_date"):
                asset.acquisition_date = fields["acquisition_date"]
        if "salvage_value" in fields and fields["salvage_value"] is not None:
            asset.salvage_value = to_money(fields["salvage_value"])
        if "opening_accumulated" in fields and fields["opening_accumulated"] is not None:
            asset.opening_accumulated = to_money(fields["opening_accumulated"])
        if "depreciation_start" in fields:
            asset.depreciation_start = fields.get("depreciation_start")
        if "prorata" in fields and fields["prorata"] is not None:
            asset.prorata = bool(fields["prorata"])
        method = fields.get("method") or asset.method
        rate_in = fields["annual_rate"] if "annual_rate" in fields else asset.annual_rate
        life_in = (fields["useful_life_months"] if "useful_life_months" in fields
                   else asset.useful_life_months)
        rate, life = _validate_method(method, rate_in, life_in)
        asset.method, asset.annual_rate, asset.useful_life_months = method, rate, life or 0
        if to_money(asset.salvage_value) > to_money(asset.cost):
            raise FixedAssetError("القيمة التخريدية لا تزيد عن التكلفة.")
        if to_money(asset.opening_accumulated) > to_money(asset.cost) - to_money(asset.salvage_value):
            raise FixedAssetError("الإهلاك السابق لا يزيد عن القيمة القابلة للإهلاك.")
        if asset.depreciation_start and asset.depreciation_start < asset.acquisition_date:
            raise FixedAssetError("بداية الإهلاك لا تسبق تاريخ الشراء.")
        _rebase(asset, to_money(asset.opening_accumulated), _initial_remaining(asset))
    db.flush()
    _event(db, asset, "edit", actor_user_id, details={
        "before": before, "after": {"name": asset.name, "usage": asset.usage,
                                    "notes": asset.notes}})
    return asset


def confirm_asset(db: Session, *, asset_id: int, actor_user_id: int) -> FixedAsset:
    asset = get_asset(db, asset_id)
    if asset.state != "draft":
        raise FixedAssetError("الأصل ليس مسودة.")
    _validate_method(asset.method, asset.annual_rate, asset.useful_life_months or None)
    asset.state = "running"
    db.flush()
    _event(db, asset, "confirm", actor_user_id)
    return asset


def set_draft(db: Session, *, asset_id: int, actor_user_id: int) -> FixedAsset:
    asset = get_asset(db, asset_id)
    if asset.state not in ("running", "paused"):
        raise FixedAssetError("لا يمكن إرجاع هذا الأصل إلى مسودة.")
    if _has_entries(db, asset):
        raise FixedAssetError("على الأصل قيود مرحّلة — اعكسها أولاً.")
    asset.state = "draft"
    db.flush()
    _event(db, asset, "draft", actor_user_id)
    return asset


def pause_asset(db: Session, *, asset_id: int, actor_user_id: int, reason: str | None = None,
                ) -> FixedAsset:
    asset = get_asset(db, asset_id)
    if asset.state != "running":
        raise FixedAssetError("الأصل ليس قيد التشغيل.")
    asset.state = "paused"
    db.flush()
    _event(db, asset, "pause", actor_user_id, details=reason)
    return asset


def resume_asset(db: Session, *, asset_id: int, actor_user_id: int) -> FixedAsset:
    asset = get_asset(db, asset_id)
    if asset.state != "paused":
        raise FixedAssetError("الأصل ليس موقوفاً.")
    asset.state = "running"
    db.flush()
    _event(db, asset, "resume", actor_user_id)
    return asset


def delete_asset(db: Session, *, asset_id: int, actor_user_id: int,
                 from_source: bool = False) -> None:
    asset = get_asset(db, asset_id)
    if asset.source_kind and not from_source:
        raise FixedAssetError("الأصل مسجّل من مستند — احذف المستند أو اعكسه.")
    if not from_source and asset.state != "draft":
        raise FixedAssetError("الحذف للأصول المسودة فقط — أرجع الأصل إلى مسودة أولاً.")
    if _has_entries(db, asset):
        raise FixedAssetError(f"الأصل {asset.code} عليه قيود مرحّلة — اعكسها أولاً.")
    if asset.status == AssetStatus.disposed:
        raise FixedAssetError(f"الأصل {asset.code} مستبعد.")
    audit_service.record(
        db, action="fixed_asset.delete", actor_user_id=actor_user_id,
        entity_type="fixed_asset", entity_id=asset.id,
        before={"code": asset.code, "name": asset.name, "cost": str(asset.cost)},
    )
    for ev in db.scalars(select(FixedAssetEvent).where(FixedAssetEvent.asset_id == asset.id)):
        db.delete(ev)
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
    ev = select(func.coalesce(func.sum(FixedAssetEvent.amount), 0)).where(
        FixedAssetEvent.asset_id == asset_id, FixedAssetEvent.kind == "decrease")
    if upto is not None:
        y, m = upto
        stmt = stmt.where(
            DepreciationRecord.year * 100 + DepreciationRecord.month <= y * 100 + m)
        ev = ev.where(FixedAssetEvent.event_date <= _period_end(y, m))
    total = to_money(db.scalar(stmt) or 0) + to_money(db.scalar(ev) or 0)
    asset = db.get(FixedAsset, asset_id)
    opening = to_money(asset.opening_accumulated or 0) if asset is not None else ZERO
    return to_money(total + opening)


def book_value_of(db: Session, asset: FixedAsset) -> Decimal:
    return to_money(to_money(asset.cost) - accumulated_of(db, asset.id))


def _period_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def month_amount(db: Session, asset: FixedAsset, year: int, month: int,
                 accumulated: Decimal | None = None) -> Decimal:
    start = _start_of(asset)
    if (year, month) < (start.year, start.month):
        return ZERO
    since = depreciation.months_between(start, year, month)
    fraction = depreciation.first_month_fraction(start) if (
        asset.prorata and since == 0 and start.day > 1) else None
    return depreciation.monthly_amount(
        cost=to_money(asset.cost), salvage_value=to_money(asset.salvage_value),
        useful_life_months=asset.useful_life_months or None, method=asset.method,
        accumulated=accumulated if accumulated is not None else accumulated_of(db, asset.id),
        periods_elapsed=depreciation.months_between(asset.acquisition_date, year, month),
        annual_rate=asset.annual_rate, base_value=asset.base_value,
        base_months=asset.base_months, since_start=since, fraction=fraction,
    )


def _next_period(db: Session, asset: FixedAsset) -> tuple[int, int]:
    last = db.execute(select(DepreciationRecord.year, DepreciationRecord.month).where(
        DepreciationRecord.asset_id == asset.id)
        .order_by(DepreciationRecord.year.desc(), DepreciationRecord.month.desc())
        .limit(1)).first()
    start = _start_of(asset)
    if last is None:
        return start.year, start.month
    nxt = depreciation.add_months(last[0], last[1], 1)
    return max(nxt, (start.year, start.month))


def board(db: Session, asset: FixedAsset) -> dict:
    today = date.today()
    current = (today.year, today.month)
    cost = to_money(asset.cost)
    posted = _posted(db, asset.id)
    entry_ids = [r.ledger_entry_id for r in posted if r.ledger_entry_id]
    numbers = dict(db.execute(select(LedgerEntry.id, LedgerEntry.number).where(
        LedgerEntry.id.in_(entry_ids))).all()) if entry_ids else {}
    decreases = list(db.scalars(select(FixedAssetEvent).where(
        FixedAssetEvent.asset_id == asset.id, FixedAssetEvent.kind == "decrease")).all())
    rows = []
    dep_sum = ZERO
    for r in posted:
        dep_sum = to_money(dep_sum + to_money(r.amount))
        end = _period_end(r.year, r.month)
        dec = sum((to_money(e.amount) for e in decreases if e.event_date <= end), ZERO)
        acc = to_money(to_money(asset.opening_accumulated or 0) + dep_sum + dec)
        rows.append({"period": f"{r.year}-{r.month:02d}", "amount": str(to_money(r.amount)),
                     "accumulated": str(acc), "book_value": str(to_money(cost - acc)),
                     "state": "posted", "ledger_entry_id": r.ledger_entry_id,
                     "entry_number": numbers.get(r.ledger_entry_id)})
    planned_total = ZERO
    if asset.state in ("running", "paused", "draft") and asset.method != "none":
        y, m = _next_period(db, asset)
        acc = accumulated_of(db, asset.id)
        for _ in range(_HORIZON):
            amount = month_amount(db, asset, y, m, acc)
            if amount <= ZERO:
                break
            acc = to_money(acc + amount)
            planned_total = to_money(planned_total + amount)
            rows.append({"period": f"{y}-{m:02d}", "amount": str(amount),
                         "accumulated": str(acc), "book_value": str(to_money(cost - acc)),
                         "state": "due" if (y, m) <= current else "planned",
                         "ledger_entry_id": None, "entry_number": None})
            y, m = depreciation.add_months(y, m, 1)
    planned = [r for r in rows if r["state"] != "posted"]
    return {
        "rows": rows,
        "posted_total": str(dep_sum),
        "planned_total": str(planned_total),
        "due_count": sum(1 for r in rows if r["state"] == "due"),
        "remaining_months": len(planned),
        "end_period": planned[-1]["period"] if planned else (
            rows[-1]["period"] if rows else None),
    }


def _pending(db: Session, year: int, month: int, asset_ids: list[int] | None = None,
             ) -> dict[int, list[tuple[tuple[int, int], Decimal]]]:
    stmt = select(FixedAsset).where(FixedAsset.state == "running",
                                    FixedAsset.status == AssetStatus.active)
    if asset_ids:
        stmt = stmt.where(FixedAsset.id.in_(asset_ids))
    out: dict[int, list] = {}
    for asset in db.scalars(stmt).all():
        if asset.method == "none":
            continue
        y, m = _next_period(db, asset)
        acc = accumulated_of(db, asset.id)
        items = []
        guard = 0
        while (y, m) <= (year, month) and guard < _HORIZON:
            guard += 1
            amount = month_amount(db, asset, y, m, acc)
            if amount > ZERO:
                items.append(((y, m), amount))
                acc = to_money(acc + amount)
            elif acc >= to_money(asset.cost) - to_money(asset.salvage_value):
                break
            y, m = depreciation.add_months(y, m, 1)
        if items:
            out[asset.id] = items
    return out


def preview(db: Session, *, year: int, month: int) -> dict:
    pending = _pending(db, year, month)
    assets = {a.id: a for a in db.scalars(select(FixedAsset).where(
        FixedAsset.id.in_(list(pending)))).all()} if pending else {}
    rows = []
    total = ZERO
    for aid, items in pending.items():
        a = assets[aid]
        amount = to_money(sum((x[1] for x in items), ZERO))
        total = to_money(total + amount)
        rows.append({"id": a.id, "code": a.code, "name": a.name, "category": a.category,
                     "usage": a.usage, "branch_id": a.branch_id, "months": len(items),
                     "first": f"{items[0][0][0]}-{items[0][0][1]:02d}",
                     "last": f"{items[-1][0][0]}-{items[-1][0][1]:02d}",
                     "amount": str(amount)})
    rows.sort(key=lambda r: (r["category"] or "", r["code"]))
    return {"rows": rows, "total": str(total), "assets": len(rows),
            "months": sum(r["months"] for r in rows)}


def _post_period(db: Session, year: int, month: int,
                 items: list[tuple[FixedAsset, Decimal]], actor_user_id: int) -> list[int]:
    by_branch: dict[int | None, list[tuple[FixedAsset, Decimal]]] = {}
    for asset, amount in items:
        by_branch.setdefault(asset.branch_id, []).append((asset, amount))
    label = f"إهلاك شهر {year}-{month:02d}"
    entry_ids = []
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
            description=label, entry_date=_period_end(year, month), branch_id=branch_id,
        )
        entry_ids.append(entry.id)
        for asset, amount in pending:
            db.add(DepreciationRecord(
                asset_id=asset.id, year=year, month=month, amount=amount,
                ledger_entry_id=entry.id, actor_user_id=actor_user_id,
            ))
    db.flush()
    return entry_ids


def run_depreciation(db: Session, *, year: int, month: int, actor_user_id: int,
                     asset_ids: list[int] | None = None) -> dict:
    if not 1 <= month <= 12:
        raise FixedAssetError("يجب أن يكون الشهر من 1 إلى 12.")
    pending = _pending(db, year, month, asset_ids)
    assets = {a.id: a for a in db.scalars(select(FixedAsset).where(
        FixedAsset.id.in_(list(pending)))).all()} if pending else {}
    periods: dict[tuple[int, int], list[tuple[FixedAsset, Decimal]]] = {}
    for aid, items in pending.items():
        for period, amount in items:
            periods.setdefault(period, []).append((assets[aid], amount))
    entry_ids: list[int] = []
    total = ZERO
    count = 0
    for period in sorted(periods):
        entry_ids += _post_period(db, period[0], period[1], periods[period], actor_user_id)
        for _, amount in periods[period]:
            total = to_money(total + amount)
            count += 1
    if count:
        audit_service.record(
            db, action="depreciation.run", actor_user_id=actor_user_id,
            entity_type="ledger_entry", entity_id=entry_ids[0],
            after={"through": f"{year}-{month:02d}", "lines": count, "total": str(total)},
        )
    return {"year": year, "month": month, "assets": len(pending), "lines": count,
            "periods": len(periods), "total": str(total),
            "ledger_entry_id": entry_ids[0] if entry_ids else None,
            "ledger_entry_ids": entry_ids}


def reverse_depreciation(db: Session, *, year: int, month: int, actor_user_id: int) -> dict:
    records = db.scalars(
        select(DepreciationRecord).where(
            DepreciationRecord.year == year, DepreciationRecord.month == month,
        )
    ).all()
    if not records:
        raise FixedAssetError("لا يوجد إهلاك مرحّل لهذا الشهر.")
    ids = [r.asset_id for r in records]
    later = db.scalar(select(func.count(DepreciationRecord.id)).where(
        DepreciationRecord.asset_id.in_(ids),
        DepreciationRecord.year * 100 + DepreciationRecord.month > year * 100 + month))
    if later:
        raise FixedAssetError("توجد شهور أحدث مرحّلة لنفس الأصول — اعكسها أولاً.")
    closed = db.scalar(select(FixedAsset.code).where(
        FixedAsset.id.in_(ids), FixedAsset.state == "closed"))
    if closed:
        raise FixedAssetError(f"الأصل {closed} مغلق — لا يمكن عكس إهلاكه.")

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


def _require_active(asset: FixedAsset) -> None:
    if asset.state not in ("running", "paused"):
        raise FixedAssetError("هذا الإجراء للأصول قيد التشغيل أو الموقوفة فقط.")


def _remaining_from_next(db: Session, asset: FixedAsset) -> tuple[tuple[int, int], int | None]:
    nxt = _next_period(db, asset)
    if asset.base_months:
        start = _start_of(asset)
        used = depreciation.months_between(start, *nxt)
        return nxt, max(asset.base_months - max(used, 0), 1)
    life = asset.useful_life_months or depreciation.life_from_rate(asset.annual_rate)
    if not life:
        return nxt, None
    used = depreciation.months_between(asset.acquisition_date, *nxt)
    return nxt, max(life - max(used, 0), 1)


def modify_depreciation(db: Session, *, asset_id: int, actor_user_id: int, method: str,
                        remaining_months: int | None, annual_rate=None, salvage_value=None,
                        reason: str | None = None) -> FixedAsset:
    asset = get_asset(db, asset_id)
    _require_active(asset)
    if not reason or not str(reason).strip():
        raise FixedAssetError("اكتب سبب التعديل.")
    rate, _ = _validate_method(method, annual_rate, remaining_months or None)
    if method in ("straight_line", "declining_then_linear", "sum_of_years") and not remaining_months:
        raise FixedAssetError("حدد عدد الشهور الباقية.")
    before = {"method": asset.method, "annual_rate": asset.annual_rate,
              "useful_life_months": asset.useful_life_months,
              "salvage_value": asset.salvage_value}
    accumulated = accumulated_of(db, asset.id)
    if salvage_value is not None:
        salvage = to_money(salvage_value)
        if salvage < ZERO or salvage > to_money(to_money(asset.cost) - accumulated):
            raise FixedAssetError("القيمة التخريدية لا تزيد عن القيمة الدفترية.")
        asset.salvage_value = salvage
    nxt, _ = _remaining_from_next(db, asset)
    asset.method = method
    asset.annual_rate = rate if method in ("declining_balance", "declining_then_linear") else None
    asset.depreciation_start = max(date(nxt[0], nxt[1], 1), asset.acquisition_date)
    if remaining_months:
        asset.useful_life_months = depreciation.months_between(
            asset.acquisition_date, *nxt) + int(remaining_months)
    asset.prorata = False
    _rebase(asset, accumulated, remaining_months)
    db.flush()
    _event(db, asset, "modify", actor_user_id, details={
        "reason": reason, "before": before,
        "after": {"method": method, "annual_rate": rate, "remaining_months": remaining_months,
                  "salvage_value": asset.salvage_value}})
    return asset


def revalue(db: Session, *, asset_id: int, actor_user_id: int, kind: str, amount,
            event_date: date, reason: str | None = None,
            counter_account_id: int | None = None) -> FixedAsset:
    asset = get_asset(db, asset_id)
    _require_active(asset)
    value = to_money(amount)
    if value <= ZERO:
        raise FixedAssetError("المبلغ يجب أن يكون أكبر من صفر.")
    if not reason or not str(reason).strip():
        raise FixedAssetError("اكتب سبب التعديل.")
    accumulated = accumulated_of(db, asset.id)
    nxt, left_months = _remaining_from_next(db, asset)
    statement = f"{'زيادة' if kind == 'increase' else 'تخفيض'} قيمة {asset.code} — {asset.name}"
    if kind == "increase":
        counter = db.get(Account, counter_account_id) if counter_account_id else None
        if counter is None or not counter.active or not counter.is_postable:
            raise FixedAssetError("اختر الحساب المقابل للزيادة.")
        lines = [LineInput(asset.asset_account_id, Direction.debit, value, statement=statement),
                 LineInput(counter.id, Direction.credit, value, statement=statement)]
    elif kind == "decrease":
        book = to_money(to_money(asset.cost) - accumulated - to_money(asset.salvage_value))
        if value > book:
            raise FixedAssetError(f"التخفيض أكبر من القيمة القابلة للإهلاك ({book}).")
        loss = impairment_account(db, asset.branch_id)
        lines = [LineInput(loss.id, Direction.debit, value, statement=statement,
                           cost_center_id=asset.cost_center_id),
                 LineInput(asset.accumulated_account_id, Direction.credit, value,
                           statement=statement)]
    else:
        raise FixedAssetError("نوع التعديل غير صحيح.")
    entry = ledger_service.post_entry(
        db, entry_type="asset_revaluation", actor_user_id=actor_user_id, lines=lines,
        description=statement, entry_date=event_date, branch_id=asset.branch_id,
    )
    if kind == "increase":
        asset.cost = to_money(to_money(asset.cost) + value)
    _event(db, asset, kind, actor_user_id, event_date=event_date, amount=value,
           details=reason, ledger_entry_id=entry.id)
    accumulated = accumulated_of(db, asset.id)
    asset.depreciation_start = max(date(nxt[0], nxt[1], 1), asset.acquisition_date)
    asset.prorata = False
    _rebase(asset, accumulated, left_months)
    db.flush()
    return asset


def dispose_asset(
    db: Session, *, asset_id: int, disposal_date: date, proceeds, actor_user_id: int,
    cash_account_id: int | None = None, reason: str | None = None,
) -> FixedAsset:
    from src.services import account_resolver

    asset = get_asset(db, asset_id)
    if asset.status == AssetStatus.disposed or asset.state == "closed":
        raise FixedAssetError("الأصل مستبعد بالفعل.")
    if asset.state == "draft":
        raise FixedAssetError("أكّد الأصل أولاً.")

    amount = to_money(proceeds or 0)
    if amount < ZERO:
        raise FixedAssetError("قيمة البيع لا تكون بالسالب.")

    accumulated = accumulated_of(db, asset.id)
    cost = to_money(asset.cost)
    book_value = to_money(cost - accumulated)
    gain_loss = to_money(amount - book_value)

    cash = None
    if amount > ZERO:
        cash = (db.get(Account, cash_account_id) if cash_account_id
                else account_resolver.treasury_account(db, branch_id=asset.branch_id))
        if cash is None:
            raise FixedAssetError("حساب النقدية غير موجود.")

    statement = f"{'بيع' if amount > ZERO else 'استبعاد'} {asset.code} — {asset.name}"
    lines = [
        LineInput(asset.asset_account_id, Direction.credit, cost, statement=statement),
    ]
    if accumulated > ZERO:
        lines.append(LineInput(asset.accumulated_account_id, Direction.debit, accumulated,
                               statement=statement))
    if cash is not None:
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
    asset.state = "closed"
    asset.disposal_date = disposal_date
    asset.disposal_proceeds = amount
    asset.disposal_gain_loss = gain_loss
    asset.disposal_entry_id = entry.id
    db.flush()
    _event(db, asset, "dispose", actor_user_id, event_date=disposal_date, amount=amount,
           details={"reason": reason, "book_value": book_value, "gain_loss": gain_loss},
           ledger_entry_id=entry.id)
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


def accumulated_map(db: Session, ids: list[int]) -> dict[int, Decimal]:
    if not ids:
        return {}
    dep = dict(db.execute(select(DepreciationRecord.asset_id,
                                 func.coalesce(func.sum(DepreciationRecord.amount), 0))
                          .where(DepreciationRecord.asset_id.in_(ids))
                          .group_by(DepreciationRecord.asset_id)).all())
    dec = dict(db.execute(select(FixedAssetEvent.asset_id,
                                 func.coalesce(func.sum(FixedAssetEvent.amount), 0))
                          .where(FixedAssetEvent.asset_id.in_(ids),
                                 FixedAssetEvent.kind == "decrease")
                          .group_by(FixedAssetEvent.asset_id)).all())
    opening = dict(db.execute(select(FixedAsset.id, FixedAsset.opening_accumulated)
                              .where(FixedAsset.id.in_(ids))).all())
    return {i: to_money(to_money(dep.get(i, 0)) + to_money(dec.get(i, 0))
                        + to_money(opening.get(i) or 0)) for i in ids}


def schedule_of(db: Session, asset_id: int) -> list[DepreciationRecord]:
    return list(db.scalars(
        select(DepreciationRecord)
        .where(DepreciationRecord.asset_id == asset_id)
        .order_by(DepreciationRecord.year.desc(), DepreciationRecord.month.desc())
    ).all())


def events_of(db: Session, asset_id: int) -> list[dict]:
    from src.models.user import User

    rows = db.scalars(select(FixedAssetEvent).where(FixedAssetEvent.asset_id == asset_id)
                      .order_by(FixedAssetEvent.created_at.desc(),
                                FixedAssetEvent.id.desc())).all()
    users = dict(db.execute(select(User.id, User.full_name).where(
        User.id.in_({r.actor_user_id for r in rows}))).all()) if rows else {}
    out = []
    for r in rows:
        details = r.details
        try:
            parsed = json.loads(details) if details else None
        except ValueError:
            parsed = details
        out.append({"id": r.id, "kind": r.kind, "label": EVENT_LABELS.get(r.kind, r.kind),
                    "date": r.event_date.isoformat(),
                    "amount": str(r.amount) if r.amount is not None else None,
                    "details": parsed, "ledger_entry_id": r.ledger_entry_id,
                    "user": users.get(r.actor_user_id),
                    "created_at": r.created_at.isoformat() if r.created_at else None})
    return out


def entries_of(db: Session, asset: FixedAsset) -> list[dict]:
    items: list[tuple[int, str]] = []
    if asset.source_kind == "purchase":
        from src.models.purchasing import PurchaseInvoice

        inv = db.get(PurchaseInvoice, asset.source_id)
        if inv is not None and inv.ledger_entry_id:
            items.append((inv.ledger_entry_id, f"فاتورة شراء {inv.document_number}"))
    elif asset.source_kind == "voucher":
        from src.models.voucher import Voucher

        v = db.get(Voucher, asset.source_id)
        if v is not None and v.ledger_entry_id:
            items.append((v.ledger_entry_id, f"سند مصروف {v.document_number}"))
    for r in _posted(db, asset.id):
        if r.ledger_entry_id:
            items.append((r.ledger_entry_id, f"إهلاك {r.year}-{r.month:02d}"))
    for ev in db.scalars(select(FixedAssetEvent).where(
            FixedAssetEvent.asset_id == asset.id,
            FixedAssetEvent.ledger_entry_id.is_not(None))).all():
        items.append((ev.ledger_entry_id, EVENT_LABELS.get(ev.kind, ev.kind)))
    seen = set()
    ids = [i for i, _ in items]
    meta = {e.id: e for e in db.scalars(select(LedgerEntry).where(
        LedgerEntry.id.in_(ids))).all()} if ids else {}
    out = []
    for eid, label in items:
        if eid in seen:
            continue
        seen.add(eid)
        e = meta.get(eid)
        out.append({"entry_id": eid, "label": label,
                    "number": e.number if e else None,
                    "date": e.entry_date.isoformat() if e and e.entry_date else None,
                    "description": e.description if e else None})
    out.sort(key=lambda r: (r["date"] or "", r["entry_id"]))
    return out


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
    ny, nm = depreciation.add_months(ym[0], ym[1], 1)
    for a in db.scalars(stmt.order_by(FixedAsset.category, FixedAsset.code)).all():
        accumulated = accumulated_of(db, a.id, upto=ym)
        cost = to_money(a.cost)
        book = to_money(cost - accumulated)
        monthly = month_amount(db, a, ny, nm, accumulated) if a.state == "running" else ZERO
        b = board(db, a)
        rows.append({
            "id": a.id, "code": a.code, "name": a.name, "category": a.category,
            "category_id": a.category_id, "usage": a.usage, "branch_id": a.branch_id,
            "acquisition_date": a.acquisition_date.isoformat(), "method": a.method,
            "state": a.state,
            "annual_rate": str(a.annual_rate) if a.annual_rate is not None else None,
            "useful_life_months": a.useful_life_months or None,
            "cost": str(cost), "salvage_value": str(to_money(a.salvage_value)),
            "accumulated": str(accumulated), "book_value": str(book),
            "monthly": str(monthly), "remaining_months": b["remaining_months"],
            "end_month": b["end_period"], "status": a.status.value,
        })
        totals["cost"] += cost
        totals["accumulated"] += accumulated
        totals["book_value"] += book
        totals["monthly"] += monthly
    return {"as_of": as_of.isoformat(), "rows": rows,
            "totals": {k: str(to_money(v)) for k, v in totals.items()}}


def schedule_report(db: Session, *, date_from: date, date_to: date,
                    branch_id: int | None = None, category_id: int | None = None) -> dict:
    if date_from > date_to:
        raise FixedAssetError("تاريخ البداية بعد تاريخ النهاية.")
    stmt = select(FixedAsset).where(FixedAsset.acquisition_date <= date_to,
                                    FixedAsset.state != "draft")
    if branch_id:
        stmt = stmt.where(FixedAsset.branch_id == branch_id)
    if category_id:
        stmt = stmt.where(FixedAsset.category_id == category_id)
    assets = [a for a in db.scalars(stmt.order_by(FixedAsset.category, FixedAsset.code)).all()
              if not (a.disposal_date and a.disposal_date < date_from)]
    ids = [a.id for a in assets]
    f_key = date_from.year * 100 + date_from.month
    t_key = date_to.year * 100 + date_to.month
    dep: dict[int, dict[str, Decimal]] = {}
    for aid, y, m, amt in db.execute(select(
            DepreciationRecord.asset_id, DepreciationRecord.year, DepreciationRecord.month,
            DepreciationRecord.amount).where(DepreciationRecord.asset_id.in_(ids))).all() \
            if ids else []:
        k = y * 100 + m
        bucket = dep.setdefault(aid, {"before": ZERO, "within": ZERO})
        if k < f_key:
            bucket["before"] += to_money(amt)
        elif k <= t_key:
            bucket["within"] += to_money(amt)
    evs: dict[int, list[FixedAssetEvent]] = {}
    for ev in db.scalars(select(FixedAssetEvent).where(
            FixedAssetEvent.asset_id.in_(ids),
            FixedAssetEvent.kind.in_(("increase", "decrease")))).all() if ids else []:
        evs.setdefault(ev.asset_id, []).append(ev)

    keys = ("cost_open", "cost_add", "cost_out", "cost_close",
            "dep_open", "dep_add", "dep_out", "dep_close", "book")
    rows = []
    groups: dict[str, dict] = {}
    for a in assets:
        inc_all = sum((to_money(e.amount) for e in evs.get(a.id, []) if e.kind == "increase"),
                      ZERO)
        inc_before = sum((to_money(e.amount) for e in evs.get(a.id, [])
                          if e.kind == "increase" and e.event_date < date_from), ZERO)
        inc_within = sum((to_money(e.amount) for e in evs.get(a.id, [])
                          if e.kind == "increase" and date_from <= e.event_date <= date_to), ZERO)
        dec_before = sum((to_money(e.amount) for e in evs.get(a.id, [])
                          if e.kind == "decrease" and e.event_date < date_from), ZERO)
        dec_within = sum((to_money(e.amount) for e in evs.get(a.id, [])
                          if e.kind == "decrease" and date_from <= e.event_date <= date_to), ZERO)
        original = to_money(to_money(a.cost) - inc_all)
        acquired_before = a.acquisition_date < date_from
        cost_open = to_money(original + inc_before) if acquired_before else ZERO
        cost_add = to_money((ZERO if acquired_before else original) + inc_within)
        d = dep.get(a.id, {"before": ZERO, "within": ZERO})
        opening = to_money(a.opening_accumulated or 0)
        dep_open = to_money(d["before"] + dec_before + (opening if acquired_before else ZERO))
        dep_add = to_money(d["within"] + dec_within + (ZERO if acquired_before else opening))
        disposed = a.disposal_date is not None and date_from <= a.disposal_date <= date_to
        cost_out = to_money(cost_open + cost_add) if disposed else ZERO
        dep_out = to_money(dep_open + dep_add) if disposed else ZERO
        row = {"id": a.id, "code": a.code, "name": a.name, "category": a.category or "بدون فئة",
               "acquisition_date": a.acquisition_date.isoformat(), "state": a.state,
               "method": a.method,
               "cost_open": cost_open, "cost_add": cost_add, "cost_out": cost_out,
               "cost_close": to_money(cost_open + cost_add - cost_out),
               "dep_open": dep_open, "dep_add": dep_add, "dep_out": dep_out,
               "dep_close": to_money(dep_open + dep_add - dep_out)}
        row["book"] = to_money(row["cost_close"] - row["dep_close"])
        rows.append(row)
        g = groups.setdefault(row["category"], {k: ZERO for k in keys})
        for k in keys:
            g[k] = to_money(g[k] + row[k])
    totals = {k: to_money(sum((g[k] for g in groups.values()), ZERO)) for k in keys}

    def s(d: dict) -> dict:
        return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in d.items()}

    return {"date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
            "rows": [s(r) for r in rows],
            "groups": [{"category": k, **s(v)} for k, v in groups.items()],
            "totals": s(totals)}
