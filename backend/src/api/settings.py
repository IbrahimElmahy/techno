from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_PURCHASE_WRITE, CAP_SETTINGS_WRITE, CAP_STOCK_READ
from src.lib import item_points
from src.models.catalog import Item
from src.core.db import get_db
from src.models.sales import SalesSetting
from src.models.stock import CostingMethod, StockSetting

router = APIRouter(tags=["settings"], prefix="/settings")


class SalesSettingsBody(BaseModel):
    fixed_discount_pct: Decimal
    vat_rate_pct: Decimal = Decimal("0")
    edit_lock_days: int | None = None


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
                             vat_rate_pct=Decimal(s.vat_rate_pct or 0),
                             edit_lock_days=getattr(s, "edit_lock_days", None))


@router.put("/sales", response_model=SalesSettingsBody)
def update_sales_settings(
    body: SalesSettingsBody,
    current: CurrentUser = Depends(require_capability(CAP_SETTINGS_WRITE)),
    db: Session = Depends(get_db),
) -> SalesSettingsBody:
    s = _get_or_create(db)
    if body.vat_rate_pct < 0 or body.vat_rate_pct > 100:
        raise HTTPException(422, {"code": "validation",
                                  "message": "يجب أن تكون نسبة الضريبة بين 0 و 100."})
    if body.edit_lock_days is not None and body.edit_lock_days < 0:
        raise HTTPException(422, {"code": "validation",
                                  "message": "لا يمكن أن يكون عدد أيام قفل التعديل بالسالب."})
    s.fixed_discount_pct = body.fixed_discount_pct
    s.vat_rate_pct = body.vat_rate_pct
    s.edit_lock_days = body.edit_lock_days or None
    s.updated_by = current.id
    db.flush()
    db.commit()
    return SalesSettingsBody(fixed_discount_pct=Decimal(s.fixed_discount_pct),
                             vat_rate_pct=Decimal(s.vat_rate_pct or 0),
                             edit_lock_days=getattr(s, "edit_lock_days", None))


_POLY = {item_points.PPR, item_points.PPR_INS}
_WHITE = {item_points.DRAIN}


class PurchaseDiscountsBody(BaseModel):
    poly_pct: Decimal
    white_pct: Decimal
    groups: dict[str, str] = {}


def _purchase_discounts(db: Session, s: SalesSetting) -> PurchaseDiscountsBody:
    groups: dict[str, str] = {}
    for cat in db.scalars(select(Item.category).where(Item.category.is_not(None)).distinct()):
        fam = item_points.family_of(cat)
        if fam in _POLY:
            groups[cat] = "poly"
        elif fam in _WHITE:
            groups[cat] = "white"
    return PurchaseDiscountsBody(
        poly_pct=Decimal(s.purchase_poly_discount_pct if s.purchase_poly_discount_pct is not None
                         else "52.5"),
        white_pct=Decimal(s.purchase_white_discount_pct
                          if s.purchase_white_discount_pct is not None else "34.5"),
        groups=groups)


@router.get("/purchase-discounts", response_model=PurchaseDiscountsBody)
def get_purchase_discounts(
    _: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> PurchaseDiscountsBody:
    s = _get_or_create(db)
    db.commit()
    return _purchase_discounts(db, s)


class PurchaseDiscountIn(BaseModel):
    group: str
    pct: Decimal


@router.put("/purchase-discounts", response_model=PurchaseDiscountsBody)
def set_purchase_discount(
    body: PurchaseDiscountIn,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> PurchaseDiscountsBody:
    if body.group not in ("poly", "white"):
        raise HTTPException(422, {"code": "validation", "message": "يجب أن يكون الخط بولي أو أبيض."})
    if body.pct < 0 or body.pct >= 100:
        raise HTTPException(422, {"code": "validation",
                                  "message": "يجب أن يكون الخصم من صفر إلى أقل من ١٠٠٪."})
    s = _get_or_create(db)
    if body.group == "poly":
        s.purchase_poly_discount_pct = body.pct
    else:
        s.purchase_white_discount_pct = body.pct
    s.updated_by = current.id
    db.commit()
    return _purchase_discounts(db, s)


class StockSettingsBody(BaseModel):
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
    try:
        method = CostingMethod(body.costing_method)
    except ValueError as exc:
        raise HTTPException(422, {
            "code": "validation",
            "message": "يجب أن تكون طريقة التكلفة «المتوسط المرجح» أو «آخر سعر شراء».",
        }) from exc
    s = _stock_settings(db)
    s.costing_method = method
    s.updated_by = current.id
    db.flush()
    db.commit()
    return StockSettingsBody(costing_method=s.costing_method.value)
