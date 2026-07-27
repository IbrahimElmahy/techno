"""Sales settings router (T044). FR-029. Fixed discount % at runtime; snapshot-on-invoice."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SETTINGS_WRITE, CAP_STOCK_READ
from src.core.db import get_db
from src.models.sales import SalesSetting
from src.models.stock import CostingMethod, StockSetting

router = APIRouter(tags=["settings"], prefix="/settings")


class SalesSettingsBody(BaseModel):
    fixed_discount_pct: Decimal
    # VAT % (021). 0 = off, which keeps invoice posting exactly as it was before VAT existed.
    vat_rate_pct: Decimal = Decimal("0")


def _get_or_create(db: Session) -> SalesSetting:
    s = db.scalar(select(SalesSetting))
    if s is None:
        s = SalesSetting(fixed_discount_pct=Decimal("0"))
        db.add(s)
        db.flush()
    return s


@router.get("/sales", response_model=SalesSettingsBody)
def get_sales_settings(
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> SalesSettingsBody:
    s = _get_or_create(db)
    db.commit()
    return SalesSettingsBody(fixed_discount_pct=Decimal(s.fixed_discount_pct),
                             vat_rate_pct=Decimal(s.vat_rate_pct or 0))


@router.put("/sales", response_model=SalesSettingsBody)
def update_sales_settings(
    body: SalesSettingsBody,
    current: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> SalesSettingsBody:
    s = _get_or_create(db)
    if body.vat_rate_pct < 0 or body.vat_rate_pct > 100:
        raise HTTPException(422, {"code": "validation",
                                  "message": "نسبة الضريبة لازم تكون بين 0 و 100."})
    s.fixed_discount_pct = body.fixed_discount_pct
    s.vat_rate_pct = body.vat_rate_pct
    s.updated_by = current.id
    db.flush()
    db.commit()
    return SalesSettingsBody(fixed_discount_pct=Decimal(s.fixed_discount_pct),
                             vat_rate_pct=Decimal(s.vat_rate_pct or 0))


class StockSettingsBody(BaseModel):
    """نوع التكلفة — how a unit of stock is valued when a new cost is derived."""

    costing_method: str = CostingMethod.average.value


def _stock_settings(db: Session) -> StockSetting:
    s = db.scalar(select(StockSetting))
    if s is None:
        s = StockSetting(costing_method=CostingMethod.average)
        db.add(s)
        db.flush()
    return s


@router.get("/stock", response_model=StockSettingsBody)
def get_stock_settings(
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> StockSettingsBody:
    s = _stock_settings(db)
    db.commit()
    return StockSettingsBody(costing_method=s.costing_method.value)


@router.put("/stock", response_model=StockSettingsBody)
def update_stock_settings(
    body: StockSettingsBody,
    current: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> StockSettingsBody:
    """Changing the method changes how NEW costs are derived; costs already frozen onto past
    documents stay exactly as they were — that is the whole reason they were frozen."""
    try:
        method = CostingMethod(body.costing_method)
    except ValueError as exc:
        raise HTTPException(422, {
            "code": "validation",
            "message": "طريقة التكلفة لازم تكون «المتوسط المرجح» أو «آخر سعر شراء».",
        }) from exc
    s = _stock_settings(db)
    s.costing_method = method
    s.updated_by = current.id
    db.flush()
    db.commit()
    return StockSettingsBody(costing_method=s.costing_method.value)
