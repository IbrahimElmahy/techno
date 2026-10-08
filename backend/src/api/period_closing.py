from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LEDGER_POST, CAP_LEDGER_READ
from src.core.db import get_db
from src.models.period_closing import PeriodClosing
from src.services import period_closing_export as export
from src.services import period_closing_service as svc

router = APIRouter(tags=["period-closing"], prefix="/period-closing")


def _branch(current: CurrentUser, branch_id: int | None) -> int:
    if not branch_scope.sees_all_branches(current):
        return int(current.branch_id)
    bid = branch_id or branch_scope.visible_branch_id(current)
    if not bid:
        raise HTTPException(422, {"code": "branch_required", "message": "يجب اختيار الفرع."})
    return int(bid)


def _err(exc: svc.ClosingError):
    return HTTPException(422, {"code": "closing_invalid", "message": str(exc)})


def _closing(db: Session, current: CurrentUser, closing_id: int) -> PeriodClosing:
    c = db.get(PeriodClosing, closing_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "الإقفال غير موجود."})
    if not branch_scope.sees_all_branches(current) and c.branch_id != current.branch_id:
        raise HTTPException(404, {"code": "not_found", "message": "الإقفال غير موجود."})
    return c


class ConfigIn(BaseModel):
    accounts: dict[str, list[int]] = {}
    main_warehouse_ids: list[int] = []


@router.get("/config")
def get_config(branch_id: int | None = Query(None),
               current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
               db: Session = Depends(get_db)):
    bid = _branch(current, branch_id)
    return {**svc.get_config(db, bid),
            "product_lines": [svc.product_line_out(p) for p in svc.product_lines(db, bid)],
            "categories": svc.category_options(db, bid),
            "accounts_tree": svc.account_tree(db, bid),
            "warehouses": svc.branch_warehouses(db, bid)}


@router.put("/config")
def put_config(body: ConfigIn, branch_id: int | None = Query(None),
               current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
               db: Session = Depends(get_db)):
    bid = _branch(current, branch_id)
    out = svc.save_config(db, bid, body.model_dump(), current.id)
    db.commit()
    return out


class ProductLineIn(BaseModel):
    name: str
    categories: list[str] = []
    name_prefixes: list[str] = []
    basis: str = "cost"
    factor_pct: Any = 100
    active: bool = True


@router.put("/product-lines")
def put_product_lines(body: list[ProductLineIn], branch_id: int | None = Query(None),
                      current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
                      db: Session = Depends(get_db)):
    bid = _branch(current, branch_id)
    try:
        out = svc.save_product_lines(db, bid, [b.model_dump() for b in body])
    except svc.ClosingError as exc:
        db.rollback()
        raise _err(exc) from exc
    db.commit()
    return out


@router.get("/closings")
def list_closings(branch_id: int | None = Query(None),
                  current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
                  db: Session = Depends(get_db)):
    return svc.list_closings(db, _branch(current, branch_id))


class ClosingCreate(BaseModel):
    closing_date: date
    copy_previous: bool = True


@router.post("/closings", status_code=201)
def create_closing(body: ClosingCreate, branch_id: int | None = Query(None),
                   current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
                   db: Session = Depends(get_db)):
    bid = _branch(current, branch_id)
    try:
        c = svc.create_closing(db, branch_id=bid, closing_date=body.closing_date,
                               actor_id=current.id, copy_previous=body.copy_previous)
    except svc.ClosingError as exc:
        db.rollback()
        raise _err(exc) from exc
    db.commit()
    return svc.closing_out(db, c)


@router.get("/closings/{closing_id}")
def get_closing(closing_id: int,
                current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
                db: Session = Depends(get_db)):
    return svc.closing_out(db, _closing(db, current, closing_id))


class ClosingLineIn(BaseModel):
    section: str
    group_key: str | None = None
    label: str = ""
    quantity: Any = None
    rate: Any = None
    amount: Any = None
    sign: int = 1
    sort_order: int | None = None
    note: str | None = None


class ClosingUpdate(BaseModel):
    notes: str | None = None
    params: dict | None = None
    lines: list[ClosingLineIn] | None = None


@router.put("/closings/{closing_id}")
def update_closing(closing_id: int, body: ClosingUpdate,
                   current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
                   db: Session = Depends(get_db)):
    c = _closing(db, current, closing_id)
    try:
        svc.save_closing(db, c, notes=body.notes, params=body.params,
                         lines=None if body.lines is None
                         else [ln.model_dump() for ln in body.lines])
    except svc.ClosingError as exc:
        db.rollback()
        raise _err(exc) from exc
    db.commit()
    return svc.closing_out(db, c)


@router.post("/closings/{closing_id}/finalize")
def finalize_closing(closing_id: int,
                     current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
                     db: Session = Depends(get_db)):
    c = _closing(db, current, closing_id)
    try:
        svc.finalize(db, c, current.id)
    except svc.ClosingError as exc:
        db.rollback()
        raise _err(exc) from exc
    db.commit()
    return svc.closing_out(db, c)


@router.post("/closings/{closing_id}/reopen")
def reopen_closing(closing_id: int,
                   current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
                   db: Session = Depends(get_db)):
    c = _closing(db, current, closing_id)
    svc.reopen(db, c)
    db.commit()
    return svc.closing_out(db, c)


@router.delete("/closings/{closing_id}", status_code=204)
def delete_closing(closing_id: int,
                   current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
                   db: Session = Depends(get_db)):
    from sqlalchemy import delete

    from src.models.period_closing import PeriodClosingLine

    c = _closing(db, current, closing_id)
    if c.status == "final":
        raise HTTPException(422, {"code": "closing_final",
                                  "message": "الإقفال معتمد، ويجب إعادته إلى مسودة قبل الحذف."})
    db.execute(delete(PeriodClosingLine).where(PeriodClosingLine.closing_id == c.id))
    db.delete(c)
    db.commit()
    return Response(status_code=204)


def _dates(raw: str | None) -> list[date] | None:
    if not raw:
        return None
    out = sorted({date.fromisoformat(x.strip()[:10]) for x in raw.split(",") if x.strip()})
    return out or None


@router.get("/package")
def get_package(
    as_of: date = Query(...),
    branch_id: int | None = Query(None),
    blocks: str | None = Query(None),
    advance_dates: str | None = Query(None),
    live: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
    db: Session = Depends(get_db),
):
    bid = _branch(current, branch_id)
    want = [b.strip() for b in blocks.split(",")] if blocks else None
    return svc.package(db, bid, as_of, blocks=want, advance_dates=_dates(advance_dates),
                       use_snapshot=not live)


@router.get("/package.xlsx")
def get_package_xlsx(
    as_of: date = Query(...),
    branch_id: int | None = Query(None),
    blocks: str | None = Query(None),
    advance_dates: str | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
    db: Session = Depends(get_db),
):
    bid = _branch(current, branch_id)
    want = [b.strip() for b in blocks.split(",")] if blocks else None
    pkg = svc.package(db, bid, as_of, blocks=want, advance_dates=_dates(advance_dates))
    data = export.build(pkg)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=closing_{bid}_{as_of}.xlsx"},
    )
