from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_ACCOUNTING_CHART_READ, CAP_ACCOUNTING_JOURNAL_POST
from src.core.db import get_db
from src.models.ledger import Account
from src.services import fixed_asset_service as svc
from src.services.fixed_asset_service import FixedAssetError
from src.services.ledger_service import LedgerError

router = APIRouter(tags=["fixed-assets"], prefix="/fixed-assets")

READ = Depends(require_capability(CAP_ACCOUNTING_CHART_READ))
WRITE = Depends(require_capability(CAP_ACCOUNTING_JOURNAL_POST))


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
    prorata: bool | None = None
    notes: str | None = None
    branch_id: int | None = None
    cost_center_id: int | None = None
    confirm: bool = False


class AssetUpdate(BaseModel):
    name: str | None = None
    acquisition_date: date | None = None
    cost: Decimal | None = None
    useful_life_months: int | None = None
    salvage_value: Decimal | None = None
    method: str | None = None
    category_id: int | None = None
    usage: str | None = None
    annual_rate: Decimal | None = None
    opening_accumulated: Decimal | None = None
    depreciation_start: date | None = None
    prorata: bool | None = None
    notes: str | None = None
    branch_id: int | None = None
    cost_center_id: int | None = None


class AssetOut(BaseModel):
    id: int
    code: str
    name: str
    category: str | None
    category_id: int | None = None
    usage: str = "admin"
    state: str = "running"
    prorata: bool = False
    annual_rate: Decimal | None = None
    opening_accumulated: Decimal = Decimal("0")
    depreciation_start: date | None = None
    source_kind: str | None = None
    source_id: int | None = None
    source_label: str | None = None
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
    accounts: dict[str, str] = {}
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
    prorata: bool = False
    auto_confirm: bool = True


class CategoryOut(BaseModel):
    id: int
    name: str
    method: str
    annual_rate: Decimal | None = None
    useful_life_months: int | None = None
    usage: str
    active: bool
    prorata: bool = False
    auto_confirm: bool = True
    asset_count: int = 0


class RunIn(BaseModel):
    year: int
    month: int
    asset_ids: list[int] | None = None


class DisposeIn(BaseModel):
    disposal_date: date
    proceeds: Decimal = Decimal("0")
    cash_account_id: int | None = None
    reason: str | None = None


class ModifyIn(BaseModel):
    method: str
    remaining_months: int | None = None
    annual_rate: Decimal | None = None
    salvage_value: Decimal | None = None
    reason: str


class RevalueIn(BaseModel):
    kind: str
    amount: Decimal
    event_date: date
    reason: str
    counter_account_id: int | None = None


class ReasonIn(BaseModel):
    reason: str | None = None


def _fail(exc: Exception, code: int = 422):
    return HTTPException(code, {"code": "asset_invalid", "message": str(exc)})


def _source_label(db: Session, a) -> str | None:
    if a.source_kind == "purchase":
        from src.models.purchasing import PurchaseInvoice

        inv = db.get(PurchaseInvoice, a.source_id)
        return f"فاتورة شراء {inv.document_number}" if inv else None
    if a.source_kind == "voucher":
        from src.models.voucher import Voucher

        v = db.get(Voucher, a.source_id)
        return f"سند مصروف {v.document_number}" if v else None
    return None


def _out(db: Session, a, accumulated: Decimal | None = None, full: bool = False) -> AssetOut:
    acc = accumulated if accumulated is not None else svc.accumulated_of(db, a.id)
    accounts = {}
    if full:
        for key, aid in (("asset", a.asset_account_id), ("accumulated", a.accumulated_account_id),
                         ("expense", a.expense_account_id)):
            row = db.get(Account, aid)
            accounts[key] = f"{row.code} — {row.name}" if row else str(aid)
    return AssetOut(
        id=a.id, code=a.code, name=a.name, category=a.category, category_id=a.category_id,
        usage=a.usage or "admin", state=a.state or "running", prorata=bool(a.prorata),
        annual_rate=a.annual_rate, opening_accumulated=a.opening_accumulated or 0,
        depreciation_start=a.depreciation_start, source_kind=a.source_kind,
        source_id=a.source_id, source_label=_source_label(db, a) if full else None,
        acquisition_date=a.acquisition_date, cost=a.cost, salvage_value=a.salvage_value,
        useful_life_months=a.useful_life_months or 0, method=str(a.method),
        status=a.status.value, accumulated_depreciation=acc,
        book_value=Decimal(0) if a.state == "closed" else Decimal(a.cost) - acc,
        branch_id=a.branch_id,
        asset_account_id=a.asset_account_id, accumulated_account_id=a.accumulated_account_id,
        expense_account_id=a.expense_account_id, accounts=accounts,
        cost_center_id=a.cost_center_id, disposal_date=a.disposal_date,
        disposal_proceeds=a.disposal_proceeds, gain_loss=a.disposal_gain_loss, notes=a.notes,
    )


def _cat_out(c, counts: dict[int, int]) -> CategoryOut:
    return CategoryOut(id=c.id, name=c.name, method=c.method, annual_rate=c.annual_rate,
                       useful_life_months=c.useful_life_months, usage=c.usage,
                       active=bool(c.active), prorata=bool(c.prorata),
                       auto_confirm=bool(c.auto_confirm), asset_count=counts.get(c.id, 0))


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(_: CurrentUser = READ, db: Session = Depends(get_db)) -> list[CategoryOut]:
    rows = svc.list_categories(db)
    counts = svc.category_counts(db)
    out = [_cat_out(c, counts) for c in rows]
    db.commit()
    return out


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(body: CategoryIn, _: CurrentUser = WRITE,
                    db: Session = Depends(get_db)) -> CategoryOut:
    try:
        cat = svc.save_category(db, category_id=None, **body.model_dump())
    except FixedAssetError as exc:
        raise _fail(exc) from exc
    out = _cat_out(cat, {})
    db.commit()
    return out


@router.put("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, body: CategoryIn, _: CurrentUser = WRITE,
                    db: Session = Depends(get_db)) -> CategoryOut:
    try:
        cat = svc.save_category(db, category_id=category_id, **body.model_dump())
    except FixedAssetError as exc:
        raise _fail(exc) from exc
    out = _cat_out(cat, svc.category_counts(db))
    db.commit()
    return out


def _own_branch(current: CurrentUser, asked: int | None) -> int | None:
    from src.auth import branch_scope

    mine = branch_scope.visible_branch_id(current)
    return asked if mine is None else mine


@router.get("/report", response_model=dict)
def assets_report(
    as_of: date | None = Query(None), branch_id: int | None = Query(None),
    category_id: int | None = Query(None), usage: str | None = Query(None),
    include_disposed: bool = Query(False), current: CurrentUser = READ,
    db: Session = Depends(get_db),
) -> dict:
    branch_id = _own_branch(current, branch_id)
    return svc.report(db, as_of=as_of, branch_id=branch_id, category_id=category_id,
                      usage=usage, include_disposed=include_disposed)


@router.get("/schedule-report", response_model=dict)
def schedule_report(
    date_from: date = Query(...), date_to: date = Query(...),
    branch_id: int | None = Query(None), category_id: int | None = Query(None),
    current: CurrentUser = READ, db: Session = Depends(get_db),
) -> dict:
    branch_id = _own_branch(current, branch_id)
    try:
        return svc.schedule_report(db, date_from=date_from, date_to=date_to,
                                   branch_id=branch_id, category_id=category_id)
    except FixedAssetError as exc:
        raise _fail(exc) from exc


@router.get("/depreciation/preview", response_model=dict)
def depreciation_preview(year: int = Query(...), month: int = Query(...),
                         _: CurrentUser = READ, db: Session = Depends(get_db)) -> dict:
    return svc.preview(db, year=year, month=month)


@router.post("/depreciation/run", response_model=dict, status_code=status.HTTP_201_CREATED)
def run_depreciation(body: RunIn, current: CurrentUser = WRITE,
                     db: Session = Depends(get_db)) -> dict:
    try:
        result = svc.run_depreciation(db, year=body.year, month=body.month,
                                      actor_user_id=current.id, asset_ids=body.asset_ids)
    except FixedAssetError as exc:
        raise _fail(exc) from exc
    except LedgerError as exc:
        raise _fail(exc, 409) from exc
    db.commit()
    return result


@router.post("/depreciation/reverse", response_model=dict, status_code=status.HTTP_201_CREATED)
def reverse_depreciation(body: RunIn, current: CurrentUser = WRITE,
                         db: Session = Depends(get_db)) -> dict:
    try:
        result = svc.reverse_depreciation(db, year=body.year, month=body.month,
                                          actor_user_id=current.id)
    except (FixedAssetError, LedgerError) as exc:
        raise _fail(exc, 409) from exc
    db.commit()
    return result


@router.get("", response_model=list[AssetOut])
def list_assets(
    status_filter: str | None = Query(None, alias="status"),
    category: str | None = Query(None),
    source_kind: str | None = Query(None),
    source_id: int | None = Query(None),
    current: CurrentUser = READ, db: Session = Depends(get_db),
) -> list[AssetOut]:
    try:
        if source_kind and source_id:
            rows = svc.assets_of_source(db, source_kind, source_id)
        else:
            rows = svc.list_assets(db, status=status_filter, category=category)
    except ValueError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    from src.auth import branch_scope

    rows = [a for a in rows if branch_scope.may_see(current, a)]
    acc = svc.accumulated_map(db, [a.id for a in rows])
    return [_out(db, a, acc.get(a.id)) for a in rows]


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
def create_asset(body: AssetIn, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> AssetOut:
    data = body.model_dump()
    confirm = data.pop("confirm")
    try:
        asset = svc.create_asset(db, actor_user_id=current.id, **data)
        if confirm:
            svc.confirm_asset(db, asset_id=asset.id, actor_user_id=current.id)
    except FixedAssetError as exc:
        raise _fail(exc) from exc
    out = _out(db, asset, full=True)
    db.commit()
    return out


@router.get("/{asset_id}", response_model=AssetOut)
def get_asset(asset_id: int, current: CurrentUser = READ, db: Session = Depends(get_db)) -> AssetOut:
    from src.auth import branch_scope

    try:
        asset = svc.get_asset(db, asset_id)
        if not branch_scope.may_see(current, asset):
            raise FixedAssetError("الأصل غير موجود")
        return _out(db, asset, full=True)
    except FixedAssetError as exc:
        raise _fail(exc, 404) from exc


@router.put("/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, body: AssetUpdate, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> AssetOut:
    try:
        asset = svc.update_asset(db, asset_id=asset_id, actor_user_id=current.id,
                                 **body.model_dump(exclude_unset=True))
    except FixedAssetError as exc:
        raise _fail(exc) from exc
    out = _out(db, asset, full=True)
    db.commit()
    return out


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(asset_id: int, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> None:
    try:
        svc.delete_asset(db, asset_id=asset_id, actor_user_id=current.id)
    except FixedAssetError as exc:
        raise _fail(exc, 409) from exc
    db.commit()


def _action(db: Session, fn, **kw) -> AssetOut:
    try:
        asset = fn(db, **kw)
    except FixedAssetError as exc:
        raise _fail(exc, 409) from exc
    except LedgerError as exc:
        raise _fail(exc, 409) from exc
    out = _out(db, asset, full=True)
    db.commit()
    return out


@router.post("/{asset_id}/confirm", response_model=AssetOut)
def confirm(asset_id: int, current: CurrentUser = WRITE, db: Session = Depends(get_db)):
    return _action(db, svc.confirm_asset, asset_id=asset_id, actor_user_id=current.id)


@router.post("/{asset_id}/draft", response_model=AssetOut)
def set_draft(asset_id: int, current: CurrentUser = WRITE, db: Session = Depends(get_db)):
    return _action(db, svc.set_draft, asset_id=asset_id, actor_user_id=current.id)


@router.post("/{asset_id}/pause", response_model=AssetOut)
def pause(asset_id: int, body: ReasonIn, current: CurrentUser = WRITE,
          db: Session = Depends(get_db)):
    return _action(db, svc.pause_asset, asset_id=asset_id, actor_user_id=current.id,
                   reason=body.reason)


@router.post("/{asset_id}/resume", response_model=AssetOut)
def resume(asset_id: int, current: CurrentUser = WRITE, db: Session = Depends(get_db)):
    return _action(db, svc.resume_asset, asset_id=asset_id, actor_user_id=current.id)


@router.post("/{asset_id}/modify", response_model=AssetOut)
def modify(asset_id: int, body: ModifyIn, current: CurrentUser = WRITE,
           db: Session = Depends(get_db)):
    return _action(db, svc.modify_depreciation, asset_id=asset_id, actor_user_id=current.id,
                   **body.model_dump())


@router.post("/{asset_id}/revalue", response_model=AssetOut)
def revalue(asset_id: int, body: RevalueIn, current: CurrentUser = WRITE,
            db: Session = Depends(get_db)):
    return _action(db, svc.revalue, asset_id=asset_id, actor_user_id=current.id,
                   **body.model_dump())


@router.post("/{asset_id}/dispose", response_model=AssetOut)
def dispose_asset(asset_id: int, body: DisposeIn, current: CurrentUser = WRITE,
                  db: Session = Depends(get_db)):
    return _action(db, svc.dispose_asset, asset_id=asset_id, actor_user_id=current.id,
                   disposal_date=body.disposal_date, proceeds=body.proceeds,
                   cash_account_id=body.cash_account_id, reason=body.reason)


@router.get("/{asset_id}/board", response_model=dict)
def asset_board(asset_id: int, _: CurrentUser = READ, db: Session = Depends(get_db)) -> dict:
    try:
        return svc.board(db, svc.get_asset(db, asset_id))
    except FixedAssetError as exc:
        raise _fail(exc, 404) from exc


@router.get("/{asset_id}/events", response_model=list[dict])
def asset_events(asset_id: int, _: CurrentUser = READ,
                 db: Session = Depends(get_db)) -> list[dict]:
    return svc.events_of(db, asset_id)


@router.get("/{asset_id}/entries", response_model=list[dict])
def asset_entries(asset_id: int, _: CurrentUser = READ,
                  db: Session = Depends(get_db)) -> list[dict]:
    try:
        return svc.entries_of(db, svc.get_asset(db, asset_id))
    except FixedAssetError as exc:
        raise _fail(exc, 404) from exc


@router.get("/{asset_id}/schedule", response_model=list[dict])
def asset_schedule(asset_id: int, _: CurrentUser = READ,
                   db: Session = Depends(get_db)) -> list[dict]:
    rows = svc.schedule_of(db, asset_id)
    return [{"year": r.year, "month": r.month, "amount": str(r.amount),
             "ledger_entry_id": r.ledger_entry_id} for r in rows]
