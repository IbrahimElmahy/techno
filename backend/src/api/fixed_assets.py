"""الأصول الثابتة والإهلاك router (B6)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_ACCOUNTING_CHART_READ, CAP_ACCOUNTING_JOURNAL_POST
from src.core.db import get_db
from src.services import fixed_asset_service
from src.services.fixed_asset_service import FixedAssetError
from src.services.ledger_service import LedgerError

router = APIRouter(tags=["fixed-assets"], prefix="/fixed-assets")


class AssetIn(BaseModel):
    name: str
    acquisition_date: date
    cost: Decimal
    useful_life_months: int
    salvage_value: Decimal = Decimal("0")
    method: str = "straight_line"
    category: str | None = None
    notes: str | None = None
    branch_id: int | None = None
    cost_center_id: int | None = None
    asset_account_id: int | None = None
    accumulated_account_id: int | None = None
    expense_account_id: int | None = None


class AssetOut(BaseModel):
    id: int
    code: str
    name: str
    category: str | None
    acquisition_date: date
    cost: Decimal
    salvage_value: Decimal
    useful_life_months: int
    method: str
    status: str
    accumulated_depreciation: Decimal
    book_value: Decimal
    asset_account_id: int
    accumulated_account_id: int
    expense_account_id: int
    # Accepted on the way in since the feature shipped and never returned on the way out, so the
    # branch an asset belongs to could be recorded and never read. It is the fourth column on
    # their الاصول الثابتة list.
    branch_id: int | None = None
    cost_center_id: int | None = None
    disposal_date: date | None = None
    disposal_proceeds: Decimal | None = None
    gain_loss: Decimal | None = None
    notes: str | None = None


class RunIn(BaseModel):
    year: int
    month: int


class DisposeIn(BaseModel):
    disposal_date: date
    proceeds: Decimal = Decimal("0")
    cash_account_id: int | None = None


def _out(db: Session, a) -> AssetOut:
    accumulated = fixed_asset_service.accumulated_of(db, a.id)
    return AssetOut(
        id=a.id, code=a.code, name=a.name, category=a.category,
        acquisition_date=a.acquisition_date, cost=a.cost, salvage_value=a.salvage_value,
        useful_life_months=a.useful_life_months, method=a.method.value, status=a.status.value,
        accumulated_depreciation=accumulated,
        book_value=fixed_asset_service.book_value_of(db, a),
        branch_id=a.branch_id,
        asset_account_id=a.asset_account_id,
        accumulated_account_id=a.accumulated_account_id,
        expense_account_id=a.expense_account_id, cost_center_id=a.cost_center_id,
        disposal_date=a.disposal_date, disposal_proceeds=a.disposal_proceeds,
        gain_loss=a.disposal_gain_loss, notes=a.notes,
    )


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(
    body: AssetIn,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> AssetOut:
    """تسجيل أصل ثابت — cost, salvage, life and method, plus the three accounts it posts to."""
    try:
        asset = fixed_asset_service.create_asset(
            db, name=body.name, acquisition_date=body.acquisition_date, cost=body.cost,
            useful_life_months=body.useful_life_months, actor_user_id=current.id,
            salvage_value=body.salvage_value, method=body.method, category=body.category,
            notes=body.notes, branch_id=body.branch_id, cost_center_id=body.cost_center_id,
            asset_account_id=body.asset_account_id,
            accumulated_account_id=body.accumulated_account_id,
            expense_account_id=body.expense_account_id,
        )
    except FixedAssetError as exc:
        raise HTTPException(422, {"code": "asset_invalid", "message": str(exc)}) from exc
    out = _out(db, asset)
    db.commit()
    return out


@router.get("", response_model=list[AssetOut])
def list_assets(
    status_filter: str | None = Query(None, alias="status"),
    category: str | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[AssetOut]:
    try:
        rows = fixed_asset_service.list_assets(db, status=status_filter, category=category)
    except ValueError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    return [_out(db, a) for a in rows]


@router.post("/depreciation/run", response_model=dict, status_code=status.HTTP_201_CREATED)
def run_depreciation(
    body: RunIn,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """ترحيل إهلاك الشهر — safe to click twice: an asset already booked for the month is skipped."""
    try:
        result = fixed_asset_service.run_depreciation(
            db, year=body.year, month=body.month, actor_user_id=current.id)
    except FixedAssetError as exc:
        raise HTTPException(422, {"code": "run_invalid", "message": str(exc)}) from exc
    except LedgerError as exc:
        raise HTTPException(409, {"code": "ledger_invalid", "message": str(exc)}) from exc
    db.commit()
    return result


@router.post("/depreciation/reverse", response_model=dict, status_code=status.HTTP_201_CREATED)
def reverse_depreciation(
    body: RunIn,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> dict:
    """عكس إهلاك شهر — reverses the entry and frees the month to be run again."""
    try:
        result = fixed_asset_service.reverse_depreciation(
            db, year=body.year, month=body.month, actor_user_id=current.id)
    except FixedAssetError as exc:
        raise HTTPException(409, {"code": "run_invalid", "message": str(exc)}) from exc
    except LedgerError as exc:
        raise HTTPException(409, {"code": "ledger_invalid", "message": str(exc)}) from exc
    db.commit()
    return result


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(
    asset_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> AssetOut:
    try:
        return _out(db, fixed_asset_service.get_asset(db, asset_id))
    except FixedAssetError as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc


@router.get("/{asset_id}/schedule", response_model=list[dict])
def asset_schedule(
    asset_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """جدول الإهلاك — every month currently booked against this asset."""
    rows = fixed_asset_service.schedule_of(db, asset_id)
    return [{"year": r.year, "month": r.month, "amount": str(r.amount),
             "ledger_entry_id": r.ledger_entry_id} for r in rows]


@router.post("/{asset_id}/dispose", response_model=AssetOut)
def dispose_asset(
    asset_id: int,
    body: DisposeIn,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> AssetOut:
    """استبعاد أصل — clears cost and accumulated depreciation, books the gain or the loss."""
    try:
        asset = fixed_asset_service.dispose_asset(
            db, asset_id=asset_id, disposal_date=body.disposal_date, proceeds=body.proceeds,
            actor_user_id=current.id, cash_account_id=body.cash_account_id)
    except FixedAssetError as exc:
        raise HTTPException(422, {"code": "asset_invalid", "message": str(exc)}) from exc
    except LedgerError as exc:
        raise HTTPException(409, {"code": "ledger_invalid", "message": str(exc)}) from exc
    out = _out(db, asset)
    db.commit()
    return out
