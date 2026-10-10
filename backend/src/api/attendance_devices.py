from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_HR_READ, CAP_HR_WRITE
from src.core.db import get_db
from src.models.employee import Employee
from src.models.hr_attendance import AttendanceDevice, AttendanceDeviceUser, AttendancePunch
from src.services import attendance_device_service as svc

router = APIRouter(tags=["attendance-devices"], prefix="/hr/attendance")

_MAX = svc.MAX_BATCH


class DeviceIn(BaseModel):
    name: str
    serial: str | None = None
    ip: str | None = None
    port: int = 4370
    branch_id: int | None = None


class DevicePatch(BaseModel):
    name: str | None = None
    serial: str | None = None
    ip: str | None = None
    port: int | None = None
    branch_id: int | None = None
    active: bool | None = None


class DeviceOut(BaseModel):
    id: int
    name: str
    serial: str | None
    ip: str | None
    port: int
    branch_id: int | None
    active: bool
    last_seen_at: datetime | None
    last_punch_at: datetime | None
    users_count: int | None
    records_count: int | None
    records_capacity: int | None
    firmware: str | None
    punches: int = 0
    matched_punches: int = 0
    created_at: datetime | None


class AgentPunch(BaseModel):
    user_no: str | int
    time: datetime
    status: int | None = 0
    verify: int | None = 0


class AgentPunchesIn(BaseModel):
    serial: str | None = None
    punches: list[AgentPunch] = Field(default_factory=list, max_length=_MAX)


class AgentUser(BaseModel):
    user_no: str | int
    name: str | None = None
    privilege: int | None = 0


class AgentUsersIn(BaseModel):
    serial: str | None = None
    users: list[AgentUser] = Field(default_factory=list, max_length=_MAX)


class AgentHeartbeatIn(BaseModel):
    serial: str | None = None
    users_count: int | None = None
    records_count: int | None = None
    records_capacity: int | None = None
    firmware: str | None = None


class ReprocessIn(BaseModel):
    date_from: date
    date_to: date
    device_id: int | None = None


def _clean(value: str | None, size: int) -> str | None:
    text = (value or "").strip()
    return text[:size] if text else None


def _device_out(row: AttendanceDevice, counts: dict[int, dict]) -> DeviceOut:
    c = counts.get(row.id, {})
    return DeviceOut(
        id=row.id, name=row.name, serial=row.serial, ip=row.ip, port=row.port,
        branch_id=row.branch_id, active=row.active,
        last_seen_at=row.last_seen_at, last_punch_at=row.last_punch_at,
        users_count=row.users_count, records_count=row.records_count,
        records_capacity=row.records_capacity, firmware=row.firmware,
        punches=c.get("total", 0), matched_punches=c.get("matched", 0),
        created_at=row.created_at,
    )


def _seen_device(db: Session, device_id: int, current: CurrentUser) -> AttendanceDevice:
    row = db.get(AttendanceDevice, device_id)
    if row is None or not branch_scope.may_see(current, row):
        raise HTTPException(404, {"code": "not_found", "message": "الجهاز غير موجود."})
    return row


def _device_branch(current: CurrentUser, requested: int | None) -> int | None:
    if not branch_scope.sees_all_branches(current):
        return current.branch_id
    return requested


def _visible_device_ids(db: Session, current: CurrentUser) -> list[int]:
    stmt = branch_scope.scope(select(AttendanceDevice.id), AttendanceDevice, current)
    return list(db.scalars(stmt).all())


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[DeviceOut]:
    stmt = branch_scope.scope(select(AttendanceDevice), AttendanceDevice, current)
    rows = db.scalars(stmt.order_by(AttendanceDevice.name)).all()
    counts = svc.punch_counts(db)
    return [_device_out(r, counts) for r in rows]


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def create_device(
    body: DeviceIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    name = _clean(body.name, 120)
    if not name:
        raise HTTPException(422, {"code": "validation", "message": "اسم الجهاز مطلوب."})
    serial = _clean(body.serial, 40)
    if serial and db.scalar(select(AttendanceDevice).where(AttendanceDevice.serial == serial)):
        raise HTTPException(409, {"code": "duplicate",
                                  "message": "يوجد جهاز مسجّل بالرقم التسلسلي نفسه."})
    token = svc.new_token()
    row = AttendanceDevice(
        name=name, serial=serial, ip=_clean(body.ip, 64), port=body.port or 4370,
        branch_id=_device_branch(current, body.branch_id), token_hash=svc.hash_token(token),
    )
    db.add(row)
    db.flush()
    out = _device_out(row, {})
    db.commit()
    return {"device": out.model_dump(mode="json"), "token": token}


@router.patch("/devices/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: int,
    body: DevicePatch,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> DeviceOut:
    row = _seen_device(db, device_id, current)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        name = _clean(changes["name"], 120)
        if not name:
            raise HTTPException(422, {"code": "validation", "message": "اسم الجهاز مطلوب."})
        row.name = name
    if "serial" in changes:
        serial = _clean(changes["serial"], 40)
        if serial and db.scalar(select(AttendanceDevice).where(
                AttendanceDevice.serial == serial, AttendanceDevice.id != row.id)):
            raise HTTPException(409, {"code": "duplicate",
                                      "message": "يوجد جهاز مسجّل بالرقم التسلسلي نفسه."})
        row.serial = serial
    if "ip" in changes:
        row.ip = _clean(changes["ip"], 64)
    if changes.get("port"):
        row.port = changes["port"]
    if "branch_id" in changes:
        row.branch_id = _device_branch(current, changes["branch_id"])
    if changes.get("active") is not None:
        row.active = changes["active"]
    db.flush()
    out = _device_out(row, svc.punch_counts(db))
    db.commit()
    return out


@router.post("/devices/{device_id}/token")
def regenerate_token(
    device_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    row = _seen_device(db, device_id, current)
    token = svc.new_token()
    row.token_hash = svc.hash_token(token)
    db.commit()
    return {"token": token}


@router.delete("/devices/{device_id}")
def delete_device(
    device_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    row = _seen_device(db, device_id, current)
    has_punches = db.scalar(select(func.count(AttendancePunch.id)).where(
        AttendancePunch.device_id == row.id))
    if has_punches:
        row.active = False
        db.commit()
        return {"deleted": False, "deactivated": True}
    for user in db.scalars(select(AttendanceDeviceUser).where(
            AttendanceDeviceUser.device_id == row.id)).all():
        db.delete(user)
    db.delete(row)
    db.commit()
    return {"deleted": True, "deactivated": False}


@router.get("/devices/{device_id}/users")
def device_users(
    device_id: int,
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> list[dict]:
    device = _seen_device(db, device_id, current)
    mapping = svc.employee_map(db, device)
    users = {u.user_no: u for u in db.scalars(select(AttendanceDeviceUser).where(
        AttendanceDeviceUser.device_id == device.id)).all()}
    stats = {
        user_no: (total, unmatched, last)
        for user_no, total, unmatched, last in db.execute(select(
            AttendancePunch.user_no, func.count(AttendancePunch.id),
            func.count(AttendancePunch.id) - func.count(AttendancePunch.employee_id),
            func.max(AttendancePunch.punched_at),
        ).where(AttendancePunch.device_id == device.id)
         .group_by(AttendancePunch.user_no)).all()
    }
    employees = {e.id: e for e in db.scalars(select(Employee).where(
        Employee.id.in_(set(mapping.values()) or {0}))).all()}
    out = []
    for user_no in set(users) | set(stats):
        u = users.get(user_no)
        emp = employees.get(mapping.get(user_no, 0))
        total, unmatched, last = stats.get(user_no, (0, 0, None))
        out.append({
            "user_no": user_no,
            "name": u.name if u else None,
            "privilege": u.privilege if u else 0,
            "on_device": u is not None,
            "employee_id": emp.id if emp else None,
            "employee_name": emp.name if emp else None,
            "employee_code": emp.code if emp else None,
            "punches": total,
            "unmatched_punches": unmatched,
            "last_punch_at": last,
        })
    out.sort(key=lambda r: (len(r["user_no"]), r["user_no"]))
    return out


@router.get("/punches")
def list_punches(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    employee_id: int | None = Query(None),
    device_id: int | None = Query(None),
    matched: bool | None = Query(None),
    user_no: str | None = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
    current: CurrentUser = Depends(require_capability(CAP_HR_READ)),
    db: Session = Depends(get_db),
) -> dict:
    devices = {d.id: d for d in db.scalars(branch_scope.scope(
        select(AttendanceDevice), AttendanceDevice, current)).all()}
    stmt = select(AttendancePunch).where(AttendancePunch.device_id.in_(set(devices) or {0}))
    if date_from:
        stmt = stmt.where(AttendancePunch.punched_at >= datetime.combine(
            date_from, datetime.min.time()))
    if date_to:
        stmt = stmt.where(AttendancePunch.punched_at < datetime.combine(
            date_to, datetime.min.time()) + timedelta(days=1))
    if employee_id:
        stmt = stmt.where(AttendancePunch.employee_id == employee_id)
    if device_id:
        stmt = stmt.where(AttendancePunch.device_id == device_id)
    if matched is True:
        stmt = stmt.where(AttendancePunch.employee_id.is_not(None))
    elif matched is False:
        stmt = stmt.where(AttendancePunch.employee_id.is_(None))
    if user_no and user_no.strip():
        stmt = stmt.where(AttendancePunch.user_no == user_no.strip())
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AttendancePunch.punched_at.desc(),
                                    AttendancePunch.id.desc()).limit(limit)).all()
    emp_ids = {r.employee_id for r in rows if r.employee_id}
    names = {e.id: e.name for e in db.scalars(select(Employee).where(
        Employee.id.in_(emp_ids or {0}))).all()}
    dev_users = {(u.device_id, u.user_no): u.name for u in db.scalars(
        select(AttendanceDeviceUser).where(
            AttendanceDeviceUser.device_id.in_({r.device_id for r in rows} or {0}))).all()}
    return {
        "total": total,
        "rows": [{
            "id": r.id, "device_id": r.device_id,
            "device_name": devices[r.device_id].name if r.device_id in devices else None,
            "user_no": r.user_no, "device_user_name": dev_users.get((r.device_id, r.user_no)),
            "employee_id": r.employee_id, "employee_name": names.get(r.employee_id),
            "punched_at": r.punched_at, "status": r.status, "verify": r.verify,
            "processed": r.processed,
        } for r in rows],
    }


@router.post("/punches/reprocess")
def reprocess_punches(
    body: ReprocessIn,
    current: CurrentUser = Depends(require_capability(CAP_HR_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    if body.date_to < body.date_from:
        raise HTTPException(422, {"code": "validation",
                                  "message": "تاريخ النهاية قبل تاريخ البداية."})
    if (body.date_to - body.date_from).days > 92:
        raise HTTPException(422, {"code": "validation",
                                  "message": "أقصى مدة لإعادة المعالجة ثلاثة أشهر."})
    visible = set(_visible_device_ids(db, current))
    if body.device_id and body.device_id not in visible:
        raise HTTPException(404, {"code": "not_found", "message": "الجهاز غير موجود."})
    employee_ids = None
    if not branch_scope.sees_all_branches(current):
        employee_ids = set(db.scalars(branch_scope.scope(
            select(Employee.id), Employee, current)).all())
    if body.device_id:
        result = svc.reprocess(db, date_from=body.date_from, date_to=body.date_to,
                               device_id=body.device_id, employee_ids=employee_ids)
    else:
        result = {"remapped": 0, "days": 0, "updated": 0, "skipped": 0}
        for dev_id in visible:
            part = svc.reprocess(db, date_from=body.date_from, date_to=body.date_to,
                                 device_id=dev_id, employee_ids=employee_ids)
            for key in result:
                result[key] += part[key]
    db.commit()
    return result


def _agent_device(
    x_device_token: str | None = Header(None, alias="X-Device-Token"),
    db: Session = Depends(get_db),
) -> AttendanceDevice:
    device = svc.device_by_token(db, x_device_token)
    if device is None:
        raise HTTPException(401, {"code": "bad_token",
                                  "message": "رمز الربط غير صحيح أو الجهاز موقوف."})
    return device


def _check_serial(db: Session, device: AttendanceDevice, serial: str | None) -> None:
    serial = _clean(serial, 40)
    if not serial:
        return
    if device.serial and device.serial != serial:
        raise HTTPException(409, {"code": "serial_mismatch",
                                  "message": f"الرقم التسلسلي {serial} لا يطابق الجهاز المسجّل."})
    if not device.serial:
        device.serial = serial


@router.post("/agent/punches")
def agent_punches(
    body: AgentPunchesIn,
    device: AttendanceDevice = Depends(_agent_device),
    db: Session = Depends(get_db),
) -> dict:
    _check_serial(db, device, body.serial)
    result = svc.ingest_punches(db, device=device, punches=[p.model_dump() for p in body.punches])
    db.commit()
    return result


@router.post("/agent/users")
def agent_users(
    body: AgentUsersIn,
    device: AttendanceDevice = Depends(_agent_device),
    db: Session = Depends(get_db),
) -> dict:
    _check_serial(db, device, body.serial)
    result = svc.sync_users(db, device=device, users=[u.model_dump() for u in body.users])
    db.commit()
    return result


@router.post("/agent/heartbeat")
def agent_heartbeat(
    body: AgentHeartbeatIn,
    device: AttendanceDevice = Depends(_agent_device),
    db: Session = Depends(get_db),
) -> dict:
    _check_serial(db, device, body.serial)
    result = svc.heartbeat(db, device=device, users_count=body.users_count,
                           records_count=body.records_count,
                           records_capacity=body.records_capacity, firmware=body.firmware)
    db.commit()
    return result
