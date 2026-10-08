from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select, union_all
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser
from src.models.ledger import Account
from src.models.employee import Employee
from src.models.fleet import (
    CheckResult,
    DriverProfile,
    FaultSeverity,
    FaultStatus,
    FleetMonthlyNote,
    FleetSetting,
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
from src.models.voucher import Voucher, VoucherKind

ZERO = Decimal("0")


class FleetError(Exception):
    pass


class FleetNotFound(FleetError):
    pass


STATUS_LABELS = {
    VehicleStatus.good: "جيدة",
    VehicleStatus.attention: "تحتاج متابعة",
    VehicleStatus.maintenance_due: "تحتاج صيانة",
    VehicleStatus.stopped: "متوقفة",
}

CHECK_FIELDS = ("fuel", "oil_water", "tires", "brakes", "lights", "cleanliness")

MONEY_SOURCES = {
    "maintenance": (VehicleMaintenance, "cost", "صيانة"),
    "fuel": (VehicleFuel, "amount", "وقود"),
    "fault": (VehicleFault, "cost", "إصلاح عطل"),
    "violation": (VehicleViolation, "amount", "مخالفة"),
}

_ACCOUNT_WORDS = {
    "fuel": ("سولار", "بنزين", "وقود"),
    "maintenance": ("صيان", "قطع غيار"),
    "fault": ("صيان", "قطع غيار"),
    "violation": ("مخالف",),
}


def settings(db: Session) -> FleetSetting:
    row = db.scalars(select(FleetSetting).order_by(FleetSetting.id)).first()
    if row is None:
        row = FleetSetting(expiry_alert_days=30, maintenance_alert_km=500, fuel_abnormal_pct=20)
        db.add(row)
        db.flush()
    return row


def employee_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(Employee.id, Employee.name).where(Employee.id.in_(ids))).all())


def vehicle_codes(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict(db.execute(select(Vehicle.id, Vehicle.code).where(Vehicle.id.in_(ids))).all())


def get_vehicle(db: Session, current: CurrentUser, vehicle_id: int) -> Vehicle:
    v = db.get(Vehicle, vehicle_id)
    if v is None or not branch_scope.may_see(current, v):
        raise FleetNotFound("السيارة غير موجودة.")
    return v


def get_record(db: Session, current: CurrentUser, model, record_id: int):
    row = db.get(model, record_id)
    if row is None or not branch_scope.may_see(current, row):
        raise FleetNotFound("السجل غير موجود.")
    return row


def new_branch_id(db: Session, current: CurrentUser, requested: int | None) -> int | None:
    if branch_scope.sees_all_branches(current):
        return requested or branch_scope.visible_branch_id(current) or current.branch_id
    return current.branch_id


def driver_on(db: Session, vehicle: Vehicle, on: date) -> int | None:
    row = db.scalars(
        select(VehicleDriverAssignment)
        .where(VehicleDriverAssignment.vehicle_id == vehicle.id,
               VehicleDriverAssignment.start_date <= on,
               or_(VehicleDriverAssignment.end_date.is_(None),
                   VehicleDriverAssignment.end_date >= on))
        .order_by(VehicleDriverAssignment.start_date.desc(), VehicleDriverAssignment.id.desc())
    ).first()
    return row.employee_id if row else vehicle.current_driver_id


def _readings(vehicle_ids=None):
    parts = []
    for model in (VehicleFuel, VehicleMaintenance, VehicleFault, VehicleInspection):
        q = select(model.vehicle_id.label("vehicle_id"), model.record_date.label("record_date"),
                   model.odometer.label("odometer")).where(model.odometer.is_not(None))
        if vehicle_ids is not None:
            q = q.where(model.vehicle_id.in_(vehicle_ids))
        parts.append(q)
    return union_all(*parts).subquery()


def _open_fault_map(db: Session, vehicle_ids) -> dict[int, dict]:
    out: dict[int, dict] = {}
    if not vehicle_ids:
        return out
    rows = db.execute(
        select(VehicleFault.vehicle_id, VehicleFault.stopped, VehicleFault.severity)
        .where(VehicleFault.vehicle_id.in_(vehicle_ids),
               VehicleFault.status != FaultStatus.resolved)
    ).all()
    for vid, stopped, severity in rows:
        d = out.setdefault(vid, {"count": 0, "stopped": False, "critical": False})
        d["count"] += 1
        d["stopped"] = d["stopped"] or bool(stopped)
        d["critical"] = d["critical"] or severity in (FaultSeverity.critical, FaultSeverity.high)
    return out


def _bad_inspection_set(db: Session, vehicle_ids, today: date) -> set[int]:
    if not vehicle_ids:
        return set()
    rows = db.scalars(
        select(VehicleInspection)
        .where(VehicleInspection.vehicle_id.in_(vehicle_ids),
               VehicleInspection.record_date >= today - timedelta(days=7))
        .order_by(VehicleInspection.record_date.desc(), VehicleInspection.id.desc())
    ).all()
    seen: set[int] = set()
    bad: set[int] = set()
    for r in rows:
        if r.vehicle_id in seen:
            continue
        seen.add(r.vehicle_id)
        if any(getattr(r, f) == CheckResult.bad for f in CHECK_FIELDS):
            bad.add(r.vehicle_id)
    return bad


def vehicle_states(db: Session, vehicles: list[Vehicle], today: date | None = None) -> dict[int, dict]:
    today = today or date.today()
    cfg = settings(db)
    ids = [v.id for v in vehicles]
    faults = _open_fault_map(db, ids)
    bad = _bad_inspection_set(db, ids, today)
    out: dict[int, dict] = {}
    for v in vehicles:
        reasons: list[str] = []
        f = faults.get(v.id, {"count": 0, "stopped": False, "critical": False})
        km_left = (v.next_maintenance_km - v.odometer) if v.next_maintenance_km else None
        due = km_left is not None and km_left <= cfg.maintenance_alert_km
        expired = [n for n, d in (("التأمين منتهي", v.insurance_until),
                                  ("الرخصة منتهية", v.license_until)) if d and d < today]
        if f["stopped"]:
            auto = VehicleStatus.stopped
            reasons.append("عطل مفتوح أوقف السيارة")
        elif due:
            auto = VehicleStatus.maintenance_due
        elif f["count"] or expired or v.id in bad:
            auto = VehicleStatus.attention
        else:
            auto = VehicleStatus.good
        if due:
            reasons.append(f"تجاوزت موعد الصيانة بـ {-km_left:,} كم" if km_left < 0
                           else f"متبقٍ {km_left:,} كم على الصيانة")
        if f["count"] and not f["stopped"]:
            reasons.append(f"أعطال مفتوحة: {f['count']}")
        reasons.extend(expired)
        if v.id in bad:
            reasons.append("آخر فحص به بند غير سليم")
        out[v.id] = {
            "auto_status": auto,
            "status": v.status_override or auto,
            "reasons": reasons,
            "open_faults": f["count"],
            "km_to_maintenance": km_left,
        }
    return out


def refresh_vehicle(db: Session, vehicle: Vehicle) -> None:
    db.flush()
    r = _readings([vehicle.id])
    top = db.scalar(select(func.max(r.c.odometer)))
    vehicle.odometer = max(int(vehicle.odometer_base or 0), int(top or 0))
    latest = db.scalars(
        select(VehicleMaintenance)
        .where(VehicleMaintenance.vehicle_id == vehicle.id)
        .order_by(VehicleMaintenance.record_date.desc(),
                  VehicleMaintenance.odometer.desc().nulls_last(), VehicleMaintenance.id.desc())
    ).first()
    if latest is not None:
        if latest.odometer is not None:
            vehicle.last_maintenance_km = latest.odometer
        if latest.next_maintenance_km:
            vehicle.next_maintenance_km = latest.next_maintenance_km
    vehicle.status = vehicle_states(db, [vehicle])[vehicle.id]["status"]
    db.flush()


def ensure_profile(db: Session, employee_id: int, actor_user_id: int | None) -> DriverProfile:
    prof = db.scalars(select(DriverProfile).where(DriverProfile.employee_id == employee_id)).first()
    if prof is None:
        prof = DriverProfile(employee_id=employee_id, created_by_user_id=actor_user_id)
        db.add(prof)
        db.flush()
    return prof


def assign_driver(db: Session, vehicle: Vehicle, employee_id: int | None, *, on: date,
                  odometer: int | None, actor_user_id: int, notes: str | None = None) -> None:
    if employee_id is not None and db.get(Employee, employee_id) is None:
        raise FleetNotFound("الموظف غير موجود.")
    reading = odometer if odometer is not None else vehicle.odometer
    open_rows = db.scalars(
        select(VehicleDriverAssignment).where(VehicleDriverAssignment.vehicle_id == vehicle.id,
                                              VehicleDriverAssignment.end_date.is_(None))).all()
    if employee_id is not None and any(a.employee_id == employee_id for a in open_rows):
        vehicle.current_driver_id = employee_id
        return
    now = datetime.now()
    for a in open_rows:
        if on < a.start_date:
            raise FleetError("تاريخ التسليم يسبق تاريخ استلام السائق الحالي.")
        a.end_date = on
        a.end_odometer = reading
        a.updated_at, a.updated_by_user_id = now, actor_user_id
    if employee_id is not None:
        others = db.scalars(
            select(VehicleDriverAssignment).where(VehicleDriverAssignment.employee_id == employee_id,
                                                  VehicleDriverAssignment.end_date.is_(None))).all()
        for a in others:
            a.end_date = max(on, a.start_date)
            a.updated_at, a.updated_by_user_id = now, actor_user_id
            other = db.get(Vehicle, a.vehicle_id)
            if other is not None and other.current_driver_id == employee_id:
                other.current_driver_id = None
                a.end_odometer = other.odometer
        db.add(VehicleDriverAssignment(
            branch_id=vehicle.branch_id, vehicle_id=vehicle.id, employee_id=employee_id,
            start_date=on, start_odometer=reading, notes=notes, created_by_user_id=actor_user_id))
        ensure_profile(db, employee_id, actor_user_id)
    vehicle.current_driver_id = employee_id
    db.flush()


def driver_rows(db: Session, current: CurrentUser) -> list[dict]:
    stmt = select(DriverProfile)
    stmt = branch_scope.scope_by_employee(stmt, DriverProfile.employee_id, current)
    profiles = db.scalars(stmt).all()
    emp_ids = [p.employee_id for p in profiles]
    if not emp_ids:
        return []
    emps = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_(emp_ids))).all()}
    open_asg = {a.employee_id: a for a in db.scalars(
        select(VehicleDriverAssignment).where(VehicleDriverAssignment.employee_id.in_(emp_ids),
                                              VehicleDriverAssignment.end_date.is_(None))).all()}
    vehicles = {v.id: v for v in db.scalars(
        select(Vehicle).where(Vehicle.id.in_({a.vehicle_id for a in open_asg.values()} or {0})))}
    accidents = dict(db.execute(
        select(VehicleFault.driver_id, func.count()).where(VehicleFault.driver_id.in_(emp_ids),
                                                           VehicleFault.is_accident.is_(True))
        .group_by(VehicleFault.driver_id)).all())
    faults = dict(db.execute(
        select(VehicleFault.driver_id, func.count()).where(VehicleFault.driver_id.in_(emp_ids))
        .group_by(VehicleFault.driver_id)).all())
    viol = {d: (n, s, u) for d, n, s, u in db.execute(
        select(VehicleViolation.driver_id, func.count(), func.coalesce(func.sum(VehicleViolation.amount), 0),
               func.count().filter(VehicleViolation.paid.is_(False)))
        .where(VehicleViolation.driver_id.in_(emp_ids)).group_by(VehicleViolation.driver_id)).all()}
    out = []
    for p in profiles:
        e = emps.get(p.employee_id)
        a = open_asg.get(p.employee_id)
        v = vehicles.get(a.vehicle_id) if a else None
        n, s, u = viol.get(p.employee_id, (0, 0, 0))
        out.append({
            "id": p.id, "employee_id": p.employee_id,
            "name": e.name if e else "", "code": e.code if e else "",
            "phone": e.phone if e else None, "hire_date": e.hire_date if e else None,
            "branch_id": e.branch_id if e else None,
            "employee_active": bool(e.active) if e else False,
            "vehicle_id": v.id if v else None, "vehicle_code": v.code if v else None,
            "assigned_since": a.start_date if a else None,
            "start_odometer": a.start_odometer if a else None,
            "current_odometer": v.odometer if v else None,
            "km_driven": (v.odometer - a.start_odometer) if (v and a and a.start_odometer is not None) else None,
            "accidents": int(accidents.get(p.employee_id, 0)),
            "faults": int(faults.get(p.employee_id, 0)),
            "violations": int(n), "violations_amount": Decimal(str(s)), "unpaid_violations": int(u),
            "rating": p.rating.value if p.rating else None, "status": p.status.value,
            "license_number": p.license_number, "license_until": p.license_until,
            "notes": p.notes,
        })
    out.sort(key=lambda r: r["name"])
    return out


def voucher_live(db: Session, voucher_id: int | None) -> bool:
    if not voucher_id:
        return False
    v = db.get(Voucher, voucher_id)
    if v is None or v.reverses_id is not None:
        return False
    return db.scalar(select(func.count()).select_from(Voucher)
                     .where(Voucher.reverses_id == voucher_id)) == 0


def voucher_info(db: Session, ids) -> dict[int, dict]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = db.scalars(select(Voucher).where(Voucher.id.in_(ids))).all()
    reversed_ids = set(db.scalars(select(Voucher.reverses_id).where(Voucher.reverses_id.in_(ids))))
    return {v.id: {"number": v.document_number, "amount": v.amount,
                   "reversed": v.id in reversed_ids} for v in rows}


def suggest_account(db: Session, source: str, vehicle: Vehicle) -> int | None:
    if source == "fuel" and vehicle.fuel_account_id:
        return vehicle.fuel_account_id
    if source in ("maintenance", "fault") and vehicle.maintenance_account_id:
        return vehicle.maintenance_account_id
    words = _ACCOUNT_WORDS.get(source, ())
    if not words:
        return None
    rows = db.scalars(select(Account).where(
        Account.is_postable.is_(True), Account.active.is_(True),
        or_(*[Account.name.contains(w) for w in words]))).all()
    if not rows:
        return None
    hints = [h for h in (vehicle.code, vehicle.kind, vehicle.plate_number) if h]

    def score(a: Account) -> tuple:
        name = a.name or ""
        return (sum(1 for h in hints if h and h in name), "سيار" in name, -(a.id or 0))

    return max(rows, key=score).id


def _assert_unlinked(db: Session, row) -> None:
    if voucher_live(db, row.voucher_id):
        raise FleetError("هذا السجل مرتبط بسند مصروف بالفعل. يجب عكس السند أو إلغاء الربط أولًا.")


def post_expense(db: Session, current: CurrentUser, *, source: str, record_id: int,
                 expense_account_id: int, treasury_id: int | None, amount, voucher_date: date,
                 description: str | None, cost_center_id: int | None) -> Voucher:
    from src.services import voucher_service

    model, _col, label = MONEY_SOURCES[source]
    row = get_record(db, current, model, record_id)
    _assert_unlinked(db, row)
    vehicle = db.get(Vehicle, row.vehicle_id)
    text = description or f"{label} — سيارة {vehicle.code}"
    v = voucher_service.create_expense(
        db, expense_account_id=expense_account_id, amount=amount, actor_user_id=current.id,
        actor_role=current.role, voucher_date=voucher_date, description=text,
        reference=f"FLEET-{source}-{row.id}", treasury_id=treasury_id,
        cost_center_id=cost_center_id or vehicle.cost_center_id, statement1=text[:200])
    row.voucher_id = v.id
    if source == "violation":
        row.paid = True
        row.paid_date = row.paid_date or voucher_date
    row.updated_at, row.updated_by_user_id = datetime.now(), current.id
    db.flush()
    return v


def _linked_elsewhere(db: Session, voucher_id: int, source: str, record_id: int) -> bool:
    for key, (model, _c, _l) in MONEY_SOURCES.items():
        q = select(func.count()).select_from(model).where(model.voucher_id == voucher_id)
        if key == source:
            q = q.where(model.id != record_id)
        if db.scalar(q):
            return True
    return False


def link_voucher(db: Session, current: CurrentUser, *, source: str, record_id: int,
                 voucher_id: int | None) -> None:
    model, _col, _label = MONEY_SOURCES[source]
    row = get_record(db, current, model, record_id)
    if voucher_id is not None:
        v = db.get(Voucher, voucher_id)
        if v is None or not branch_scope.may_see(current, v):
            raise FleetNotFound("السند غير موجود.")
        if v.kind != VoucherKind.expense:
            raise FleetError("يجب أن يكون السند سند مصروف.")
        if not voucher_live(db, voucher_id):
            raise FleetError("هذا السند معكوس.")
        if _linked_elsewhere(db, voucher_id, source, record_id):
            raise FleetError("هذا السند مرتبط بسجل آخر في إدارة السيارات.")
        if source == "violation":
            row.paid = True
            row.paid_date = row.paid_date or v.voucher_date
    row.voucher_id = voucher_id
    row.updated_at, row.updated_by_user_id = datetime.now(), current.id
    db.flush()


def violation_penalty(db: Session, current: CurrentUser, *, violation_id: int, amount,
                      year: int, month: int, reason: str | None):
    from src.models.hr_advance import AdjustmentKind, AdjustmentStatus, PayrollAdjustment
    from src.services import advance_service

    row = get_record(db, current, VehicleViolation, violation_id)
    if not row.driver_id:
        raise FleetError("لم يُحدَّد سائق لهذه المخالفة. يجب تحديد السائق أولًا.")
    if row.penalty_adjustment_id:
        old = db.get(PayrollAdjustment, row.penalty_adjustment_id)
        if old is not None and old.status != AdjustmentStatus.cancelled:
            raise FleetError(f"سُجِّل جزاء على هذه المخالفة من قبل ({old.document_number}).")
    vehicle = db.get(Vehicle, row.vehicle_id)
    adj = advance_service.create_adjustment(
        db, employee_id=row.driver_id, kind=AdjustmentKind.penalty, year=year, month=month,
        actor_user_id=current.id, amount=amount if amount is not None else row.amount,
        reason=reason or (f"مخالفة سيارة {vehicle.code} — {row.kind or ''} بتاريخ "
                          f"{row.record_date.isoformat()}").strip())
    row.penalty_adjustment_id = adj.id
    if not row.admin_action:
        row.admin_action = "جزاء على السائق"
    row.updated_at, row.updated_by_user_id = datetime.now(), current.id
    db.flush()
    return adj


def dashboard(db: Session, current: CurrentUser, today: date | None = None) -> dict:
    today = today or date.today()
    cfg = settings(db)
    vehicles = db.scalars(branch_scope.scope(
        select(Vehicle).where(Vehicle.active.is_(True)), Vehicle, current)).all()
    states = vehicle_states(db, vehicles, today)
    by_status: dict[str, int] = defaultdict(int)
    for s in states.values():
        by_status[s["status"].value] += 1
    vids = [v.id for v in vehicles]
    codes = {v.id: v.code for v in vehicles}

    def scoped(model, *where):
        return branch_scope.scope(select(model).where(*where), model, current)

    open_faults = db.scalars(scoped(VehicleFault, VehicleFault.status != FaultStatus.resolved)).all()
    violations_total = db.scalar(select(func.count()).select_from(
        scoped(VehicleViolation).subquery()))
    unpaid = db.scalars(scoped(VehicleViolation, VehicleViolation.paid.is_(False))).all()
    drivers = driver_rows(db, current)
    month_start = today.replace(day=1)

    def total(model, col):
        q = select(func.coalesce(func.sum(col), 0)).where(model.record_date >= month_start,
                                                          model.record_date <= today)
        q = branch_scope.scope(q, model, current)
        return Decimal(str(db.scalar(q) or 0))

    inspected_today = db.scalar(select(func.count()).select_from(scoped(
        VehicleInspection, VehicleInspection.record_date == today).subquery()))
    pending_approval = db.scalar(select(func.count()).select_from(scoped(
        VehicleInspection, VehicleInspection.approved_at.is_(None)).subquery()))

    alerts: list[dict] = []

    def alert(level, kind, vid, text, link=None):
        alerts.append({"level": level, "kind": kind, "vehicle_id": vid,
                       "vehicle_code": codes.get(vid), "message": text, "link": link})

    horizon = today + timedelta(days=cfg.expiry_alert_days)
    for v in vehicles:
        for name, ended, d in (("التأمين", "منتهي", v.insurance_until),
                               ("الرخصة", "منتهية", v.license_until)):
            if d and d < today:
                alert("error", "expiry", v.id, f"{name} {ended} من {(today - d).days} يوم ({d.isoformat()})")
            elif d and d <= horizon:
                alert("warning", "expiry", v.id, f"{name} ينتهي بعد {(d - today).days} يوم ({d.isoformat()})")
        st = states[v.id]
        km = st["km_to_maintenance"]
        if km is not None and km <= cfg.maintenance_alert_km:
            alert("error" if km < 0 else "warning", "maintenance", v.id,
                  f"تجاوزت موعد الصيانة بـ {-km:,} كم" if km < 0 else f"متبقٍ {km:,} كم على الصيانة")
    for d in drivers:
        lu = d["license_until"]
        if lu and lu <= horizon and d["status"] == "active":
            alert("error" if lu < today else "warning", "driver_license", d["vehicle_id"],
                  f"رخصة السائق {d['name']} " + (f"منتهية ({lu.isoformat()})" if lu < today
                                                 else f"تنتهي بعد {(lu - today).days} يوم"))
    for f in open_faults:
        if f.stopped or f.severity in (FaultSeverity.critical, FaultSeverity.high):
            alert("error" if f.severity == FaultSeverity.critical or f.stopped else "warning",
                  "fault", f.vehicle_id,
                  f"عطل {'حرج' if f.severity == FaultSeverity.critical else 'خطير'}"
                  f"{' — السيارة متوقفة' if f.stopped else ''}: {f.description}")
    unpaid_by_vehicle: dict[int, list] = defaultdict(list)
    for u in unpaid:
        unpaid_by_vehicle[u.vehicle_id].append(u)
    for vid, rows in unpaid_by_vehicle.items():
        amt = sum((Decimal(str(r.amount or 0)) for r in rows), ZERO)
        alert("warning", "violation", vid, f"{len(rows)} مخالفة غير مسددة بقيمة {amt:,.2f}")
    alerts.sort(key=lambda a: (a["level"] != "error", a["vehicle_code"] or ""))

    return {
        "vehicles_total": len(vehicles),
        "maintenance_due": by_status.get("maintenance_due", 0),
        "stopped": by_status.get("stopped", 0),
        "attention": by_status.get("attention", 0),
        "good": by_status.get("good", 0),
        "drivers_total": len(drivers),
        "drivers_active": sum(1 for d in drivers if d["status"] == "active"),
        "faults_open": sum(1 for f in open_faults if f.status == FaultStatus.open),
        "faults_in_repair": sum(1 for f in open_faults if f.status == FaultStatus.in_repair),
        "faults_critical": sum(1 for f in open_faults if f.severity == FaultSeverity.critical),
        "violations_total": int(violations_total or 0),
        "violations_unpaid": len(unpaid),
        "violations_unpaid_amount": sum((Decimal(str(u.amount or 0)) for u in unpaid), ZERO),
        "inspections_today": int(inspected_today or 0),
        "inspections_pending_approval": int(pending_approval or 0),
        "month_fuel_amount": total(VehicleFuel, VehicleFuel.amount),
        "month_fuel_liters": total(VehicleFuel, VehicleFuel.liters),
        "month_maintenance_cost": total(VehicleMaintenance, VehicleMaintenance.cost),
        "month_fault_cost": total(VehicleFault, VehicleFault.cost),
        "alerts": alerts,
        "settings": {"expiry_alert_days": cfg.expiry_alert_days,
                     "maintenance_alert_km": cfg.maintenance_alert_km,
                     "fuel_abnormal_pct": cfg.fuel_abnormal_pct},
    }


def _sum_by_vehicle(db, model, cols, start, end, vids):
    q = (select(model.vehicle_id, func.count(), *[func.coalesce(func.sum(c), 0) for c in cols])
         .where(model.record_date >= start, model.record_date <= end, model.vehicle_id.in_(vids))
         .group_by(model.vehicle_id))
    return {r[0]: r[1:] for r in db.execute(q).all()}


def _km_by_vehicle(db, vids, start, end) -> dict[int, int]:
    if not vids:
        return {}
    r = _readings(vids)
    inside = dict(db.execute(
        select(r.c.vehicle_id, func.max(r.c.odometer))
        .where(r.c.record_date >= start, r.c.record_date <= end).group_by(r.c.vehicle_id)).all())
    first = dict(db.execute(
        select(r.c.vehicle_id, func.min(r.c.odometer))
        .where(r.c.record_date >= start, r.c.record_date <= end).group_by(r.c.vehicle_id)).all())
    before = dict(db.execute(
        select(r.c.vehicle_id, func.max(r.c.odometer))
        .where(r.c.record_date < start).group_by(r.c.vehicle_id)).all())
    cards = dict(db.execute(select(Vehicle.id, Vehicle.odometer_base)
                            .where(Vehicle.id.in_(list(inside)))).all()) if inside else {}
    out = {}
    for vid, top in inside.items():
        base = before.get(vid)
        if base is None:
            card = cards.get(vid) or 0
            base = card if 0 < card <= (first.get(vid) or 0) else first.get(vid)
        if top is not None and base is not None and top >= base:
            out[vid] = int(top) - int(base)
    return out


def _consumption(db, vids, start, end) -> dict[int, tuple[int, Decimal]]:
    if not vids:
        return {}
    rows = db.scalars(select(VehicleFuel).where(
        VehicleFuel.vehicle_id.in_(vids), VehicleFuel.record_date <= end,
        VehicleFuel.record_date >= start - timedelta(days=180))).all()
    by_v: dict[int, list] = defaultdict(list)
    for r in rows:
        by_v[r.vehicle_id].append(r)
    out: dict[int, tuple[int, Decimal]] = {}
    for vid, lst in by_v.items():
        cons = fuel_consumption(lst)
        dist, lit = 0, ZERO
        for r in lst:
            if start <= r.record_date <= end and r.id in cons:
                dist += cons[r.id]["distance"]
                lit += Decimal(str(r.liters or 0))
        if dist and lit:
            out[vid] = (dist, lit)
    return out


def _div(a, b):
    a, b = Decimal(str(a or 0)), Decimal(str(b or 0))
    return (a / b).quantize(Decimal("0.01")) if b else None


def monthly_report(db: Session, current: CurrentUser, year: int, month: int) -> dict:
    if not 1 <= month <= 12:
        raise FleetError("يجب أن يكون الشهر من 1 إلى 12.")
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    cfg = settings(db)
    vehicles = db.scalars(branch_scope.scope(select(Vehicle), Vehicle, current)
                          .order_by(Vehicle.code)).all()
    vids = [v.id for v in vehicles]
    maint = _sum_by_vehicle(db, VehicleMaintenance, [VehicleMaintenance.cost], start, end, vids)
    fuel = _sum_by_vehicle(db, VehicleFuel, [VehicleFuel.liters, VehicleFuel.amount], start, end, vids)
    faults = _sum_by_vehicle(db, VehicleFault, [VehicleFault.cost], start, end, vids)
    viol = _sum_by_vehicle(db, VehicleViolation, [VehicleViolation.amount], start, end, vids)
    km = _km_by_vehicle(db, vids, start, end)
    b_end = start - timedelta(days=1)
    b_start = (start.replace(day=1) - timedelta(days=85)).replace(day=1)
    cons = _consumption(db, vids, start, end)
    b_cons = _consumption(db, vids, b_start, b_end)
    notes = {n.vehicle_id: n.note for n in db.scalars(select(FleetMonthlyNote).where(
        FleetMonthlyNote.year == year, FleetMonthlyNote.month == month,
        FleetMonthlyNote.vehicle_id.in_(vids or [0])))}
    drivers = employee_names(db, [v.current_driver_id for v in vehicles])

    fleet_kmpl = _div(sum(d for d, _l in cons.values()), sum((lt for _d, lt in cons.values()), ZERO))
    pct = Decimal(cfg.fuel_abnormal_pct) / 100

    rows = []
    for v in vehicles:
        m = maint.get(v.id, (0, 0))
        f = fuel.get(v.id, (0, 0, 0))
        fa = faults.get(v.id, (0, 0))
        vi = viol.get(v.id, (0, 0))
        has_any = any(x[0] for x in (m, f, fa, vi))
        if not v.active and not has_any:
            continue
        k = km.get(v.id)
        kmpl = _div(*cons[v.id]) if v.id in cons else None
        base = _div(*b_cons[v.id]) if v.id in b_cons else None
        ref = base or fleet_kmpl
        abnormal = bool(kmpl is not None and ref and kmpl < ref * (1 - pct))
        cost = Decimal(str(m[1])) + Decimal(str(f[2])) + Decimal(str(fa[1]))
        rows.append({
            "vehicle_id": v.id, "vehicle_code": v.code, "kind": v.kind,
            "plate_number": v.plate_number,
            "driver_name": drivers.get(v.current_driver_id),
            "maintenance_count": int(m[0]), "maintenance_cost": Decimal(str(m[1])),
            "fuel_count": int(f[0]), "fuel_liters": Decimal(str(f[1])),
            "fuel_amount": Decimal(str(f[2])),
            "faults_count": int(fa[0]), "faults_cost": Decimal(str(fa[1])),
            "violations_count": int(vi[0]), "violations_amount": Decimal(str(vi[1])),
            "km": k, "km_per_liter": kmpl, "baseline_km_per_liter": base,
            "cost_per_km": _div(cost, k) if k else None,
            "total_cost": cost, "abnormal_fuel": abnormal,
            "note": notes.get(v.id),
        })
    return {"year": year, "month": month, "fleet_km_per_liter": fleet_kmpl,
            "fuel_abnormal_pct": cfg.fuel_abnormal_pct, "rows": rows}


def set_monthly_note(db: Session, current: CurrentUser, vehicle_id: int, year: int, month: int,
                     note: str | None) -> None:
    get_vehicle(db, current, vehicle_id)
    row = db.scalars(select(FleetMonthlyNote).where(
        FleetMonthlyNote.vehicle_id == vehicle_id, FleetMonthlyNote.year == year,
        FleetMonthlyNote.month == month)).first()
    if row is None:
        db.add(FleetMonthlyNote(vehicle_id=vehicle_id, year=year, month=month, note=note,
                                created_by_user_id=current.id))
    else:
        row.note = note
        row.updated_at, row.updated_by_user_id = datetime.now(), current.id
    db.flush()


def fuel_consumption(rows: list[VehicleFuel]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    prev = None
    for r in sorted((r for r in rows if r.odometer is not None),
                    key=lambda r: (r.odometer, r.record_date, r.id)):
        if prev is not None and r.odometer > prev.odometer and r.liters:
            dist = r.odometer - prev.odometer
            out[r.id] = {"distance": dist, "km_per_liter": _div(dist, r.liters),
                         "cost_per_km": _div(r.amount, dist)}
        prev = r
    return out


def monthly_costs(db: Session, vehicle_id: int, months: int = 12) -> list[dict]:
    today = date.today()
    start = today.replace(day=1)
    for _ in range(months - 1):
        start = (start - timedelta(days=1)).replace(day=1)

    def by_month(model, col):
        ym = func.to_char(model.record_date, "YYYY-MM") if db.bind.dialect.name == "postgresql" \
            else func.strftime("%Y-%m", model.record_date)
        return dict(db.execute(select(ym, func.coalesce(func.sum(col), 0))
                               .where(model.vehicle_id == vehicle_id, model.record_date >= start)
                               .group_by(ym)).all())

    fuel = by_month(VehicleFuel, VehicleFuel.amount)
    liters = by_month(VehicleFuel, VehicleFuel.liters)
    maint = by_month(VehicleMaintenance, VehicleMaintenance.cost)
    faults = by_month(VehicleFault, VehicleFault.cost)
    viol = by_month(VehicleViolation, VehicleViolation.amount)
    out = []
    cur = start
    while cur <= today:
        key = f"{cur.year}-{cur.month:02d}"
        last = date(cur.year, cur.month, monthrange(cur.year, cur.month)[1])
        km = _km_by_vehicle(db, [vehicle_id], cur, last).get(vehicle_id)
        cons = _consumption(db, [vehicle_id], cur, last).get(vehicle_id)
        f, m, fa = (Decimal(str(d.get(key, 0))) for d in (fuel, maint, faults))
        out.append({"month": key, "fuel_amount": f, "fuel_liters": Decimal(str(liters.get(key, 0))),
                    "maintenance_cost": m, "faults_cost": fa,
                    "violations_amount": Decimal(str(viol.get(key, 0))),
                    "total": f + m + fa, "km": km,
                    "km_per_liter": _div(*cons) if cons else None})
        cur = last + timedelta(days=1)
    return out


DEFAULT_TASKS = [
    (TaskPeriod.daily, "فحص السيارات قبل التحرك",
     "التأكد من السلامة العامة، الإطارات، الفرامل، الأنوار، الزيت والمياه."),
    (TaskPeriod.daily, "متابعة خروج وعودة السيارات",
     "تسجيل العداد والوقود وحالة السيارة عند الخروج والعودة."),
    (TaskPeriod.daily, "متابعة السائقين",
     "الالتزام بخط السير، التعليمات، المواعيد، والمحافظة على السيارة."),
    (TaskPeriod.immediate, "تسجيل الأعطال",
     "أي عطل يسجل فورًا مع درجة الخطورة والإجراء المتخذ."),
    (TaskPeriod.immediate, "الحوادث والمخالفات", "تسجيل الواقعة والتكلفة والإجراء الإداري."),
    (TaskPeriod.weekly, "مراجعة الصيانة",
     "حصر السيارات القريبة من موعد الصيانة وإرسال خطة للإدارة."),
    (TaskPeriod.weekly, "مراجعة الوقود",
     "مقارنة الاستهلاك بين السيارات واكتشاف أي ارتفاع غير طبيعي."),
    (TaskPeriod.monthly, "تقرير الإدارة",
     "رفع تقرير شامل عن الصيانة، الوقود، الأعطال، المخالفات، وأداء السائقين."),
]


def ensure_default_tasks(db: Session) -> None:
    if db.scalar(select(func.count()).select_from(FleetTask)):
        return
    for i, (period, title, details) in enumerate(DEFAULT_TASKS):
        db.add(FleetTask(period=period, title=title, details=details, sort_order=i + 1))
    db.flush()


def period_key(period: TaskPeriod, on: date) -> str:
    if period == TaskPeriod.weekly:
        y, w, _ = on.isocalendar()
        return f"{y}-W{w:02d}"
    if period == TaskPeriod.monthly:
        return f"{on.year}-{on.month:02d}"
    return on.isoformat()


def branch_key(current: CurrentUser) -> int:
    return branch_scope.visible_branch_id(current) or 0


def tasks_for(db: Session, current: CurrentUser, on: date) -> list[dict]:
    bid = branch_scope.visible_branch_id(current)
    stmt = select(FleetTask).order_by(FleetTask.sort_order, FleetTask.id)
    if bid is not None:
        stmt = stmt.where(or_(FleetTask.branch_id.is_(None), FleetTask.branch_id == bid))
    tasks = db.scalars(stmt).all()
    bkey = branch_key(current)
    keys = {t.id: period_key(t.period, on) for t in tasks}
    logs = {}
    if tasks:
        for lg in db.scalars(select(FleetTaskLog).where(
                FleetTaskLog.task_id.in_([t.id for t in tasks]), FleetTaskLog.branch_key == bkey)):
            if keys.get(lg.task_id) == lg.period_key:
                logs[lg.task_id] = lg
    from src.models.user import User

    users = dict(db.execute(select(User.id, User.full_name).where(
        User.id.in_({lg.done_by_user_id for lg in logs.values() if lg.done_by_user_id} or {0}))).all())
    return [{
        "id": t.id, "period": t.period.value, "title": t.title, "details": t.details,
        "sort_order": t.sort_order, "active": t.active, "branch_id": t.branch_id,
        "period_key": keys[t.id],
        "done": t.id in logs,
        "done_log_id": logs[t.id].id if t.id in logs else None,
        "done_at": logs[t.id].created_at if t.id in logs else None,
        "done_by": users.get(logs[t.id].done_by_user_id) if t.id in logs else None,
        "done_notes": logs[t.id].notes if t.id in logs else None,
    } for t in tasks]


def mark_task(db: Session, current: CurrentUser, task_id: int, on: date, done: bool,
              notes: str | None) -> None:
    task = db.get(FleetTask, task_id)
    if task is None:
        raise FleetNotFound("المهمة غير موجودة.")
    bkey = branch_key(current)
    key = period_key(task.period, on)
    row = db.scalars(select(FleetTaskLog).where(
        FleetTaskLog.task_id == task_id, FleetTaskLog.branch_key == bkey,
        FleetTaskLog.period_key == key)).first()
    if done and row is None:
        db.add(FleetTaskLog(task_id=task_id, branch_id=bkey or None, branch_key=bkey,
                            period_key=key, done_date=on, notes=notes,
                            done_by_user_id=current.id))
    elif done and row is not None:
        row.notes = notes
    elif not done and row is not None:
        db.delete(row)
    db.flush()


def task_log(db: Session, current: CurrentUser, date_from: date | None, date_to: date | None):
    stmt = select(FleetTaskLog, FleetTask).join(FleetTask, FleetTask.id == FleetTaskLog.task_id)
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        stmt = stmt.where(FleetTaskLog.branch_key == bid)
    if date_from:
        stmt = stmt.where(FleetTaskLog.done_date >= date_from)
    if date_to:
        stmt = stmt.where(FleetTaskLog.done_date <= date_to)
    rows = db.execute(stmt.order_by(FleetTaskLog.done_date.desc(), FleetTaskLog.id.desc())).all()
    from src.models.user import User

    users = dict(db.execute(select(User.id, User.full_name).where(
        User.id.in_({lg.done_by_user_id for lg, _ in rows if lg.done_by_user_id} or {0}))).all())
    return [{"id": lg.id, "task_id": t.id, "title": t.title, "period": t.period.value,
             "period_key": lg.period_key, "done_date": lg.done_date, "notes": lg.notes,
             "done_by": users.get(lg.done_by_user_id), "branch_id": lg.branch_id}
            for lg, t in rows]

