"""Sales settings router (T044). FR-029. Fixed discount % at runtime; snapshot-on-invoice."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_SETTINGS_WRITE, CAP_STOCK_READ
from src.core.db import get_db
from src.models.sales import SalesSetting

router = APIRouter(tags=["settings"], prefix="/settings")


class SalesSettingsBody(BaseModel):
    fixed_discount_pct: Decimal


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
    return SalesSettingsBody(fixed_discount_pct=Decimal(s.fixed_discount_pct))


@router.put("/sales", response_model=SalesSettingsBody)
def update_sales_settings(
    body: SalesSettingsBody,
    current: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> SalesSettingsBody:
    s = _get_or_create(db)
    s.fixed_discount_pct = body.fixed_discount_pct
    s.updated_by = current.id
    db.flush()
    db.commit()
    return SalesSettingsBody(fixed_discount_pct=Decimal(s.fixed_discount_pct))
