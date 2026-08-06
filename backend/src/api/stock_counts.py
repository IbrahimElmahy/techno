"""جرد المخازن / جرد عام — 031-a5-restructure."""
from __future__ import annotations

from datetime import date
from typing import Literal
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_STOCK_READ, CAP_PURCHASE_WRITE
from src.core.db import get_db
from src.models.catalog import Item
from src.models.stock_count import StockCount
from src.models.warehouse import Warehouse
from src.models.stock_count import StockCountKind
from src.services import stock_count_service
from src.services.stock_count_service import StockCountError
from src.services.stock_service import StockError

router = APIRouter(tags=["stock-counts"], prefix="/stock-counts")


class OpenIn(BaseModel):
    # Omit for «جرد عام المخازن» — every active warehouse in one sheet.
    warehouse_id: int | None = None
    count_date: date | None = None
    item_ids: list[int] | None = None
    notes: str | None = Field(default=None, max_length=500)
    # (031) نوع الجرد. The three differ in one thing only — which items land on the sheet — so this
    # is the whole difference between them at the API.
    kind: Literal["full", "cycle", "spot"] = "full"
    # For a cycle count: how many lines this batch carries. Defaulted in the service.
    batch_size: int | None = Field(default=None, ge=1, le=500)


class CountIn(BaseModel):
    line_id: int
    # None clears a value back to «not counted», which is not the same as zero.
    counted_quantity: Decimal | None = None


class EnterIn(BaseModel):
    counts: list[CountIn]


class LineOut(BaseModel):
    id: int
    item_id: int
    item_name: str | None
    warehouse_id: int
    warehouse_name: str | None
    book_quantity: Decimal
    counted_quantity: Decimal | None
    difference: Decimal | None
    stock_movement_id: int | None
    # (031) الصنف بيتجرد في فئة، والفرق ليه قيمة بالفلوس.
    #
    # «ناقص ٣ قطع» and «ناقص ٤٥٠ ج.م» are not the same information, and the second is the one a
    # manager acts on: three missing screws and three missing pumps read identically without it.
    category: str | None = None
    unit_cost: Decimal | None = None


class CountOut(BaseModel):
    id: int
    document_number: str
    warehouse_id: int | None
    warehouse_name: str | None
    count_date: str
    status: str
    # Returned as well as stored: «ليه الصنف ده مش في الجردة؟» is answerable from the kind, and a
    # cycle count mistaken for a failed full count is how people stop trusting the numbers.
    kind: str = "full"
    notes: str | None
    created_at: str
    posted_at: str | None
    line_count: int
    counted_count: int
    lines: list[LineOut] | None = None


def _names(db: Session):
    """Names, categories and costs for every item, in one pass.

    Costs come from `costing_service` — the same average the sale freezes onto a line — so a
    difference is valued the way the rest of the system values stock. Read once for the whole
    sheet: a count runs to hundreds of lines, and a cost query per line turns opening it into a
    wait.
    """
    from src.services import costing_service

    all_items = db.scalars(select(Item)).all()
    return (
        {i.id: i.name for i in all_items},
        {w.id: w.name for w in db.scalars(select(Warehouse)).all()},
        {i.id: i.category for i in all_items},
        {i.id: costing_service.average_cost(db, i.id) for i in all_items},
    )


def _out(sheet: StockCount, items, warehouses, categories=None, costs=None,
         *, with_lines: bool) -> CountOut:
    lines = None
    if with_lines:
        lines = [
            LineOut(
                id=ln.id, item_id=ln.item_id, item_name=items.get(ln.item_id),
                warehouse_id=ln.warehouse_id, warehouse_name=warehouses.get(ln.warehouse_id),
                book_quantity=ln.book_quantity, counted_quantity=ln.counted_quantity,
                # Derived, never stored: a stored difference goes stale the moment either side
                # of it is edited.
                difference=(None if ln.counted_quantity is None
                            else Decimal(str(ln.counted_quantity))
                            - Decimal(str(ln.book_quantity))),
                stock_movement_id=ln.stock_movement_id,
                category=(categories or {}).get(ln.item_id),
                unit_cost=(costs or {}).get(ln.item_id),
            )
            for ln in sheet.lines
        ]
    return CountOut(
        id=sheet.id, document_number=sheet.document_number, warehouse_id=sheet.warehouse_id,
        warehouse_name=(warehouses.get(sheet.warehouse_id) if sheet.warehouse_id else None),
        count_date=str(sheet.count_date), status=sheet.status.value, notes=sheet.notes,
        kind=(sheet.kind.value if getattr(sheet, "kind", None) else "full"),
        created_at=str(sheet.created_at),
        posted_at=str(sheet.posted_at) if sheet.posted_at else None,
        line_count=len(sheet.lines),
        counted_count=sum(1 for ln in sheet.lines if ln.counted_quantity is not None),
        lines=lines,
    )


@router.get("", response_model=list[CountOut])
def list_counts(
    status_filter: str | None = None,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> list[CountOut]:
    items, warehouses, categories, costs = _names(db)
    return [_out(s, items, warehouses, categories, costs, with_lines=False)
            for s in stock_count_service.listing(db, status=status_filter)]


@router.get("/{count_id}", response_model=CountOut)
def get_count(
    count_id: int,
    _: CurrentUser = Depends(require_capability(CAP_STOCK_READ)),
    db: Session = Depends(get_db),
) -> CountOut:
    sheet = stock_count_service.get(db, count_id)
    if sheet is None:
        raise HTTPException(404, {"code": "not_found", "message": "الجرد غير موجود"})
    items, warehouses, categories, costs = _names(db)
    return _out(sheet, items, warehouses, categories, costs, with_lines=True)


@router.post("", response_model=CountOut, status_code=status.HTTP_201_CREATED)
def open_count(
    body: OpenIn,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> CountOut:
    try:
        sheet = stock_count_service.open_sheet(
            db, warehouse_id=body.warehouse_id, count_date=body.count_date,
            actor_user_id=current.id, item_ids=body.item_ids, notes=body.notes,
            kind=StockCountKind(body.kind), batch_size=body.batch_size)
    except StockCountError as exc:
        raise HTTPException(409, {"code": "count_invalid", "message": str(exc)}) from exc
    db.commit()
    items, warehouses, categories, costs = _names(db)
    return _out(sheet, items, warehouses, categories, costs, with_lines=True)


@router.put("/{count_id}/counts", response_model=CountOut)
def enter_counts(
    count_id: int,
    body: EnterIn,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> CountOut:
    try:
        sheet = stock_count_service.enter_counts(
            db, count_id=count_id,
            counts={c.line_id: c.counted_quantity for c in body.counts},
            actor_user_id=current.id)
    except StockCountError as exc:
        raise HTTPException(409, {"code": "count_invalid", "message": str(exc)}) from exc
    db.commit()
    items, warehouses, categories, costs = _names(db)
    return _out(sheet, items, warehouses, categories, costs, with_lines=True)


@router.post("/{count_id}/post", response_model=CountOut)
def post_count(
    count_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> CountOut:
    try:
        sheet = stock_count_service.post(db, count_id=count_id, actor_user_id=current.id)
    except (StockCountError, StockError) as exc:
        raise HTTPException(409, {"code": "count_invalid", "message": str(exc)}) from exc
    db.commit()
    items, warehouses, categories, costs = _names(db)
    return _out(sheet, items, warehouses, categories, costs, with_lines=True)


@router.post("/{count_id}/cancel", response_model=CountOut)
def cancel_count(
    count_id: int,
    current: CurrentUser = Depends(require_capability(CAP_PURCHASE_WRITE)),
    db: Session = Depends(get_db),
) -> CountOut:
    try:
        sheet = stock_count_service.cancel(db, count_id=count_id, actor_user_id=current.id)
    except StockCountError as exc:
        raise HTTPException(409, {"code": "count_invalid", "message": str(exc)}) from exc
    db.commit()
    items, warehouses, categories, costs = _names(db)
    return _out(sheet, items, warehouses, categories, costs, with_lines=False)
