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
    useful_life_months: int | None = None
    salvage_value: Decimal = Decimal("0")
    method: str | None = None
    category: str | None = None
    category_id: int | None = None
    usage: str | None = None
    annual_rate: Decimal | None = None
    opening_accumulated: Decimal = Decimal("0")
    depreciation_start: date | None = None
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
    category_id: int | None = None
    usage: str = "admin"
    annual_rate: Decimal | None = None
    opening_accumulated: Decimal = Decimal("0")
    depreciation_start: date | None = None
    source_kind: str | None = None
    source_id: int | None = None
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
    branch_id: int | None = None
    cost_center_id: int | None = None
    disposal_date: date | None = None
    disposal_proceeds: Decimal | None = None
    gain_loss: Decimal | None = None
    notes: str | None = None


class CategoryIn(BaseModel):
    name: str
    method: str = "straight_line"
    annual_rate: Decimal | None = None
    useful_life_months: int | None = None
    usage: str = "admin"
    active: bool = True


class CategoryOut(BaseModel):
    id: int
    name: str
    method: str
    annual_rate: Decimal | None = None
    useful_life_months: int | None = None
    usage: str
    active: bool


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
        id=a.id, code=a.code, name=a.name, category=a.category, category_id=a.category_id,
        usage=a.usage or "admin", annual_rate=a.annual_rate,
        opening_accumulated=a.opening_accumulated or 0,
        depreciation_start=a.depreciation_start, source_kind=a.source_kind,
        source_id=a.source_id,
        acquisition_date=a.acquisition_date, cost=a.cost, salvage_value=a.salvage_value,
        useful_life_months=a.useful_life_months or 0, method=str(a.method),
        status=a.status.value,
        accumulated_depreciation=accumulated,
        book_value=fixed_asset_service.book_value_of(db, a),
        branch_id=a.branch_id,
        asset_account_id=a.asset_account_id,
        accumulated_account_id=a.accumulated_account_id,
        expense_account_id=a.expense_account_id, cost_center_id=a.cost_center_id,
        disposal_date=a.disposal_date, disposal_proceeds=a.disposal_proceeds,
        gain_loss=a.disposal_gain_loss, notes=a.notes,
    )


def _cat_out(c) -> CategoryOut:
    return CategoryOut(id=c.id, name=c.name, method=c.method, annual_rate=c.annual_rate,
                       useful_life_months=c.useful_life_months, usage=c.usage,
                       active=bool(c.active))


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[CategoryOut]:
    rows = fixed_asset_service.list_categories(db)
    out = [_cat_out(c) for c in rows]
    db.commit()
    return out


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    body: CategoryIn,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> CategoryOut:
    try:
        cat = fixed_asset_service.save_category(db, category_id=None, **body.model_dump())
    except FixedAssetError as exc:
        raise HTTPException(422, {"code": "category_invalid", "message": str(exc)}) from exc
    out = _cat_out(cat)
    db.commit()
    return out


@router.put("/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    body: CategoryIn,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> CategoryOut:
    try:
        cat = fixed_asset_service.save_category(db, category_id=category_id,
                                                **body.model_dump())
    except FixedAssetError as exc:
        raise HTTPException(422, {"code": "category_invalid", "message": str(exc)}) from exc
    out = _cat_out(cat)
    db.commit()
    return out


@router.get("/report", response_model=dict)
def assets_report(
    as_of: date | None = Query(None),
    branch_id: int | None = Query(None),
    category_id: int | None = Query(None),
    usage: str | None = Query(None),
    include_disposed: bool = Query(False),
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> dict:
    return fixed_asset_service.report(
        db, as_of=as_of, branch_id=branch_id, category_id=category_id, usage=usage,
        include_disposed=include_disposed)


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(
    body: AssetIn,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> AssetOut:
    try:
        asset = fixed_asset_service.create_asset(
            db, actor_user_id=current.id, **body.model_dump())
    except FixedAssetError as exc:
        raise HTTPException(422, {"code": "asset_invalid", "message": str(exc)}) from exc
    out = _out(db, asset)
    db.commit()
    return out


@router.get("", response_model=list[AssetOut])
def list_assets(
    status_filter: str | None = Query(None, alias="status"),
    category: str | None = Query(None),
    source_kind: str | None = Query(None),
    source_id: int | None = Query(None),
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[AssetOut]:
    try:
        if source_kind and source_id:
            rows = fixed_asset_service.assets_of_source(db, source_kind, source_id)
        else:
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


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: int,
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST)),
    db: Session = Depends(get_db),
) -> None:
    try:
        fixed_asset_service.delete_asset(db, asset_id=asset_id, actor_user_id=current.id)
    except FixedAssetError as exc:
        raise HTTPException(409, {"code": "asset_locked", "message": str(exc)}) from exc
    db.commit()


@router.get("/{asset_id}/schedule", response_model=list[dict])
def asset_schedule(
    asset_id: int,
    _: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
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
