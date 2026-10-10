from __future__ import annotations

import hashlib
import secrets
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, insert, or_, select, update
from sqlalchemy.orm import Session

from src.models.employee import Employee
from src.models.hr_attendance import (
    AttendanceDay,
    AttendanceDevice,
    AttendanceDeviceUser,
    AttendancePunch,
    AttendanceSource,
    AttendanceStatus,
)
from src.services import attendance_service
from src.services.attendance_service import AttendanceError

MAX_BATCH = 5000
_CHUNK = 1000
_PROTECTED = {AttendanceStatus.leave, AttendanceStatus.mission}


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


def device_by_token(db: Session, token: str | None) -> AttendanceDevice | None:
    if not token or len(token) > 200:
        return None
    device = db.scalar(select(AttendanceDevice).where(
        AttendanceDevice.token_hash == hash_token(token)))
    if device is None or not device.active:
        return None
    return device


def clean_user_no(value) -> str:
    return str(value if value is not None else "").strip()[:20]


def clean_fingerprint_no(value: str | None) -> str | None:
    text = (value or "").strip()
    if not text:
        return None
    text = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    if len(text) > 20:
        raise AttendanceError("رقم البصمة أطول من ٢٠ حرفاً.")
    return text


def fingerprint_clash(
    db: Session, *, fingerprint_no: str, branch_id: int | None, exclude_id: int | None = None,
) -> Employee | None:
    stmt = select(Employee).where(
        Employee.fingerprint_no == fingerprint_no, Employee.active.is_(True))
    if exclude_id is not None:
        stmt = stmt.where(Employee.id != exclude_id)
    if branch_id is not None:
        stmt = stmt.where(or_(Employee.branch_id == branch_id, Employee.branch_id.is_(None)))
    return db.scalar(stmt.order_by(Employee.id).limit(1))


def employee_map(db: Session, device: AttendanceDevice) -> dict[str, int]:
    stmt = select(Employee.id, Employee.fingerprint_no, Employee.active, Employee.branch_id).where(
        Employee.fingerprint_no.is_not(None))
    if device.branch_id is not None:
        stmt = stmt.where(or_(Employee.branch_id == device.branch_id,
                              Employee.branch_id.is_(None)))
    ranked: dict[str, tuple[tuple, int]] = {}
    for emp_id, number, active, branch_id in db.execute(stmt).all():
        key = clean_user_no(number)
        if not key:
            continue
        rank = (0 if active else 1, 0 if branch_id == device.branch_id else 1, emp_id)
        if key not in ranked or rank < ranked[key][0]:
            ranked[key] = (rank, emp_id)
    return {key: emp_id for key, (_, emp_id) in ranked.items()}


def _naive(value: datetime) -> datetime:
    if value.tzinfo is not None:
        value = value.replace(tzinfo=None)
    return value.replace(microsecond=0)


def _insert_ignore(db: Session, rows: list[dict]) -> None:
    dialect = db.get_bind().dialect.name
    for start in range(0, len(rows), _CHUNK):
        chunk = rows[start:start + _CHUNK]
        if dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            stmt = pg_insert(AttendancePunch).values(chunk).on_conflict_do_nothing(
                index_elements=["device_id", "user_no", "punched_at"])
        elif dialect == "sqlite":
            from sqlalchemy.dialects.sqlite import insert as lite_insert
            stmt = lite_insert(AttendancePunch).values(chunk).on_conflict_do_nothing(
                index_elements=["device_id", "user_no", "punched_at"])
        else:
            stmt = insert(AttendancePunch).values(chunk).prefix_with("IGNORE")
        db.execute(stmt)


def ingest_punches(db: Session, *, device: AttendanceDevice, punches: list[dict]) -> dict:
    received = len(punches)
    staged: dict[tuple[str, datetime], dict] = {}
    rejected = 0
    for p in punches:
        user_no = clean_user_no(p.get("user_no"))
        at = p.get("time")
        if not user_no or not isinstance(at, datetime):
            rejected += 1
            continue
        at = _naive(at)
        staged.setdefault((user_no, at), {
            "user_no": user_no, "punched_at": at,
            "status": int(p.get("status") or 0), "verify": int(p.get("verify") or 0),
        })

    fresh: list[dict] = []
    if staged:
        lo = min(at for _, at in staged)
        hi = max(at for _, at in staged)
        existing = {(u, _naive(t)) for u, t in db.execute(
            select(AttendancePunch.user_no, AttendancePunch.punched_at).where(
                AttendancePunch.device_id == device.id,
                AttendancePunch.punched_at >= lo, AttendancePunch.punched_at <= hi)).all()}
        mapping = employee_map(db, device)
        for key, row in staged.items():
            if key in existing:
                continue
            fresh.append({
                **row, "device_id": device.id,
                "employee_id": mapping.get(row["user_no"]), "processed": False,
            })
        if fresh:
            _insert_ignore(db, fresh)
            newest = max(r["punched_at"] for r in fresh)
            if device.last_punch_at is None or newest > device.last_punch_at:
                device.last_punch_at = newest

    device.last_seen_at = datetime.now().replace(microsecond=0)
    db.flush()

    affected = {(r["employee_id"], r["punched_at"].date()) for r in fresh if r["employee_id"]}
    result = rebuild_days(db, affected)
    return {
        "received": received,
        "inserted": len(fresh),
        "duplicates": received - rejected - len(fresh),
        "rejected": rejected,
        "matched": sum(1 for r in fresh if r["employee_id"]),
        "unmatched": sum(1 for r in fresh if not r["employee_id"]),
        "days_updated": result["updated"],
        "days_skipped": result["skipped"],
        "last_punch_at": device.last_punch_at.isoformat() if device.last_punch_at else None,
    }


def rebuild_days(db: Session, keys: set[tuple[int, date]]) -> dict:
    updated = skipped = 0
    for employee_id, day in sorted(keys, key=lambda k: (k[1], k[0])):
        if rebuild_day(db, employee_id, day):
            updated += 1
        else:
            skipped += 1
    return {"updated": updated, "skipped": skipped}


def rebuild_day(db: Session, employee_id: int, day: date) -> bool:
    start = datetime.combine(day, datetime.min.time())
    end = start + timedelta(days=1)
    window = and_(AttendancePunch.employee_id == employee_id,
                  AttendancePunch.punched_at >= start, AttendancePunch.punched_at < end)
    times = list(db.scalars(select(AttendancePunch.punched_at).where(window)
                            .order_by(AttendancePunch.punched_at)).all())
    db.execute(update(AttendancePunch).where(window, AttendancePunch.processed.is_(False))
               .values(processed=True))
    if not times:
        return False

    existing = db.scalar(select(AttendanceDay).where(
        AttendanceDay.employee_id == employee_id, AttendanceDay.work_date == day))
    if existing is not None and (
        existing.locked_by_payroll_run_id is not None
        or existing.source == AttendanceSource.manual
        or (existing.source == AttendanceSource.generated and existing.status in _PROTECTED)
    ):
        return False

    first = times[0].strftime("%H:%M")
    last = times[-1].strftime("%H:%M")
    check_out = last if len(times) > 1 and last != first else None
    try:
        attendance_service.record_day(
            db, employee_id=employee_id, work_date=day,
            check_in=first, check_out=check_out, status=AttendanceStatus.present,
            notes=existing.notes if existing is not None else None,
            source=AttendanceSource.device, actor_user_id=None,
        )
    except AttendanceError:
        return False
    return True


def claim_for_employee(db: Session, employee: Employee) -> dict:
    number = clean_user_no(employee.fingerprint_no)
    if not number:
        return {"claimed": 0, "updated": 0, "skipped": 0}
    devices = db.scalars(select(AttendanceDevice)).all()
    claimed = 0
    keys: set[tuple[int, date]] = set()
    for device in devices:
        if employee_map(db, device).get(number) != employee.id:
            continue
        rows = db.scalars(select(AttendancePunch).where(
            AttendancePunch.device_id == device.id, AttendancePunch.user_no == number,
            AttendancePunch.employee_id.is_(None))).all()
        for row in rows:
            row.employee_id = employee.id
            keys.add((employee.id, row.punched_at.date()))
            claimed += 1
    db.flush()
    result = rebuild_days(db, keys)
    return {"claimed": claimed, **result}


def reprocess(
    db: Session, *, date_from: date, date_to: date, device_id: int | None = None,
    employee_ids: set[int] | None = None,
) -> dict:
    start = datetime.combine(date_from, datetime.min.time())
    end = datetime.combine(date_to, datetime.min.time()) + timedelta(days=1)
    stmt = select(AttendanceDevice)
    if device_id:
        stmt = stmt.where(AttendanceDevice.id == device_id)
    remapped = 0
    keys: set[tuple[int, date]] = set()
    for device in db.scalars(stmt).all():
        mapping = employee_map(db, device)
        rows = db.scalars(select(AttendancePunch).where(
            AttendancePunch.device_id == device.id,
            AttendancePunch.punched_at >= start, AttendancePunch.punched_at < end)).all()
        for row in rows:
            target = mapping.get(row.user_no)
            if target != row.employee_id:
                if row.employee_id:
                    keys.add((row.employee_id, row.punched_at.date()))
                row.employee_id = target
                remapped += 1
            if target:
                keys.add((target, row.punched_at.date()))
    db.flush()
    if employee_ids is not None:
        keys = {k for k in keys if k[0] in employee_ids}
    result = rebuild_days(db, keys)
    return {"remapped": remapped, "days": len(keys), **result}


def sync_users(db: Session, *, device: AttendanceDevice, users: list[dict]) -> dict:
    current = {u.user_no: u for u in db.scalars(select(AttendanceDeviceUser).where(
        AttendanceDeviceUser.device_id == device.id)).all()}
    seen: set[str] = set()
    added = changed = 0
    now = datetime.now().replace(microsecond=0)
    for u in users:
        user_no = clean_user_no(u.get("user_no"))
        if not user_no or user_no in seen:
            continue
        seen.add(user_no)
        name = (str(u.get("name") or "").strip() or None)
        name = name[:120] if name else None
        privilege = int(u.get("privilege") or 0)
        row = current.get(user_no)
        if row is None:
            db.add(AttendanceDeviceUser(device_id=device.id, user_no=user_no, name=name,
                                        privilege=privilege, updated_at=now))
            added += 1
        elif row.name != name or row.privilege != privilege:
            row.name = name
            row.privilege = privilege
            row.updated_at = now
            changed += 1
    removed = 0
    if seen:
        for user_no, row in current.items():
            if user_no not in seen:
                db.delete(row)
                removed += 1
    device.users_count = len(seen)
    device.last_seen_at = now
    db.flush()
    return {"users": len(seen), "added": added, "changed": changed, "removed": removed}


def heartbeat(
    db: Session, *, device: AttendanceDevice, users_count: int | None,
    records_count: int | None, records_capacity: int | None = None,
    firmware: str | None = None,
) -> dict:
    device.last_seen_at = datetime.now().replace(microsecond=0)
    if users_count is not None:
        device.users_count = users_count
    if records_count is not None:
        device.records_count = records_count
    if records_capacity:
        device.records_capacity = records_capacity
    if firmware:
        device.firmware = firmware.strip()[:80]
    db.flush()
    return {
        "ok": True,
        "device": device.name,
        "last_punch_at": device.last_punch_at.isoformat() if device.last_punch_at else None,
        "server_time": device.last_seen_at.isoformat(),
    }


def punch_counts(db: Session) -> dict[int, dict]:
    rows = db.execute(select(
        AttendancePunch.device_id, func.count(AttendancePunch.id),
        func.count(AttendancePunch.employee_id),
    ).group_by(AttendancePunch.device_id)).all()
    return {d: {"total": t, "matched": m} for d, t, m in rows}
