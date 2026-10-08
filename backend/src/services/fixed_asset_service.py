from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services.numbering import next_document_number
from src.core.money import ZERO, to_money
from src.lib import depreciation
from src.models.fixed_asset import (
    AssetStatus,
    DepreciationMethod,
    DepreciationRecord,
    FixedAsset,
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


class FixedAssetError(Exception):
    pass


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


def _code(db: Session) -> str:
    return next_document_number(db, FixedAsset, "FA", column=FixedAsset.code, width=5)


def create_asset(
    db: Session, *, name: str, acquisition_date: date, cost, useful_life_months: int,
    actor_user_id: int, salvage_value=0, method: str = "straight_line",
    category: str | None = None, notes: str | None = None, branch_id: int | None = None,
    cost_center_id: int | None = None, asset_account_id: int | None = None,
    accumulated_account_id: int | None = None, expense_account_id: int | None = None,
) -> FixedAsset:
    if not name or not str(name).strip():
        raise FixedAssetError("اسم الأصل مطلوب.")
    money_cost = to_money(cost)
    salvage = to_money(salvage_value or 0)
    if money_cost <= ZERO:
        raise FixedAssetError("يجب أن تكون تكلفة الأصل أكبر من صفر.")
    if salvage < ZERO:
        raise FixedAssetError("القيمة التخريدية لا تكون بالسالب.")
    if salvage > money_cost:
        raise FixedAssetError("القيمة التخريدية لا تزيد عن التكلفة.")
    if useful_life_months <= 0:
        raise FixedAssetError("يجب ألا يقل العمر الإنتاجي عن شهر واحد.")
    try:
        chosen = DepreciationMethod(method)
    except ValueError as exc:
        raise FixedAssetError("طريقة الإهلاك غير صحيحة.") from exc

    defaults = default_accounts(db)
    asset = FixedAsset(
        code=_code(db), name=str(name).strip(), category=category,
        acquisition_date=acquisition_date, cost=money_cost, salvage_value=salvage,
        useful_life_months=useful_life_months, method=chosen, status=AssetStatus.active,
        asset_account_id=asset_account_id or defaults["asset"].id,
        accumulated_account_id=accumulated_account_id or defaults["accumulated"].id,
        expense_account_id=expense_account_id or defaults["expense"].id,
        branch_id=branch_id, cost_center_id=cost_center_id, notes=notes,
        actor_user_id=actor_user_id,
    )
    db.add(asset)
    db.flush()
    audit_service.record(
        db, action="fixed_asset.create", actor_user_id=actor_user_id,
        entity_type="fixed_asset", entity_id=asset.id,
        after={"code": asset.code, "name": asset.name, "cost": str(money_cost)},
    )
    return asset


def accumulated_of(db: Session, asset_id: int) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(DepreciationRecord.amount), 0)).where(
            DepreciationRecord.asset_id == asset_id,
        )
    )
    return to_money(total or 0)


def book_value_of(db: Session, asset: FixedAsset) -> Decimal:
    return to_money(to_money(asset.cost) - accumulated_of(db, asset.id))


def _period_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


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

    lines: list[LineInput] = []
    pending: list[tuple[FixedAsset, Decimal]] = []
    skipped = 0
    for asset in assets:
        if asset.id in already:
            skipped += 1
            continue
        if asset.acquisition_date > period_end:
            continue
        amount = depreciation.monthly_amount(
            cost=to_money(asset.cost), salvage_value=to_money(asset.salvage_value),
            useful_life_months=asset.useful_life_months, method=asset.method.value,
            accumulated=accumulated_of(db, asset.id),
            periods_elapsed=depreciation.months_between(asset.acquisition_date, year, month),
        )
        if amount <= ZERO:
            continue
        pending.append((asset, amount))
        statement = f"إهلاك {asset.code} — {asset.name} ({year}-{month:02d})"
        lines.append(LineInput(asset.expense_account_id, Direction.debit, amount,
                               statement=statement, cost_center_id=asset.cost_center_id))
        lines.append(LineInput(asset.accumulated_account_id, Direction.credit, amount,
                               statement=statement, cost_center_id=asset.cost_center_id))

    entry = None
    if lines:
        entry = ledger_service.post_entry(
            db, entry_type="depreciation", actor_user_id=actor_user_id, lines=lines,
            description=f"إهلاك شهر {year}-{month:02d}", entry_date=period_end,
        )

    total = ZERO
    for asset, amount in pending:
        db.add(DepreciationRecord(
            asset_id=asset.id, year=year, month=month, amount=amount,
            ledger_entry_id=entry.id if entry else None, actor_user_id=actor_user_id,
        ))
        total = to_money(total + amount)
    db.flush()

    if pending:
        audit_service.record(
            db, action="depreciation.run", actor_user_id=actor_user_id,
            entity_type="ledger_entry", entity_id=entry.id if entry else None,
            after={"period": f"{year}-{month:02d}", "assets": len(pending),
                   "total": str(total)},
        )
    return {"year": year, "month": month, "assets": len(pending), "skipped": skipped,
            "total": str(total), "ledger_entry_id": entry.id if entry else None}


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
        raise FixedAssetError("الأصل متصرّف فيه بالفعل.")

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
    return list(db.scalars(stmt.order_by(FixedAsset.acquisition_date.desc(), FixedAsset.id.desc())).all())


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
