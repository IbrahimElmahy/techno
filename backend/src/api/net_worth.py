from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, get_current_user
from src.core import clock
from src.core.db import get_db
from src.services import net_worth_service

router = APIRouter(tags=["net-worth"])


def _gate(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not net_worth_service.can_view(current):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "هذا التقرير لمالك النظام فقط."})
    return current


@router.get("/reports/net-worth", response_model=dict)
def net_worth(
    as_of: date | None = Query(None),
    branch_id: int | None = Query(None),
    basis: str | None = Query(None),
    price_field: str | None = Query(None),
    period_from: date | None = Query(None),
    period_to: date | None = Query(None),
    discounts: str | None = Query(None),
    _: CurrentUser = Depends(_gate),
    db: Session = Depends(get_db),
) -> dict:
    day = as_of or clock.today()
    opts = net_worth_service.options(as_of=day, basis=basis, price_field=price_field,
                                     period_from=period_from, period_to=period_to,
                                     discounts=discounts)
    return net_worth_service.build(db, branch_id=branch_id, as_of=day, opts=opts)


@router.get("/reports/net-worth/inventory", response_model=dict)
def net_worth_inventory(
    as_of: date | None = Query(None),
    branch_id: int | None = Query(None),
    basis: str | None = Query(None),
    price_field: str | None = Query(None),
    period_from: date | None = Query(None),
    period_to: date | None = Query(None),
    discounts: str | None = Query(None),
    warehouse_id: int | None = Query(None),
    category: str | None = Query(None),
    _: CurrentUser = Depends(_gate),
    db: Session = Depends(get_db),
) -> dict:
    day = as_of or clock.today()
    opts = net_worth_service.options(as_of=day, basis=basis, price_field=price_field,
                                     period_from=period_from, period_to=period_to,
                                     discounts=discounts)
    return net_worth_service.inventory_detail(db, branch_id=branch_id, as_of=day, opts=opts,
                                              warehouse_id=warehouse_id, category=category)
