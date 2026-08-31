"""Warehouses & custodies router (T042). FR-015, FR-025, FR-026."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import (
    CAP_CUSTODY_READ,
    CAP_CUSTODY_WRITE,
    CAP_WAREHOUSE_READ,
    CAP_WAREHOUSE_WRITE,
)
from src.core.db import get_db
from src.models.ledger import Account, AccountType, Direction
from src.models.employee import Employee, JobTitle
from src.models.warehouse import Custody, HolderType, Warehouse, WarehouseType
from src.services import audit_service, ledger_service

router = APIRouter(tags=["warehouses"])


class WarehouseCreate(BaseModel):
    name: str
    warehouse_type: WarehouseType
    branch_id: int | None = None
    # «مخزن السيارة أ» explains itself; «مخزن ٣» does not.
    description: str | None = None


class WarehouseUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None
    description: str | None = None
    # A store does move between branches, and its type does get corrected after the fact. Leaving
    # these out of the update meant the only way to fix either was to make a second store and
    # retire the first — which splits its movement history across two records for a typo.
    branch_id: int | None = None
    warehouse_type: WarehouseType | None = None


class CustodyUpdate(BaseModel):
    active: bool | None = None
    # الخط بيتصحّح، مابيتعادش عمله. صندوق اتفتح على «أبيض» وهو بولي كان لازم يتقفل
    # ويتعمل واحد جديد — والرصيد بيتقسم على صفّين عشان غلطة في قايمة.
    family: str | None = None


class WarehouseOut(BaseModel):
    id: int
    name: str
    warehouse_type: WarehouseType
    branch_id: int | None
    description: str | None = None
    active: bool


class CustodyCreate(BaseModel):
    holder_type: HolderType
    rep_id: int | None = None
    # (009) الخط اللي الصندوق ده بتاعه — «أبيض» / «بولي». المندوب له صندوق لكل خط،
    # فالتفرّد بقى على (المندوب، الخط) مش على المندوب لوحده.
    family: str | None = None
    warehouse_id: int | None = None


class CustodyOut(BaseModel):
    id: int
    holder_type: HolderType
    rep_id: int | None
    family: str | None = None
    warehouse_id: int | None
    active: bool


class BalanceOut(BaseModel):
    account_id: int
    balance: Decimal


@router.get("/warehouses", response_model=list[WarehouseOut])
def list_warehouses(
    current: CurrentUser = Depends(require_capability(CAP_WAREHOUSE_READ)),
    db: Session = Depends(get_db),
) -> list[WarehouseOut]:
    stmt = select(Warehouse)
    if not current.is_admin:
        # Branch warehouses of own branch + the shared central warehouse.
        stmt = stmt.where(
            (Warehouse.branch_id == current.branch_id)
            | (Warehouse.warehouse_type == WarehouseType.central)
        )
    return [
        WarehouseOut(
            id=w.id, name=w.name, warehouse_type=w.warehouse_type,
            description=w.description, branch_id=w.branch_id, active=w.active,
        )
        for w in db.scalars(stmt).all()
    ]


@router.post("/warehouses", response_model=WarehouseOut, status_code=status.HTTP_201_CREATED)
def create_warehouse(
    body: WarehouseCreate,
    _: CurrentUser = Depends(require_capability(CAP_WAREHOUSE_WRITE)),
    db: Session = Depends(get_db),
) -> WarehouseOut:
    if body.warehouse_type == WarehouseType.branch and body.branch_id is None:
        raise HTTPException(422, {"code": "validation", "message": "branch warehouse needs branch_id"})
    wh = Warehouse(name=body.name, warehouse_type=body.warehouse_type,
                   branch_id=body.branch_id, description=body.description)
    db.add(wh)
    db.flush()
    db.commit()
    return WarehouseOut(
        id=wh.id, name=wh.name, warehouse_type=wh.warehouse_type,
        description=wh.description, branch_id=wh.branch_id, active=wh.active,
    )


@router.patch("/warehouses/{warehouse_id}", response_model=WarehouseOut)
def update_warehouse(
    warehouse_id: int,
    body: WarehouseUpdate,
    current: CurrentUser = Depends(require_capability(CAP_WAREHOUSE_WRITE)),
    db: Session = Depends(get_db),
) -> WarehouseOut:
    wh = db.get(Warehouse, warehouse_id)
    if wh is None:
        raise HTTPException(404, {"code": "not_found", "message": "Warehouse not found"})
    if body.name is not None:
        wh.name = body.name
    if body.description is not None:
        wh.description = body.description
    if body.active is not None:
        wh.active = body.active
    if body.branch_id is not None:
        wh.branch_id = body.branch_id
    if body.warehouse_type is not None:
        wh.warehouse_type = body.warehouse_type
    db.flush()
    audit_service.record(db, action="warehouse.update", actor_user_id=current.id,
                         entity_type="warehouse", entity_id=wh.id)
    db.commit()
    return WarehouseOut(id=wh.id, name=wh.name, warehouse_type=wh.warehouse_type,
                        description=wh.description,
                        branch_id=wh.branch_id, active=wh.active)


@router.delete("/warehouses/{warehouse_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_warehouse(
    warehouse_id: int,
    current: CurrentUser = Depends(require_capability(CAP_WAREHOUSE_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    wh = db.get(Warehouse, warehouse_id)
    if wh is None:
        raise HTTPException(404, {"code": "not_found", "message": "Warehouse not found"})
    wh.active = False
    db.flush()
    audit_service.record(db, action="warehouse.deactivate", actor_user_id=current.id,
                         entity_type="warehouse", entity_id=wh.id)
    db.commit()


@router.get("/custodies", response_model=list[CustodyOut])
def list_custodies(
    _: CurrentUser = Depends(require_capability(CAP_CUSTODY_READ)),
    db: Session = Depends(get_db),
) -> list[CustodyOut]:
    return [
        CustodyOut(
            id=c.id, holder_type=c.holder_type, rep_id=c.rep_id, family=c.family,
            warehouse_id=c.warehouse_id, active=c.active,
        )
        for c in db.scalars(select(Custody)).all()
    ]


@router.post("/custodies", response_model=CustodyOut, status_code=status.HTTP_201_CREATED)
def create_custody(
    body: CustodyCreate,
    _: CurrentUser = Depends(require_capability(CAP_CUSTODY_WRITE)),
    db: Session = Depends(get_db),
) -> CustodyOut:
    # Enforce exactly one custody per holder (FR-025).
    if body.holder_type == HolderType.rep:
        if body.rep_id is None:
            raise HTTPException(422, {"code": "validation", "message": "rep custody needs rep_id"})
        # التفرّد على (المندوب، الخط): نفس المندوب ياخد صندوق أبيض وصندوق بولي، ومايخدش
        # صندوقين لنفس الخط.
        exists = db.scalar(select(Custody).where(
            Custody.rep_id == body.rep_id,
            Custody.family == body.family if body.family else Custody.family.is_(None)))
    else:
        if body.warehouse_id is None:
            raise HTTPException(422, {"code": "validation", "message": "warehouse custody needs warehouse_id"})
        exists = db.scalar(select(Custody).where(Custody.warehouse_id == body.warehouse_id))
    if exists is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "custody_exists", "message": "Custody already exists for this holder"},
        )

    account = Account(account_type=AccountType.custody, owner_ref=None, normal_side=Direction.debit)
    db.add(account)
    db.flush()
    custody = Custody(
        holder_type=body.holder_type, rep_id=body.rep_id, family=(body.family or None),
        warehouse_id=body.warehouse_id, account_id=account.id,
    )
    db.add(custody)
    db.flush()
    account.owner_ref = custody.id
    db.commit()
    return CustodyOut(
        id=custody.id, holder_type=custody.holder_type, rep_id=custody.rep_id,
        family=custody.family, warehouse_id=custody.warehouse_id, active=custody.active,
    )


@router.patch("/custodies/{custody_id}", response_model=CustodyOut)
def update_custody(
    custody_id: int,
    body: CustodyUpdate,
    current: CurrentUser = Depends(require_capability(CAP_CUSTODY_WRITE)),
    db: Session = Depends(get_db),
) -> CustodyOut:
    c = db.get(Custody, custody_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Custody not found"})
    if body.active is not None:
        c.active = body.active
    if body.family is not None:
        c.family = body.family or None
    db.flush()
    audit_service.record(db, action="custody.update", actor_user_id=current.id,
                         entity_type="custody", entity_id=c.id)
    db.commit()
    return CustodyOut(id=c.id, holder_type=c.holder_type, rep_id=c.rep_id,
                      family=c.family, warehouse_id=c.warehouse_id, active=c.active)


@router.delete("/custodies/{custody_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_custody(
    custody_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTODY_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    c = db.get(Custody, custody_id)
    if c is None:
        raise HTTPException(404, {"code": "not_found", "message": "Custody not found"})
    c.active = False
    db.flush()
    audit_service.record(db, action="custody.deactivate", actor_user_id=current.id,
                         entity_type="custody", entity_id=c.id)
    db.commit()


@router.get("/custodies/{custody_id}/balance", response_model=BalanceOut)
def custody_balance(
    custody_id: int,
    _: CurrentUser = Depends(require_capability(CAP_CUSTODY_READ)),
    db: Session = Depends(get_db),
) -> BalanceOut:
    custody = db.get(Custody, custody_id)
    if custody is None or custody.account_id is None:
        raise HTTPException(404, {"code": "not_found", "message": "Custody not found"})
    return BalanceOut(account_id=custody.account_id, balance=ledger_service.balance_of(db, custody.account_id))


class WarehouseRepsIn(BaseModel):
    employee_ids: list[int]


class WarehouseRepOut(BaseModel):
    id: int
    code: str
    name: str
    job_title: str | None = None
    # The login this employee signs in with. NULL means the person is on the payroll but has no
    # account — they can hold stock, but no customer can be assigned to them, because «مندوب» on
    # a customer is a login.
    user_id: int | None = None
    active: bool


def _rep_out(db: Session, e: Employee) -> WarehouseRepOut:
    title = db.get(JobTitle, e.job_title_id) if e.job_title_id else None
    return WarehouseRepOut(
        id=e.id, code=e.code, name=e.name, job_title=title.name if title else None,
        user_id=e.user_id, active=e.active,
    )


@router.get("/warehouses/{warehouse_id}/reps", response_model=list[WarehouseRepOut])
def list_warehouse_reps(
    warehouse_id: int,
    _: CurrentUser = Depends(require_capability(CAP_WAREHOUSE_READ)),
    db: Session = Depends(get_db),
) -> list[WarehouseRepOut]:
    """The employees who work out of this store.

    Reps are picked from الموظفين, not from logins: the payroll is where the client already
    records who drives which van, and `employee.warehouse_id` has held that answer all along.
    """
    if db.get(Warehouse, warehouse_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "Warehouse not found"})
    rows = db.scalars(
        select(Employee).where(Employee.warehouse_id == warehouse_id).order_by(Employee.name)
    ).all()
    return [_rep_out(db, e) for e in rows]


@router.put("/warehouses/{warehouse_id}/reps", response_model=list[WarehouseRepOut])
def set_warehouse_reps(
    warehouse_id: int,
    body: WarehouseRepsIn,
    current: CurrentUser = Depends(require_capability(CAP_WAREHOUSE_WRITE)),
    db: Session = Depends(get_db),
) -> list[WarehouseRepOut]:
    """Replace the set of employees working out of this store.

    This endpoint OWNS the set rather than adding to it, because the alternative — a PATCH per
    employee — has no way to say «and nobody else». Taking somebody off a store means clearing
    their `warehouse_id`, and a PATCH that reads a missing field as «leave alone» cannot tell an
    omitted store from a cleared one. Owning the set makes removal an ordinary part of saving
    instead of a separate verb nobody remembers to call.

    An employee has one store, so naming him here MOVES him: whatever store he was on stops being
    his. That is the intended meaning — «مندوب السيارة أ» drives one car.
    """
    if db.get(Warehouse, warehouse_id) is None:
        raise HTTPException(404, {"code": "not_found", "message": "Warehouse not found"})

    employees = list(db.scalars(select(Employee).where(Employee.id.in_(body.employee_ids))).all())
    found = {e.id for e in employees}
    missing = [eid for eid in body.employee_ids if eid not in found]
    if missing:
        raise HTTPException(404, {"code": "not_found",
                                  "message": f"Employees not found: {missing}"})

    # Anyone currently on this store and not in the new list comes off it.
    for e in db.scalars(select(Employee).where(Employee.warehouse_id == warehouse_id)).all():
        if e.id not in found:
            e.warehouse_id = None
    for e in employees:
        e.warehouse_id = warehouse_id
    db.flush()
    audit_service.record(db, action="warehouse.set_reps", actor_user_id=current.id,
                         entity_type="warehouse", entity_id=warehouse_id,
                         after={"employee_ids": sorted(found)})
    db.commit()
    return [_rep_out(db, e) for e in employees]
