from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import (
    CAP_FLEET_READ, CAP_FLEET_WRITE, CAP_PAYROLL_POST, CAP_VOUCHER_WRITE,
)
from src.core.db import get_db
from src.models.employee import Employee, JobTitle
from src.models.fleet import (
    CheckResult,
    DriverProfile,
    DriverRating,
    DriverStatus,
    FaultSeverity,
    FaultStatus,
    FleetMonthlyNote,
    FleetTask,
    FleetTaskLog,
    TaskPeriod,
    Vehicle,
    VehicleDriverAssignment,
    VehicleFault,
    VehicleFuel,
    VehicleInspection,
    VehicleMaintenance,
    VehicleStatus,
    VehicleViolation,
)
from src.models.ledger import Account
from src.models.role import RoleName
from src.models.voucher import Voucher, VoucherKind
from src.services import fleet_service as svc
from src.services.fleet_service import FleetError, FleetNotFound

router = APIRouter(tags=["fleet"], prefix="/fleet")

READ = Depends(require_capability(CAP_FLEET_READ))
WRITE = Depends(require_capability(CAP_FLEET_WRITE))


def _raise(exc: Exception):
    from src.services.advance_service import AdvanceError
    from src.services.ledger_service import LedgerError
    from src.services.treasury_service import TreasuryError
    from src.services.voucher_service import VoucherError

    if isinstance(exc, FleetNotFound):
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    if isinstance(exc, (VoucherError, LedgerError, TreasuryError)):
        raise HTTPException(409, {"code": "voucher_invalid", "message": str(exc)}) from exc
    if isinstance(exc, (FleetError, AdvanceError)):
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    raise exc


def _plain(v):
    if isinstance(v, enum.Enum):
        return v.value
    if isinstance(v, Decimal):
        return str(v)
    return v


def _row(obj) -> dict:
    return {c.name: _plain(getattr(obj, c.name)) for c in obj.__table__.columns}


def _touch(row, current: CurrentUser) -> None:
    row.updated_at, row.updated_by_user_id = datetime.now(), current.id


class SettingsIn(BaseModel):
    expiry_alert_days: int = 30
    maintenance_alert_km: int = 500
    fuel_abnormal_pct: int = 20


@router.get("/settings")
def get_settings(_: CurrentUser = READ, db: Session = Depends(get_db)) -> dict:
    out = _row(svc.settings(db))
    db.commit()
    return out


@router.put("/settings")
def put_settings(body: SettingsIn, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> dict:
    if body.expiry_alert_days < 0 or body.maintenance_alert_km < 0 or not 0 <= body.fuel_abnormal_pct <= 100:
        raise HTTPException(422, {"code": "validation", "message": "قيم غير صالحة."})
    row = svc.settings(db)
    row.expiry_alert_days = body.expiry_alert_days
    row.maintenance_alert_km = body.maintenance_alert_km
    row.fuel_abnormal_pct = body.fuel_abnormal_pct
    _touch(row, current)
    for v in db.scalars(select(Vehicle)).all():
        svc.refresh_vehicle(db, v)
    db.commit()
    return _row(row)


@router.get("/dashboard")
def get_dashboard(current: CurrentUser = READ, db: Session = Depends(get_db)) -> dict:
    out = svc.dashboard(db, current)
    db.commit()
    return out


@router.get("/employees")
def list_employees(current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    stmt = branch_scope.scope(select(Employee).where(Employee.active.is_(True)), Employee, current)
    emps = list(db.scalars(stmt.order_by(Employee.name)).all())
    seen = {e.id for e in emps}
    driver_ids = set(db.scalars(branch_scope.scope(
        select(Vehicle.current_driver_id).where(Vehicle.current_driver_id.is_not(None)),
        Vehicle, current))) - seen
    if driver_ids:
        emps += list(db.scalars(select(Employee).where(Employee.id.in_(driver_ids))).all())
    titles = dict(db.execute(select(JobTitle.id, JobTitle.name)).all())
    drivers = set(db.scalars(select(DriverProfile.employee_id)))
    return [{"id": e.id, "code": e.code, "name": e.name, "phone": e.phone,
             "branch_id": e.branch_id, "job_title": titles.get(e.job_title_id),
             "is_driver": e.id in drivers} for e in emps]


class VehicleIn(BaseModel):
    code: str
    kind: str | None = None
    model: str | None = None
    plate_number: str | None = None
    current_driver_id: int | None = None
    odometer: int | None = None
    status_override: VehicleStatus | None = None
    next_maintenance_km: int | None = None
    last_maintenance_km: int | None = None
    insurance_until: date | None = None
    license_until: date | None = None
    fuel_account_id: int | None = None
    maintenance_account_id: int | None = None
    cost_center_id: int | None = None
    branch_id: int | None = None
    active: bool = True
    notes: str | None = None
    assign_date: date | None = None


class AssignIn(BaseModel):
    employee_id: int | None = None
    on: date | None = None
    odometer: int | None = None
    notes: str | None = None


def _vehicles_out(db: Session, vehicles: list[Vehicle]) -> list[dict]:
    states = svc.vehicle_states(db, vehicles)
    names = svc.employee_names(db, [v.current_driver_id for v in vehicles])
    accounts = dict(db.execute(select(Account.id, Account.name).where(Account.id.in_(
        {a for v in vehicles for a in (v.fuel_account_id, v.maintenance_account_id) if a} or {0})))
        .all())
    today = date.today()
    out = []
    for v in vehicles:
        d = _row(v)
        st = states[v.id]
        d.update({
            "status": st["status"].value, "auto_status": st["auto_status"].value,
            "status_label": svc.STATUS_LABELS[st["status"]], "reasons": st["reasons"],
            "open_faults": st["open_faults"], "km_to_maintenance": st["km_to_maintenance"],
            "driver_name": names.get(v.current_driver_id),
            "fuel_account_name": accounts.get(v.fuel_account_id),
            "maintenance_account_name": accounts.get(v.maintenance_account_id),
            "insurance_days_left": (v.insurance_until - today).days if v.insurance_until else None,
            "license_days_left": (v.license_until - today).days if v.license_until else None,
        })
        out.append(d)
    return out


def _check_code(db: Session, code: str, own_id: int | None = None) -> str:
    code = (code or "").strip()
    if not code:
        raise FleetError("رقم السيارة مطلوب.")
    q = select(Vehicle.id).where(func.lower(Vehicle.code) == code.lower())
    if own_id:
        q = q.where(Vehicle.id != own_id)
    if db.scalar(q):
        raise FleetError(f"توجد سيارة مسجلة بالرقم «{code}».")
    return code


@router.get("/vehicles")
def list_vehicles(active: bool | None = Query(None), current: CurrentUser = READ,
                  db: Session = Depends(get_db)) -> list[dict]:
    stmt = branch_scope.scope(select(Vehicle), Vehicle, current)
    if active is not None:
        stmt = stmt.where(Vehicle.active.is_(active))
    out = _vehicles_out(db, db.scalars(stmt.order_by(Vehicle.code)).all())
    db.commit()
    return out


@router.post("/vehicles", status_code=status.HTTP_201_CREATED)
def create_vehicle(body: VehicleIn, current: CurrentUser = WRITE,
                   db: Session = Depends(get_db)) -> dict:
    try:
        code = _check_code(db, body.code)
        v = Vehicle(
            code=code, kind=body.kind, model=body.model, plate_number=body.plate_number,
            odometer_base=body.odometer or 0, odometer=body.odometer or 0,
            status_override=body.status_override, next_maintenance_km=body.next_maintenance_km,
            last_maintenance_km=body.last_maintenance_km,
            insurance_until=body.insurance_until, license_until=body.license_until,
            fuel_account_id=body.fuel_account_id,
            maintenance_account_id=body.maintenance_account_id,
            cost_center_id=body.cost_center_id, active=body.active, notes=body.notes,
            branch_id=svc.new_branch_id(db, current, body.branch_id),
            created_by_user_id=current.id)
        db.add(v)
        db.flush()
        if body.current_driver_id:
            svc.assign_driver(db, v, body.current_driver_id, on=body.assign_date or date.today(),
                              odometer=v.odometer, actor_user_id=current.id)
        svc.refresh_vehicle(db, v)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = _vehicles_out(db, [v])[0]
    db.commit()
    return out


@router.put("/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: int, body: VehicleIn, current: CurrentUser = WRITE,
                   db: Session = Depends(get_db)) -> dict:
    try:
        v = svc.get_vehicle(db, current, vehicle_id)
        v.code = _check_code(db, body.code, v.id)
        v.kind, v.model, v.plate_number = body.kind, body.model, body.plate_number
        if body.odometer is not None and body.odometer != v.odometer:
            v.odometer_base = body.odometer
        v.status_override = body.status_override
        v.next_maintenance_km = body.next_maintenance_km
        v.last_maintenance_km = body.last_maintenance_km
        v.insurance_until, v.license_until = body.insurance_until, body.license_until
        v.fuel_account_id = body.fuel_account_id
        v.maintenance_account_id = body.maintenance_account_id
        v.cost_center_id = body.cost_center_id
        v.active, v.notes = body.active, body.notes
        if branch_scope.sees_all_branches(current) and body.branch_id:
            v.branch_id = body.branch_id
        if body.current_driver_id != v.current_driver_id:
            svc.assign_driver(db, v, body.current_driver_id, on=body.assign_date or date.today(),
                              odometer=None, actor_user_id=current.id)
        _touch(v, current)
        svc.refresh_vehicle(db, v)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = _vehicles_out(db, [v])[0]
    db.commit()
    return out


@router.delete("/vehicles/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(vehicle_id: int, current: CurrentUser = WRITE,
                   db: Session = Depends(get_db)) -> None:
    try:
        v = svc.get_vehicle(db, current, vehicle_id)
        used = sum(db.scalar(select(func.count()).select_from(m).where(m.vehicle_id == v.id)) or 0
                   for m in (VehicleFuel, VehicleMaintenance, VehicleFault, VehicleViolation,
                             VehicleInspection))
        if used:
            raise FleetError(f"لا يمكن حذف السيارة لوجود {used} حركة عليها. يمكن إيقافها بدلًا من الحذف.")
        for a in db.scalars(select(VehicleDriverAssignment)
                            .where(VehicleDriverAssignment.vehicle_id == v.id)).all():
            db.delete(a)
        for n in db.scalars(select(FleetMonthlyNote).where(FleetMonthlyNote.vehicle_id == v.id)):
            db.delete(n)
        db.delete(v)
        db.commit()
    except Exception as exc:
        db.rollback()
        _raise(exc)


@router.post("/vehicles/{vehicle_id}/assign")
def assign_vehicle(vehicle_id: int, body: AssignIn, current: CurrentUser = WRITE,
                   db: Session = Depends(get_db)) -> dict:
    try:
        v = svc.get_vehicle(db, current, vehicle_id)
        svc.assign_driver(db, v, body.employee_id, on=body.on or date.today(),
                          odometer=body.odometer, actor_user_id=current.id, notes=body.notes)
        svc.refresh_vehicle(db, v)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = _vehicles_out(db, [v])[0]
    db.commit()
    return out


def _records_out(db: Session, rows, *, consumption: dict | None = None) -> list[dict]:
    codes = svc.vehicle_codes(db, [r.vehicle_id for r in rows])
    names = svc.employee_names(db, [getattr(r, "driver_id", None) for r in rows])
    vouchers = svc.voucher_info(db, [getattr(r, "voucher_id", None) for r in rows])
    approvers = {}
    if rows and hasattr(rows[0], "approved_by_user_id"):
        from src.models.user import User

        approvers = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(
            {r.approved_by_user_id for r in rows if r.approved_by_user_id} or {0}))).all())
    penalties = {}
    if rows and hasattr(rows[0], "penalty_adjustment_id"):
        from src.models.hr_advance import PayrollAdjustment

        ids = {r.penalty_adjustment_id for r in rows if r.penalty_adjustment_id}
        penalties = {a.id: a for a in db.scalars(
            select(PayrollAdjustment).where(PayrollAdjustment.id.in_(ids or {0})))}
    out = []
    for r in rows:
        d = _row(r)
        d["vehicle_code"] = codes.get(r.vehicle_id)
        if hasattr(r, "driver_id"):
            d["driver_name"] = names.get(r.driver_id)
        if hasattr(r, "voucher_id"):
            vi = vouchers.get(r.voucher_id) if r.voucher_id else None
            d["voucher_number"] = vi["number"] if vi else None
            d["voucher_reversed"] = bool(vi and vi["reversed"])
        if hasattr(r, "approved_by_user_id"):
            d["approved_by"] = approvers.get(r.approved_by_user_id)
            d["has_bad"] = any(getattr(r, f) == CheckResult.bad for f in svc.CHECK_FIELDS)
        if hasattr(r, "penalty_adjustment_id"):
            adj = penalties.get(r.penalty_adjustment_id)
            d["penalty_number"] = adj.document_number if adj else None
            d["penalty_cancelled"] = bool(adj and adj.status.value == "cancelled")
        if consumption is not None:
            d.update(consumption.get(r.id, {"distance": None, "km_per_liter": None,
                                            "cost_per_km": None}))
            for k in ("km_per_liter", "cost_per_km"):
                d[k] = _plain(d[k])
        out.append(d)
    return out


@router.get("/vehicles/{vehicle_id}")
def vehicle_detail(vehicle_id: int, current: CurrentUser = READ,
                   db: Session = Depends(get_db)) -> dict:
    try:
        v = svc.get_vehicle(db, current, vehicle_id)
    except Exception as exc:
        _raise(exc)

    def rows(model):
        return db.scalars(select(model).where(model.vehicle_id == v.id)
                          .order_by(model.record_date.desc(), model.id.desc())).all()

    fuel = rows(VehicleFuel)
    assignments = db.scalars(select(VehicleDriverAssignment)
                             .where(VehicleDriverAssignment.vehicle_id == v.id)
                             .order_by(VehicleDriverAssignment.start_date.desc(),
                                       VehicleDriverAssignment.id.desc())).all()
    names = svc.employee_names(db, [a.employee_id for a in assignments])
    out = {
        "vehicle": _vehicles_out(db, [v])[0],
        "assignments": [{**_row(a), "driver_name": names.get(a.employee_id),
                         "km": (a.end_odometer if a.end_odometer is not None else v.odometer)
                         - a.start_odometer if a.start_odometer is not None else None}
                        for a in assignments],
        "maintenance": _records_out(db, rows(VehicleMaintenance)),
        "fuel": _records_out(db, fuel, consumption=svc.fuel_consumption(fuel)),
        "faults": _records_out(db, rows(VehicleFault)),
        "violations": _records_out(db, rows(VehicleViolation)),
        "inspections": _records_out(db, rows(VehicleInspection)),
        "monthly": [{k: _plain(x) for k, x in m.items()} for m in svc.monthly_costs(db, v.id)],
    }
    db.commit()
    return out


class DriverIn(BaseModel):
    employee_id: int
    vehicle_id: int | None = None
    rating: DriverRating | None = None
    status: DriverStatus = DriverStatus.active
    license_number: str | None = None
    license_until: date | None = None
    notes: str | None = None
    assign_date: date | None = None


def _driver_profile(db: Session, current: CurrentUser, driver_id: int) -> DriverProfile:
    p = db.get(DriverProfile, driver_id)
    if p is None or not branch_scope.may_touch_employee(db, current, p.employee_id):
        raise FleetNotFound("السائق غير موجود.")
    return p


def _driver_vehicle(db: Session, employee_id: int) -> Vehicle | None:
    a = db.scalars(select(VehicleDriverAssignment).where(
        VehicleDriverAssignment.employee_id == employee_id,
        VehicleDriverAssignment.end_date.is_(None))).first()
    return db.get(Vehicle, a.vehicle_id) if a else None


def _apply_driver_vehicle(db, current, employee_id, vehicle_id, on):
    old = _driver_vehicle(db, employee_id)
    if (old.id if old else None) == vehicle_id:
        return
    if vehicle_id:
        nv = svc.get_vehicle(db, current, vehicle_id)
        svc.assign_driver(db, nv, employee_id, on=on, odometer=None, actor_user_id=current.id)
        svc.refresh_vehicle(db, nv)
    elif old is not None:
        svc.assign_driver(db, old, None, on=on, odometer=None, actor_user_id=current.id)
        svc.refresh_vehicle(db, old)


def _one_driver(db, current, employee_id) -> dict:
    return next(r for r in svc.driver_rows(db, current) if r["employee_id"] == employee_id)


@router.get("/drivers")
def list_drivers(current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    return [{k: _plain(x) for k, x in r.items()} for r in svc.driver_rows(db, current)]


@router.post("/drivers", status_code=status.HTTP_201_CREATED)
def create_driver(body: DriverIn, current: CurrentUser = WRITE,
                  db: Session = Depends(get_db)) -> dict:
    try:
        if db.get(Employee, body.employee_id) is None or not branch_scope.may_touch_employee(
                db, current, body.employee_id):
            raise FleetNotFound("الموظف غير موجود.")
        if db.scalars(select(DriverProfile).where(
                DriverProfile.employee_id == body.employee_id)).first():
            raise FleetError("هذا الموظف مسجل سائقًا بالفعل.")
        p = DriverProfile(employee_id=body.employee_id, rating=body.rating, status=body.status,
                          license_number=body.license_number, license_until=body.license_until,
                          notes=body.notes, created_by_user_id=current.id)
        db.add(p)
        db.flush()
        _apply_driver_vehicle(db, current, body.employee_id, body.vehicle_id,
                              body.assign_date or date.today())
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = {k: _plain(x) for k, x in _one_driver(db, current, body.employee_id).items()}
    db.commit()
    return out


@router.put("/drivers/{driver_id}")
def update_driver(driver_id: int, body: DriverIn, current: CurrentUser = WRITE,
                  db: Session = Depends(get_db)) -> dict:
    try:
        p = _driver_profile(db, current, driver_id)
        p.rating, p.status = body.rating, body.status
        p.license_number, p.license_until, p.notes = (body.license_number, body.license_until,
                                                      body.notes)
        _touch(p, current)
        _apply_driver_vehicle(db, current, p.employee_id, body.vehicle_id,
                              body.assign_date or date.today())
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = {k: _plain(x) for k, x in _one_driver(db, current, p.employee_id).items()}
    db.commit()
    return out


@router.delete("/drivers/{driver_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_driver(driver_id: int, current: CurrentUser = WRITE,
                  db: Session = Depends(get_db)) -> None:
    try:
        p = _driver_profile(db, current, driver_id)
        _apply_driver_vehicle(db, current, p.employee_id, None, date.today())
        db.delete(p)
        db.commit()
    except Exception as exc:
        db.rollback()
        _raise(exc)


class MaintenanceIn(BaseModel):
    record_date: date
    vehicle_id: int
    odometer: int | None = None
    kind: str | None = None
    work_done: str | None = None
    parts: str | None = None
    cost: Decimal = Decimal("0")
    workshop: str | None = None
    next_maintenance_km: int | None = None
    fault_id: int | None = None
    notes: str | None = None


class FuelIn(BaseModel):
    record_date: date
    vehicle_id: int
    driver_id: int | None = None
    odometer: int | None = None
    liters: Decimal = Decimal("0")
    amount: Decimal = Decimal("0")
    station: str | None = None
    route: str | None = None
    notes: str | None = None


class FaultIn(BaseModel):
    record_date: date
    vehicle_id: int
    driver_id: int | None = None
    odometer: int | None = None
    description: str
    severity: FaultSeverity = FaultSeverity.medium
    action_required: str | None = None
    stopped: bool = False
    downtime_days: Decimal | None = None
    status: FaultStatus = FaultStatus.open
    resolved_date: date | None = None
    cost: Decimal = Decimal("0")
    is_accident: bool = False
    notes: str | None = None


class ViolationIn(BaseModel):
    record_date: date
    vehicle_id: int
    driver_id: int | None = None
    kind: str | None = None
    description: str | None = None
    amount: Decimal = Decimal("0")
    paid: bool = False
    paid_date: date | None = None
    admin_action: str | None = None
    notes: str | None = None


class InspectionIn(BaseModel):
    record_date: date
    vehicle_id: int
    driver_id: int | None = None
    odometer: int | None = None
    fuel: CheckResult | None = None
    oil_water: CheckResult | None = None
    tires: CheckResult | None = None
    brakes: CheckResult | None = None
    lights: CheckResult | None = None
    cleanliness: CheckResult | None = None
    damages: str | None = None
    driver_signed: bool = False
    notes: str | None = None


def _validate_amounts(body) -> None:
    for name in ("cost", "amount", "liters", "downtime_days"):
        v = getattr(body, name, None)
        if v is not None and v < 0:
            raise FleetError("يجب أن تكون القيم موجبة.")
    od = getattr(body, "odometer", None)
    if od is not None and od < 0:
        raise FleetError("يجب أن تكون قراءة العداد موجبة.")


def _fault_rules(row: VehicleFault) -> None:
    if row.status == FaultStatus.resolved:
        row.resolved_date = row.resolved_date or date.today()
        if row.stopped and row.downtime_days is None:
            row.downtime_days = Decimal(max((row.resolved_date - row.record_date).days, 0))
    else:
        row.resolved_date = None


def _maintenance_rules(db: Session, current: CurrentUser, row: VehicleMaintenance) -> None:
    if not row.fault_id:
        return
    fault = svc.get_record(db, current, VehicleFault, row.fault_id)
    if fault.vehicle_id != row.vehicle_id:
        raise FleetError("هذا العطل مسجل على سيارة أخرى.")
    if fault.status != FaultStatus.resolved:
        fault.status = FaultStatus.resolved
        fault.resolved_date = fault.resolved_date or row.record_date
        _fault_rules(fault)


_KINDS = {
    "maintenance": (VehicleMaintenance, MaintenanceIn),
    "fuel": (VehicleFuel, FuelIn),
    "faults": (VehicleFault, FaultIn),
    "violations": (VehicleViolation, ViolationIn),
    "inspections": (VehicleInspection, InspectionIn),
}


def _list(db, current, model, *, vehicle_id, driver_id, date_from, date_to, extra=()):
    stmt = branch_scope.scope(select(model), model, current)
    if vehicle_id:
        stmt = stmt.where(model.vehicle_id == vehicle_id)
    if driver_id and hasattr(model, "driver_id"):
        stmt = stmt.where(model.driver_id == driver_id)
    if date_from:
        stmt = stmt.where(model.record_date >= date_from)
    if date_to:
        stmt = stmt.where(model.record_date <= date_to)
    for cond in extra:
        stmt = stmt.where(cond)
    rows = db.scalars(stmt.order_by(model.record_date.desc(), model.id.desc())).all()
    if model is VehicleFuel:
        vids = {r.vehicle_id for r in rows}
        allf = db.scalars(select(VehicleFuel).where(VehicleFuel.vehicle_id.in_(vids or {0}))).all()
        by_v: dict[int, list] = {}
        for f in allf:
            by_v.setdefault(f.vehicle_id, []).append(f)
        cons = {}
        for lst in by_v.values():
            cons.update(svc.fuel_consumption(lst))
        return _records_out(db, rows, consumption=cons)
    return _records_out(db, rows)


def _create(kind: str, body, db: Session, current: CurrentUser) -> dict:
    model, _schema = _KINDS[kind]
    try:
        _validate_amounts(body)
        v = svc.get_vehicle(db, current, body.vehicle_id)
        data = body.model_dump()
        row = model(**data, branch_id=v.branch_id, created_by_user_id=current.id)
        if hasattr(row, "driver_id") and not row.driver_id:
            row.driver_id = svc.driver_on(db, v, row.record_date)
        if model is VehicleInspection:
            dup = db.scalar(select(VehicleInspection.id).where(
                VehicleInspection.vehicle_id == v.id,
                VehicleInspection.record_date == row.record_date))
            if dup:
                raise FleetError("يوجد فحص مسجل لهذه السيارة في اليوم نفسه.")
        if model is VehicleFault:
            _fault_rules(row)
        db.add(row)
        db.flush()
        if model is VehicleMaintenance:
            _maintenance_rules(db, current, row)
        svc.refresh_vehicle(db, v)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = _records_out(db, [row])[0]
    db.commit()
    return out


def _update(kind: str, record_id: int, body, db: Session, current: CurrentUser) -> dict:
    model, _schema = _KINDS[kind]
    try:
        _validate_amounts(body)
        row = svc.get_record(db, current, model, record_id)
        old_vehicle = row.vehicle_id
        v = svc.get_vehicle(db, current, body.vehicle_id)
        if model is VehicleInspection:
            dup = db.scalar(select(VehicleInspection.id).where(
                VehicleInspection.vehicle_id == v.id,
                VehicleInspection.record_date == body.record_date,
                VehicleInspection.id != row.id))
            if dup:
                raise FleetError("يوجد فحص مسجل لهذه السيارة في اليوم نفسه.")
            row.approved_by_user_id = None
            row.approved_at = None
        for k, x in body.model_dump().items():
            setattr(row, k, x)
        row.branch_id = v.branch_id
        if hasattr(row, "driver_id") and not row.driver_id:
            row.driver_id = svc.driver_on(db, v, row.record_date)
        if model is VehicleFault:
            _fault_rules(row)
        if model is VehicleMaintenance:
            _maintenance_rules(db, current, row)
        _touch(row, current)
        svc.refresh_vehicle(db, v)
        if old_vehicle != v.id:
            svc.refresh_vehicle(db, db.get(Vehicle, old_vehicle))
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = _records_out(db, [row])[0]
    db.commit()
    return out


def _delete(kind: str, record_id: int, db: Session, current: CurrentUser) -> None:
    model, _schema = _KINDS[kind]
    try:
        row = svc.get_record(db, current, model, record_id)
        if getattr(row, "voucher_id", None) and svc.voucher_live(db, row.voucher_id):
            raise FleetError("السجل مرتبط بسند مصروف. يجب عكس السند أو إلغاء الربط أولًا.")
        if getattr(row, "penalty_adjustment_id", None):
            from src.models.hr_advance import AdjustmentStatus, PayrollAdjustment

            adj = db.get(PayrollAdjustment, row.penalty_adjustment_id)
            if adj is not None and adj.status != AdjustmentStatus.cancelled:
                raise FleetError(f"المخالفة عليها جزاء في الرواتب ({adj.document_number}). يجب إلغاء الجزاء أولًا.")
        if model is VehicleFault:
            for m in db.scalars(select(VehicleMaintenance)
                                .where(VehicleMaintenance.fault_id == row.id)).all():
                m.fault_id = None
        v = db.get(Vehicle, row.vehicle_id)
        db.delete(row)
        svc.refresh_vehicle(db, v)
        db.commit()
    except Exception as exc:
        db.rollback()
        _raise(exc)


@router.get("/maintenance")
def list_maintenance(vehicle_id: int | None = None, date_from: date | None = None,
                     date_to: date | None = None, current: CurrentUser = READ,
                     db: Session = Depends(get_db)) -> list[dict]:
    return _list(db, current, VehicleMaintenance, vehicle_id=vehicle_id, driver_id=None,
                 date_from=date_from, date_to=date_to)


@router.post("/maintenance", status_code=status.HTTP_201_CREATED)
def create_maintenance(body: MaintenanceIn, current: CurrentUser = WRITE,
                       db: Session = Depends(get_db)) -> dict:
    return _create("maintenance", body, db, current)


@router.put("/maintenance/{record_id}")
def update_maintenance(record_id: int, body: MaintenanceIn, current: CurrentUser = WRITE,
                       db: Session = Depends(get_db)) -> dict:
    return _update("maintenance", record_id, body, db, current)


@router.delete("/maintenance/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_maintenance(record_id: int, current: CurrentUser = WRITE,
                       db: Session = Depends(get_db)) -> None:
    _delete("maintenance", record_id, db, current)


@router.get("/fuel")
def list_fuel(vehicle_id: int | None = None, driver_id: int | None = None,
              date_from: date | None = None, date_to: date | None = None,
              current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    return _list(db, current, VehicleFuel, vehicle_id=vehicle_id, driver_id=driver_id,
                 date_from=date_from, date_to=date_to)


@router.post("/fuel", status_code=status.HTTP_201_CREATED)
def create_fuel(body: FuelIn, current: CurrentUser = WRITE, db: Session = Depends(get_db)) -> dict:
    return _create("fuel", body, db, current)


@router.put("/fuel/{record_id}")
def update_fuel(record_id: int, body: FuelIn, current: CurrentUser = WRITE,
                db: Session = Depends(get_db)) -> dict:
    return _update("fuel", record_id, body, db, current)


@router.delete("/fuel/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fuel(record_id: int, current: CurrentUser = WRITE,
                db: Session = Depends(get_db)) -> None:
    _delete("fuel", record_id, db, current)


@router.get("/faults")
def list_faults(vehicle_id: int | None = None, driver_id: int | None = None,
                date_from: date | None = None, date_to: date | None = None,
                status_filter: FaultStatus | None = Query(None, alias="status"),
                open_only: bool = False,
                current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    extra = []
    if status_filter:
        extra.append(VehicleFault.status == status_filter)
    if open_only:
        extra.append(VehicleFault.status != FaultStatus.resolved)
    return _list(db, current, VehicleFault, vehicle_id=vehicle_id, driver_id=driver_id,
                 date_from=date_from, date_to=date_to, extra=extra)


@router.post("/faults", status_code=status.HTTP_201_CREATED)
def create_fault(body: FaultIn, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> dict:
    return _create("faults", body, db, current)


@router.put("/faults/{record_id}")
def update_fault(record_id: int, body: FaultIn, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> dict:
    return _update("faults", record_id, body, db, current)


@router.delete("/faults/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fault(record_id: int, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> None:
    _delete("faults", record_id, db, current)


class PenaltyIn(BaseModel):
    amount: Decimal | None = None
    year: int
    month: int
    reason: str | None = None


@router.get("/violations")
def list_violations(vehicle_id: int | None = None, driver_id: int | None = None,
                    date_from: date | None = None, date_to: date | None = None,
                    paid: bool | None = None,
                    current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    extra = [VehicleViolation.paid.is_(paid)] if paid is not None else []
    return _list(db, current, VehicleViolation, vehicle_id=vehicle_id, driver_id=driver_id,
                 date_from=date_from, date_to=date_to, extra=extra)


@router.post("/violations", status_code=status.HTTP_201_CREATED)
def create_violation(body: ViolationIn, current: CurrentUser = WRITE,
                     db: Session = Depends(get_db)) -> dict:
    return _create("violations", body, db, current)


@router.put("/violations/{record_id}")
def update_violation(record_id: int, body: ViolationIn, current: CurrentUser = WRITE,
                     db: Session = Depends(get_db)) -> dict:
    return _update("violations", record_id, body, db, current)


@router.delete("/violations/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_violation(record_id: int, current: CurrentUser = WRITE,
                     db: Session = Depends(get_db)) -> None:
    _delete("violations", record_id, db, current)


@router.post("/violations/{record_id}/penalty")
def violation_penalty(record_id: int, body: PenaltyIn, current: CurrentUser = WRITE,
                      db: Session = Depends(get_db)) -> dict:
    if not current.can(CAP_PAYROLL_POST):
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "تسجيل الجزاء يتطلب صلاحية ترحيل الرواتب."})
    try:
        svc.violation_penalty(db, current, violation_id=record_id, amount=body.amount,
                              year=body.year, month=body.month, reason=body.reason)
        row = db.get(VehicleViolation, record_id)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = _records_out(db, [row])[0]
    db.commit()
    return out


class InspectionBulkIn(BaseModel):
    record_date: date
    rows: list[InspectionIn]


class ApproveIn(BaseModel):
    ids: list[int]
    approve: bool = True


@router.get("/inspections")
def list_inspections(vehicle_id: int | None = None, driver_id: int | None = None,
                     date_from: date | None = None, date_to: date | None = None,
                     approved: bool | None = None,
                     current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    extra = []
    if approved is True:
        extra.append(VehicleInspection.approved_at.is_not(None))
    elif approved is False:
        extra.append(VehicleInspection.approved_at.is_(None))
    return _list(db, current, VehicleInspection, vehicle_id=vehicle_id, driver_id=driver_id,
                 date_from=date_from, date_to=date_to, extra=extra)


@router.post("/inspections", status_code=status.HTTP_201_CREATED)
def create_inspection(body: InspectionIn, current: CurrentUser = WRITE,
                      db: Session = Depends(get_db)) -> dict:
    return _create("inspections", body, db, current)


@router.put("/inspections/{record_id}")
def update_inspection(record_id: int, body: InspectionIn, current: CurrentUser = WRITE,
                      db: Session = Depends(get_db)) -> dict:
    return _update("inspections", record_id, body, db, current)


@router.delete("/inspections/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inspection(record_id: int, current: CurrentUser = WRITE,
                      db: Session = Depends(get_db)) -> None:
    _delete("inspections", record_id, db, current)


@router.post("/inspections/bulk")
def bulk_inspections(body: InspectionBulkIn, current: CurrentUser = WRITE,
                     db: Session = Depends(get_db)) -> dict:
    created = updated = 0
    touched: set[int] = set()
    try:
        for r in body.rows:
            filled = r.odometer is not None or r.damages or any(
                getattr(r, f) for f in svc.CHECK_FIELDS)
            if not filled:
                continue
            _validate_amounts(r)
            v = svc.get_vehicle(db, current, r.vehicle_id)
            data = r.model_dump()
            data["record_date"] = body.record_date
            row = db.scalars(select(VehicleInspection).where(
                VehicleInspection.vehicle_id == v.id,
                VehicleInspection.record_date == body.record_date)).first()
            if row is None:
                row = VehicleInspection(**data, branch_id=v.branch_id,
                                        created_by_user_id=current.id)
                db.add(row)
                created += 1
            else:
                for k, x in data.items():
                    setattr(row, k, x)
                row.approved_by_user_id = None
                row.approved_at = None
                _touch(row, current)
                updated += 1
            if not row.driver_id:
                row.driver_id = svc.driver_on(db, v, body.record_date)
            touched.add(v.id)
        db.flush()
        for vid in touched:
            svc.refresh_vehicle(db, db.get(Vehicle, vid))
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, {"code": "conflict", "message": "تعذر حفظ الفحص بسبب تعارض. أعد المحاولة."}) from exc
    except Exception as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"created": created, "updated": updated}


@router.post("/inspections/approve")
def approve_inspections(body: ApproveIn, current: CurrentUser = WRITE,
                        db: Session = Depends(get_db)) -> dict:
    n = 0
    try:
        for rid in body.ids:
            row = svc.get_record(db, current, VehicleInspection, rid)
            if body.approve:
                if row.approved_at is None:
                    row.approved_by_user_id, row.approved_at = current.id, datetime.now()
                    n += 1
            elif row.approved_at is not None:
                row.approved_by_user_id, row.approved_at = None, None
                n += 1
    except Exception as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"changed": n}


class ExpenseIn(BaseModel):
    source: str
    record_id: int
    expense_account_id: int
    treasury_id: int | None = None
    amount: Decimal
    voucher_date: date | None = None
    description: str | None = None
    cost_center_id: int | None = None


class LinkIn(BaseModel):
    source: str
    record_id: int
    voucher_id: int | None = None


def _source(source: str) -> str:
    if source not in svc.MONEY_SOURCES:
        raise HTTPException(422, {"code": "validation", "message": "نوع السجل غير معروف."})
    return source


@router.get("/expense/suggest")
def expense_suggest(source: str, record_id: int, current: CurrentUser = READ,
                    db: Session = Depends(get_db)) -> dict:
    model, col, label = svc.MONEY_SOURCES[_source(source)]
    try:
        row = svc.get_record(db, current, model, record_id)
    except Exception as exc:
        _raise(exc)
    v = db.get(Vehicle, row.vehicle_id)
    extra = ""
    if source == "fuel" and row.liters:
        extra = f" — {Decimal(str(row.liters)).normalize():f} لتر"
    elif source == "violation" and row.kind:
        extra = f" — {row.kind}"
    elif source == "maintenance" and row.kind:
        extra = f" — {row.kind}"
    return {
        "expense_account_id": svc.suggest_account(db, source, v),
        "amount": str(getattr(row, col) or 0),
        "voucher_date": row.record_date,
        "description": f"{label} سيارة {v.code}{extra} ({row.record_date.isoformat()})",
        "cost_center_id": v.cost_center_id,
        "linked": svc.voucher_live(db, row.voucher_id),
    }


@router.post("/expense")
def post_expense(body: ExpenseIn, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> dict:
    _source(body.source)
    if not current.can(CAP_VOUCHER_WRITE) or current.role == RoleName.sales_rep:
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "تسجيل المصروف يتطلب صلاحية كتابة السندات."})
    try:
        v = svc.post_expense(db, current, source=body.source, record_id=body.record_id,
                             expense_account_id=body.expense_account_id,
                             treasury_id=body.treasury_id, amount=body.amount,
                             voucher_date=body.voucher_date or date.today(),
                             description=body.description, cost_center_id=body.cost_center_id)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    out = {"voucher_id": v.id, "document_number": v.document_number}
    db.commit()
    return out


@router.post("/link-voucher")
def link_voucher(body: LinkIn, current: CurrentUser = WRITE,
                 db: Session = Depends(get_db)) -> dict:
    _source(body.source)
    try:
        svc.link_voucher(db, current, source=body.source, record_id=body.record_id,
                         voucher_id=body.voucher_id)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"ok": True}


@router.get("/vouchers")
def linkable_vouchers(current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    reversed_ids = select(Voucher.reverses_id).where(Voucher.reverses_id.is_not(None))
    linked = set()
    for model, _c, _l in svc.MONEY_SOURCES.values():
        linked |= set(db.scalars(select(model.voucher_id).where(model.voucher_id.is_not(None))))
    stmt = branch_scope.scope(
        select(Voucher).where(Voucher.kind == VoucherKind.expense, Voucher.reverses_id.is_(None),
                              Voucher.id.not_in(reversed_ids)), Voucher, current)
    rows = db.scalars(stmt.order_by(Voucher.voucher_date.desc(), Voucher.id.desc()).limit(400)).all()
    accounts = dict(db.execute(select(Account.id, Account.name).where(
        Account.id.in_({r.party_account_id for r in rows} or {0}))).all())
    return [{"id": r.id, "document_number": r.document_number, "voucher_date": r.voucher_date,
             "amount": str(r.amount), "account_name": accounts.get(r.party_account_id),
             "description": r.description} for r in rows if r.id not in linked]


class NoteIn(BaseModel):
    vehicle_id: int
    year: int
    month: int
    note: str | None = None


@router.get("/reports/monthly")
def report_monthly(year: int, month: int, current: CurrentUser = READ,
                   db: Session = Depends(get_db)) -> dict:
    try:
        out = svc.monthly_report(db, current, year, month)
    except Exception as exc:
        _raise(exc)
    out["rows"] = [{k: _plain(x) for k, x in r.items()} for r in out["rows"]]
    out["fleet_km_per_liter"] = _plain(out["fleet_km_per_liter"])
    db.commit()
    return out


@router.put("/reports/monthly/note")
def report_note(body: NoteIn, current: CurrentUser = WRITE, db: Session = Depends(get_db)) -> dict:
    try:
        svc.set_monthly_note(db, current, body.vehicle_id, body.year, body.month,
                             (body.note or "").strip() or None)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"ok": True}


class TaskIn(BaseModel):
    period: TaskPeriod
    title: str
    details: str | None = None
    sort_order: int = 0
    active: bool = True


class TaskDoneIn(BaseModel):
    on: date | None = None
    done: bool = True
    notes: str | None = None


@router.get("/tasks")
def list_tasks(on: date | None = None, current: CurrentUser = READ,
               db: Session = Depends(get_db)) -> list[dict]:
    svc.ensure_default_tasks(db)
    out = svc.tasks_for(db, current, on or date.today())
    db.commit()
    return out


@router.post("/tasks", status_code=status.HTTP_201_CREATED)
def create_task(body: TaskIn, current: CurrentUser = WRITE, db: Session = Depends(get_db)) -> dict:
    if not body.title.strip():
        raise HTTPException(422, {"code": "validation", "message": "اسم المهمة مطلوب."})
    t = FleetTask(period=body.period, title=body.title.strip(), details=body.details,
                  sort_order=body.sort_order, active=body.active,
                  branch_id=branch_scope.visible_branch_id(current),
                  created_by_user_id=current.id)
    db.add(t)
    db.commit()
    return _row(t)


def _task(db: Session, current: CurrentUser, task_id: int) -> FleetTask:
    t = db.get(FleetTask, task_id)
    if t is None or not branch_scope.may_see(current, t):
        raise HTTPException(404, {"code": "not_found", "message": "المهمة غير موجودة."})
    if t.branch_id is None and not branch_scope.sees_all_branches(current):
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "لا يمكن تعديل مهام الشركة إلا من الإدارة."})
    return t


@router.put("/tasks/{task_id}")
def update_task(task_id: int, body: TaskIn, current: CurrentUser = WRITE,
                db: Session = Depends(get_db)) -> dict:
    t = _task(db, current, task_id)
    t.period, t.title, t.details = body.period, body.title.strip(), body.details
    t.sort_order, t.active = body.sort_order, body.active
    _touch(t, current)
    db.commit()
    return _row(t)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, current: CurrentUser = WRITE, db: Session = Depends(get_db)) -> None:
    t = _task(db, current, task_id)
    for lg in db.scalars(select(FleetTaskLog).where(FleetTaskLog.task_id == t.id)).all():
        db.delete(lg)
    db.delete(t)
    db.commit()


@router.post("/tasks/{task_id}/done")
def task_done(task_id: int, body: TaskDoneIn, current: CurrentUser = WRITE,
              db: Session = Depends(get_db)) -> dict:
    try:
        svc.mark_task(db, current, task_id, body.on or date.today(), body.done, body.notes)
    except Exception as exc:
        db.rollback()
        _raise(exc)
    db.commit()
    return {"ok": True}


@router.get("/tasks/log")
def tasks_log(date_from: date | None = None, date_to: date | None = None,
              current: CurrentUser = READ, db: Session = Depends(get_db)) -> list[dict]:
    return svc.task_log(db, current, date_from, date_to)
