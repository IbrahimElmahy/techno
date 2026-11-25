from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CATALOG_READ, CAP_PROFIT_VIEW
from src.core import clock
from src.core.db import get_db
from src.services import price_list_service

router = APIRouter(prefix="/price-list", tags=["price-list"])


def _allowed(current: CurrentUser, fields: list[str]) -> list[str]:
    if current.can(CAP_PROFIT_VIEW):
        return fields
    return [f for f in fields if f != "purchase_price"]


@router.get("", response_model=dict)
def price_list(
    as_of: date | None = Query(None),
    compare_to: date | None = Query(None),
    fields: str | None = Query(None),
    q: str | None = Query(None),
    category: str | None = Query(None),
    changed_only: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> dict:
    wanted = [f for f in (fields or "").split(",") if f] or list(price_list_service.FIELDS)
    wanted = _allowed(current, wanted) or ["sale_price"]
    out = price_list_service.price_list(
        db, as_of=as_of or clock.today(), compare_to=compare_to, fields=wanted, q=q,
        category=category, changed_only=changed_only)
    out["available"] = [{"key": k, "label": v}
                        for k, v in price_list_service.FIELDS.items()
                        if k in _allowed(current, list(price_list_service.FIELDS))]
    return out


@router.get("/items/{item_id}", response_model=dict)
def item_prices(
    item_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CATALOG_READ)),
    db: Session = Depends(get_db),
) -> dict:
    out = price_list_service.item_history(db, item_id)
    if not current.can(CAP_PROFIT_VIEW):
        out["changes"] = [c for c in out["changes"] if c["field"] != "purchase_price"]
        out["series"].pop("purchase_price", None)
        out["purchases"] = []
    return out
