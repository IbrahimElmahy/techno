from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, and_, cast, delete, func, or_, select
from sqlalchemy.orm import Session

from src.core.money import to_money
from src.models.coupon_receipt import CouponReceipt, receipt_counted
from src.models.customer import Customer, CustomerAccount
from src.models.employee import Employee
from src.models.hr_attendance import AttendanceDay, AttendanceStatus
from src.models.hr_commission import (
    HrCommissionManualCollection,
    HrCommissionSetting,
    HrCommissionSupervisor,
    HrCommissionSupervisorTeam,
    HrCommissionTeam,
    HrCommissionTeamMember,
    HrCommissionTeamUser,
    HrCommissionTechnician,
)
from src.models.inspection import Inspection, InspectionStatus, VisitKind
from src.models.ledger import LedgerLine
from src.models.org import Branch
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice, SalesReturn
from src.models.user import User
from src.models.voucher import Voucher, VoucherKind
from src.services import audit_service

ZERO = Decimal("0")
HUNDRED = Decimal("100")
THOUSAND = Decimal("1000")
FAMILIES = ("poly", "white", "other")

AMOUNT_KEYS = (
    "commission", "supervision", "penalty_25", "inspection_commission", "technician_bonus",
    "coupon_commission", "min_inspection_deduction", "coupon_commission_payable",
    "earnings", "deductions",
)


class CommissionSetupError(Exception):
    pass


def _d(v) -> Decimal:
    return Decimal(str(v if v is not None else 0))


def month_bounds(year: int, month: int) -> tuple[date, date]:
    if not (1 <= int(month) <= 12) or int(year) < 2000:
        raise CommissionSetupError("الشهر غير صحيح.")
    last = calendar.monthrange(int(year), int(month))[1]
    return date(int(year), int(month), 1), date(int(year), int(month), last)


def shift_month(year: int, month: int, back: int) -> tuple[int, int]:
    idx = int(year) * 12 + (int(month) - 1) - int(back)
    return idx // 12, idx % 12 + 1


def family_key(name: str | None) -> str:
    text = (name or "").strip()
    if not text:
        return "other"
    if "بولي" in text or "بولى" in text or "تكنو" in text:
        return "poly"
    if "بيض" in text:
        return "white"
    return "other"


def _fam() -> dict[str, Decimal]:
    return {k: ZERO for k in FAMILIES}


def _money_dict(d: dict) -> dict:
    return {k: to_money(v) for k, v in d.items()}


def _employee_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {e.id: e.name for e in db.scalars(select(Employee).where(Employee.id.in_(ids))).all()}


def _user_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: (u.full_name or u.username)
            for u in db.scalars(select(User).where(User.id.in_(ids))).all()}


def absent_days(db: Session, employee_ids, year: int, month: int) -> dict[int, Decimal]:
    ids = [i for i in set(employee_ids or []) if i]
    if not ids:
        return {}
    d1, d2 = month_bounds(year, month)
    rows = db.execute(
        select(AttendanceDay.employee_id, func.count())
        .where(AttendanceDay.employee_id.in_(ids),
               AttendanceDay.status == AttendanceStatus.absent,
               AttendanceDay.work_date >= d1, AttendanceDay.work_date <= d2)
        .group_by(AttendanceDay.employee_id)
    ).all()
    return {eid: Decimal(int(n or 0)) for eid, n in rows if n}


def get_settings(db: Session, branch_id: int) -> HrCommissionSetting:
    row = db.scalar(select(HrCommissionSetting).where(HrCommissionSetting.branch_id == branch_id))
    if row is not None:
        return row
    return HrCommissionSetting(
        branch_id=branch_id, point_value=Decimal("0"), points_per_coupon=30,
        factor_divisor=Decimal("600"), absence_divisor=Decimal("30"),
        penalty_sales_pct=Decimal("25"), penalty_per_thousand=Decimal("20"),
        attribute_by_customer_rep=True, pay_coupon_commission=False,
        apply_min_inspections=False,
    )


def settings_out(s: HrCommissionSetting) -> dict:
    return {
        "point_value": _d(s.point_value), "points_per_coupon": int(s.points_per_coupon or 0),
        "factor_divisor": _d(s.factor_divisor), "absence_divisor": _d(s.absence_divisor),
        "penalty_sales_pct": _d(s.penalty_sales_pct),
        "penalty_per_thousand": _d(s.penalty_per_thousand),
        "attribute_by_customer_rep": bool(s.attribute_by_customer_rep),
        "pay_coupon_commission": bool(s.pay_coupon_commission),
        "apply_min_inspections": bool(s.apply_min_inspections),
    }


_SETTING_FIELDS = ("point_value", "points_per_coupon", "factor_divisor", "absence_divisor",
                   "penalty_sales_pct", "penalty_per_thousand", "attribute_by_customer_rep",
                   "pay_coupon_commission", "apply_min_inspections")


def save_settings(db: Session, *, branch_id: int, data: dict, actor_user_id: int):
    _branch_or_error(db, branch_id)
    row = db.scalar(select(HrCommissionSetting).where(HrCommissionSetting.branch_id == branch_id))
    before = settings_out(row) if row is not None else None
    if row is None:
        row = get_settings(db, branch_id)
        db.add(row)
    for key in _SETTING_FIELDS:
        if key in data and data[key] is not None:
            setattr(row, key, data[key])
    if _d(row.factor_divisor) <= 0 or _d(row.absence_divisor) <= 0:
        raise CommissionSetupError("القاسم لازم يكون أكبر من صفر.")
    if _d(row.point_value) < 0 or int(row.points_per_coupon or 0) < 0:
        raise CommissionSetupError("قيمة النقطة ونقاط الكوبون مايبقوش بالسالب.")
    row.updated_by = actor_user_id
    db.flush()
    audit_service.record(db, action="hr_commission.settings", actor_user_id=actor_user_id,
                         entity_type="hr_commission_setting", entity_id=row.id,
                         before=_jsonable(before), after=_jsonable(settings_out(row)))
    return row


def _jsonable(d):
    if d is None:
        return None
    return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in d.items()}


def _branch_or_error(db: Session, branch_id: int) -> Branch:
    b = db.get(Branch, branch_id)
    if b is None:
        raise CommissionSetupError("الفرع غير موجود.")
    return b


def _check_employee(db: Session, branch_id: int, employee_id: int) -> Employee:
    e = db.get(Employee, employee_id)
    if e is None:
        raise CommissionSetupError("الموظف غير موجود.")
    if e.branch_id is not None and e.branch_id != branch_id:
        raise CommissionSetupError(f"«{e.name}» موظف في فرع تاني.")
    return e


def _check_rate(value, label: str) -> Decimal:
    v = _d(value)
    if v < 0 or v > 100:
        raise CommissionSetupError(f"{label} لازم تكون بين 0 و 100.")
    return v


def team_out(db: Session, t: HrCommissionTeam) -> dict:
    users = db.scalars(select(HrCommissionTeamUser).where(HrCommissionTeamUser.team_id == t.id)
                       .order_by(HrCommissionTeamUser.id)).all()
    members = db.scalars(select(HrCommissionTeamMember)
                         .where(HrCommissionTeamMember.team_id == t.id)
                         .order_by(HrCommissionTeamMember.id)).all()
    unames = _user_names(db, [u.user_id for u in users])
    enames = _employee_names(db, [m.employee_id for m in members])
    return {
        "id": t.id, "branch_id": t.branch_id, "name": t.name,
        "rate_poly": _d(t.rate_poly), "rate_white": _d(t.rate_white),
        "rate_other": _d(t.rate_other), "split_equally": bool(t.split_equally),
        "penalty_enabled": bool(t.penalty_enabled), "credit_limit": _d(t.credit_limit),
        "active": bool(t.active), "sort_order": int(t.sort_order or 0), "notes": t.notes,
        "users": [{"user_id": u.user_id, "name": unames.get(u.user_id)} for u in users],
        "members": [{"employee_id": m.employee_id, "name": enames.get(m.employee_id),
                     "exempt_25": bool(m.exempt_25)} for m in members],
    }


def save_team(db: Session, *, branch_id: int, data: dict, actor_user_id: int,
              team_id: int | None = None) -> HrCommissionTeam:
    _branch_or_error(db, branch_id)
    name = (data.get("name") or "").strip()
    if not name:
        raise CommissionSetupError("اسم السيارة مطلوب.")
    if team_id is not None:
        team = db.get(HrCommissionTeam, team_id)
        if team is None or team.branch_id != branch_id:
            raise CommissionSetupError("السيارة غير موجودة.")
        before = _jsonable({k: v for k, v in team_out(db, team).items()
                            if k not in ("users", "members")})
    else:
        team = HrCommissionTeam(branch_id=branch_id)
        db.add(team)
        before = None
    dup = db.scalar(select(HrCommissionTeam.id).where(
        HrCommissionTeam.branch_id == branch_id, HrCommissionTeam.name == name,
        HrCommissionTeam.id != (team_id or -1)))
    if dup:
        raise CommissionSetupError(f"فيه سيارة اسمها «{name}» في الفرع ده.")
    team.name = name
    team.rate_poly = _check_rate(data.get("rate_poly"), "نسبة البولي")
    team.rate_white = _check_rate(data.get("rate_white"), "نسبة الأبيض")
    team.rate_other = _check_rate(data.get("rate_other"), "نسبة التحصيل من غير عيلة")
    team.split_equally = bool(data.get("split_equally", True))
    team.penalty_enabled = bool(data.get("penalty_enabled", False))
    team.credit_limit = _d(data.get("credit_limit"))
    if _d(team.credit_limit) < 0:
        raise CommissionSetupError("الائتمان مايبقاش بالسالب.")
    team.active = bool(data.get("active", True))
    team.sort_order = int(data.get("sort_order") or 0)
    team.notes = (data.get("notes") or None)
    db.flush()

    if "users" in data and data["users"] is not None:
        wanted = []
        for uid in data["users"]:
            uid = int(uid)
            u = db.get(User, uid)
            if u is None:
                raise CommissionSetupError("حساب المندوب غير موجود.")
            if u.branch_id is not None and u.branch_id != branch_id:
                raise CommissionSetupError(f"«{u.full_name or u.username}» حساب في فرع تاني.")
            if uid not in wanted:
                wanted.append(uid)
        db.execute(delete(HrCommissionTeamUser).where(HrCommissionTeamUser.team_id == team.id))
        for uid in wanted:
            db.add(HrCommissionTeamUser(team_id=team.id, user_id=uid))
    if "members" in data and data["members"] is not None:
        seen: dict[int, bool] = {}
        for m in data["members"]:
            eid = int(m.get("employee_id"))
            _check_employee(db, branch_id, eid)
            seen[eid] = bool(m.get("exempt_25", False))
        db.execute(delete(HrCommissionTeamMember)
                   .where(HrCommissionTeamMember.team_id == team.id))
        for eid, exempt in seen.items():
            db.add(HrCommissionTeamMember(team_id=team.id, employee_id=eid, exempt_25=exempt))
    db.flush()
    audit_service.record(db, action="hr_commission.team", actor_user_id=actor_user_id,
                         entity_type="hr_commission_team", entity_id=team.id, before=before,
                         after=_jsonable({k: v for k, v in team_out(db, team).items()
                                          if k not in ("users", "members")})
                         | {"users": [u["user_id"] for u in team_out(db, team)["users"]],
                            "members": [m["employee_id"]
                                        for m in team_out(db, team)["members"]]})
    return team


def delete_team(db: Session, *, branch_id: int, team_id: int, actor_user_id: int) -> None:
    team = db.get(HrCommissionTeam, team_id)
    if team is None or team.branch_id != branch_id:
        raise CommissionSetupError("السيارة غير موجودة.")
    snapshot = _jsonable({k: v for k, v in team_out(db, team).items()
                          if k not in ("users", "members")})
    for model in (HrCommissionTeamUser, HrCommissionTeamMember, HrCommissionSupervisorTeam,
                  HrCommissionManualCollection):
        db.execute(delete(model).where(model.team_id == team_id))
    db.delete(team)
    db.flush()
    audit_service.record(db, action="hr_commission.team.delete", actor_user_id=actor_user_id,
                         entity_type="hr_commission_team", entity_id=team_id, before=snapshot)


def set_manual_collection(db: Session, *, branch_id: int, team_id: int, year: int, month: int,
                          poly, white, other, notes: str | None, actor_user_id: int) -> None:
    team = db.get(HrCommissionTeam, team_id)
    if team is None or team.branch_id != branch_id:
        raise CommissionSetupError("السيارة غير موجودة.")
    month_bounds(year, month)
    row = db.scalar(select(HrCommissionManualCollection).where(
        HrCommissionManualCollection.team_id == team_id,
        HrCommissionManualCollection.year == year, HrCommissionManualCollection.month == month))
    vals = {"poly": _d(poly), "white": _d(white), "other": _d(other)}
    before = None
    if row is not None:
        before = {"poly": str(row.poly), "white": str(row.white), "other": str(row.other)}
    if all(v == 0 for v in vals.values()) and not (notes or "").strip():
        if row is not None:
            db.delete(row)
    else:
        if row is None:
            row = HrCommissionManualCollection(team_id=team_id, year=year, month=month)
            db.add(row)
        row.poly, row.white, row.other = vals["poly"], vals["white"], vals["other"]
        row.notes = (notes or "").strip() or None
        row.actor_user_id = actor_user_id
    db.flush()
    audit_service.record(db, action="hr_commission.manual_collection",
                         actor_user_id=actor_user_id, entity_type="hr_commission_team",
                         entity_id=team_id, before=before,
                         after={"year": year, "month": month} | _jsonable(vals))


def supervisor_out(db: Session, s: HrCommissionSupervisor) -> dict:
    links = db.scalars(select(HrCommissionSupervisorTeam)
                       .where(HrCommissionSupervisorTeam.supervisor_id == s.id)).all()
    teams = {t.id: t.name for t in db.scalars(select(HrCommissionTeam).where(
        HrCommissionTeam.id.in_([lk.team_id for lk in links] or [-1]))).all()}
    return {
        "id": s.id, "branch_id": s.branch_id, "employee_id": s.employee_id,
        "employee_name": _employee_names(db, [s.employee_id]).get(s.employee_id),
        "label": s.label, "rate_poly": _d(s.rate_poly), "rate_white": _d(s.rate_white),
        "rate_other": _d(s.rate_other), "penalty_rate": _d(s.penalty_rate),
        "period_offset": int(s.period_offset or 0), "deduct_absence": bool(s.deduct_absence),
        "active": bool(s.active), "sort_order": int(s.sort_order or 0), "notes": s.notes,
        "teams": [{"team_id": lk.team_id, "name": teams.get(lk.team_id)} for lk in links],
    }


def save_supervisor(db: Session, *, branch_id: int, data: dict, actor_user_id: int,
                    supervisor_id: int | None = None) -> HrCommissionSupervisor:
    _branch_or_error(db, branch_id)
    if supervisor_id is not None:
        sup = db.get(HrCommissionSupervisor, supervisor_id)
        if sup is None or sup.branch_id != branch_id:
            raise CommissionSetupError("المشرف غير موجود.")
        before = _jsonable({k: v for k, v in supervisor_out(db, sup).items() if k != "teams"})
    else:
        sup = HrCommissionSupervisor(branch_id=branch_id)
        db.add(sup)
        before = None
    if not data.get("employee_id"):
        raise CommissionSetupError("اختار الموظف.")
    sup.employee_id = _check_employee(db, branch_id, int(data["employee_id"])).id
    sup.label = (data.get("label") or "").strip() or None
    sup.rate_poly = _check_rate(data.get("rate_poly"), "نسبة البولي")
    sup.rate_white = _check_rate(data.get("rate_white"), "نسبة الأبيض")
    sup.rate_other = _check_rate(data.get("rate_other"), "نسبة التحصيل من غير عيلة")
    sup.penalty_rate = _check_rate(data.get("penalty_rate"), "نسبة الخصم")
    offset = int(data.get("period_offset") or 0)
    if offset not in (0, 1):
        raise CommissionSetupError("الفترة: نفس الشهر أو الشهر اللي فات بس.")
    sup.period_offset = offset
    sup.deduct_absence = bool(data.get("deduct_absence", True))
    sup.active = bool(data.get("active", True))
    sup.sort_order = int(data.get("sort_order") or 0)
    sup.notes = data.get("notes") or None
    db.flush()
    if "teams" in data and data["teams"] is not None:
        wanted = []
        for tid in data["teams"]:
            t = db.get(HrCommissionTeam, int(tid))
            if t is None or t.branch_id != branch_id:
                raise CommissionSetupError("سيارة من بره الفرع.")
            if t.id not in wanted:
                wanted.append(t.id)
        db.execute(delete(HrCommissionSupervisorTeam)
                   .where(HrCommissionSupervisorTeam.supervisor_id == sup.id))
        for tid in wanted:
            db.add(HrCommissionSupervisorTeam(supervisor_id=sup.id, team_id=tid))
    db.flush()
    out = supervisor_out(db, sup)
    audit_service.record(db, action="hr_commission.supervisor", actor_user_id=actor_user_id,
                         entity_type="hr_commission_supervisor", entity_id=sup.id, before=before,
                         after=_jsonable({k: v for k, v in out.items() if k != "teams"})
                         | {"teams": [t["team_id"] for t in out["teams"]]})
    return sup


def delete_supervisor(db: Session, *, branch_id: int, supervisor_id: int,
                      actor_user_id: int) -> None:
    sup = db.get(HrCommissionSupervisor, supervisor_id)
    if sup is None or sup.branch_id != branch_id:
        raise CommissionSetupError("المشرف غير موجود.")
    snapshot = _jsonable({k: v for k, v in supervisor_out(db, sup).items() if k != "teams"})
    db.execute(delete(HrCommissionSupervisorTeam)
               .where(HrCommissionSupervisorTeam.supervisor_id == supervisor_id))
    db.delete(sup)
    db.flush()
    audit_service.record(db, action="hr_commission.supervisor.delete",
                         actor_user_id=actor_user_id, entity_type="hr_commission_supervisor",
                         entity_id=supervisor_id, before=snapshot)


def technician_out(db: Session, t: HrCommissionTechnician) -> dict:
    emp = db.get(Employee, t.employee_id)
    return {
        "id": t.id, "branch_id": t.branch_id, "employee_id": t.employee_id,
        "employee_name": emp.name if emp else None,
        "user_id": emp.user_id if emp else None,
        "user_name": _user_names(db, [emp.user_id]).get(emp.user_id) if emp and emp.user_id
        else None,
        "factor": _d(t.factor), "min_inspections": int(t.min_inspections or 0),
        "inspection_rate": _d(t.inspection_rate), "plumber_rate": _d(t.plumber_rate),
        "scope": t.scope or "own", "active": bool(t.active),
        "sort_order": int(t.sort_order or 0), "notes": t.notes,
    }


def save_technician(db: Session, *, branch_id: int, data: dict, actor_user_id: int,
                    technician_id: int | None = None) -> HrCommissionTechnician:
    _branch_or_error(db, branch_id)
    if technician_id is not None:
        tech = db.get(HrCommissionTechnician, technician_id)
        if tech is None or tech.branch_id != branch_id:
            raise CommissionSetupError("الفني غير موجود.")
        before = _jsonable(technician_out(db, tech))
    else:
        tech = HrCommissionTechnician(branch_id=branch_id)
        db.add(tech)
        before = None
    if not data.get("employee_id"):
        raise CommissionSetupError("اختار الموظف.")
    eid = _check_employee(db, branch_id, int(data["employee_id"])).id
    dup = db.scalar(select(HrCommissionTechnician.id).where(
        HrCommissionTechnician.branch_id == branch_id,
        HrCommissionTechnician.employee_id == eid,
        HrCommissionTechnician.id != (technician_id or -1)))
    if dup:
        raise CommissionSetupError("الموظف ده متسجّل فني قبل كده.")
    tech.employee_id = eid
    tech.factor = _d(data.get("factor"))
    tech.min_inspections = int(data.get("min_inspections") or 0)
    tech.inspection_rate = _d(data.get("inspection_rate"))
    tech.plumber_rate = _d(data.get("plumber_rate"))
    if min(_d(tech.factor), _d(tech.inspection_rate), _d(tech.plumber_rate)) < 0 \
            or tech.min_inspections < 0:
        raise CommissionSetupError("الأرقام مايبقوش بالسالب.")
    scope = data.get("scope") or "own"
    if scope not in ("own", "all"):
        raise CommissionSetupError("النطاق: شغله هو أو كل الفنيين.")
    tech.scope = scope
    tech.active = bool(data.get("active", True))
    tech.sort_order = int(data.get("sort_order") or 0)
    tech.notes = data.get("notes") or None
    db.flush()
    audit_service.record(db, action="hr_commission.technician", actor_user_id=actor_user_id,
                         entity_type="hr_commission_technician", entity_id=tech.id,
                         before=before, after=_jsonable(technician_out(db, tech)))
    return tech


def delete_technician(db: Session, *, branch_id: int, technician_id: int,
                      actor_user_id: int) -> None:
    tech = db.get(HrCommissionTechnician, technician_id)
    if tech is None or tech.branch_id != branch_id:
        raise CommissionSetupError("الفني غير موجود.")
    snapshot = _jsonable(technician_out(db, tech))
    db.delete(tech)
    db.flush()
    audit_service.record(db, action="hr_commission.technician.delete",
                         actor_user_id=actor_user_id, entity_type="hr_commission_technician",
                         entity_id=technician_id, before=snapshot)


def setup_payload(db: Session, branch_id: int) -> dict:
    branch = _branch_or_error(db, branch_id)
    teams = db.scalars(select(HrCommissionTeam).where(HrCommissionTeam.branch_id == branch_id)
                       .order_by(HrCommissionTeam.sort_order, HrCommissionTeam.id)).all()
    sups = db.scalars(select(HrCommissionSupervisor)
                      .where(HrCommissionSupervisor.branch_id == branch_id)
                      .order_by(HrCommissionSupervisor.sort_order,
                                HrCommissionSupervisor.id)).all()
    techs = db.scalars(select(HrCommissionTechnician)
                       .where(HrCommissionTechnician.branch_id == branch_id)
                       .order_by(HrCommissionTechnician.sort_order,
                                 HrCommissionTechnician.id)).all()
    emps = db.scalars(select(Employee).where(
        or_(Employee.branch_id == branch_id, Employee.branch_id.is_(None)))
        .order_by(Employee.name)).all()
    roles = {r.id: r.name for r in db.scalars(select(Role)).all()}
    users = db.scalars(select(User).where(
        or_(User.branch_id == branch_id, User.branch_id.is_(None)))
        .order_by(User.full_name)).all()
    rep_roles = {RoleName.sales_rep, RoleName.after_sales_staff}
    return {
        "branch": {"id": branch.id, "name": branch.name},
        "settings": settings_out(get_settings(db, branch_id)),
        "teams": [team_out(db, t) for t in teams],
        "supervisors": [supervisor_out(db, s) for s in sups],
        "technicians": [technician_out(db, t) for t in techs],
        "options": {
            "employees": [{"id": e.id, "name": e.name, "code": e.code, "active": bool(e.active),
                           "user_id": e.user_id} for e in emps],
            "users": [{"id": u.id, "name": u.full_name or u.username, "username": u.username,
                       "role": getattr(roles.get(u.role_id), "value", None),
                       "active": bool(u.active)}
                      for u in users if roles.get(u.role_id) in rep_roles],
        },
    }


def _team_users(db: Session, teams: list[HrCommissionTeam]) -> dict[int, list[int]]:
    ids = [t.id for t in teams] or [-1]
    out: dict[int, list[int]] = defaultdict(list)
    for tu in db.scalars(select(HrCommissionTeamUser)
                         .where(HrCommissionTeamUser.team_id.in_(ids))).all():
        out[tu.team_id].append(tu.user_id)
    missing = [t.id for t in teams if not out.get(t.id)]
    if missing:
        rows = db.execute(
            select(HrCommissionTeamMember.team_id, Employee.user_id)
            .join(Employee, Employee.id == HrCommissionTeamMember.employee_id)
            .where(HrCommissionTeamMember.team_id.in_(missing), Employee.user_id.is_not(None))
        ).all()
        for tid, uid in rows:
            out[tid].append(uid)
    return out


def _voucher_families(db: Session, entry_ids: list[int]) -> dict[int, dict[str, Decimal]]:
    out: dict[int, dict[str, Decimal]] = {}
    ids = [i for i in entry_ids if i]
    for start in range(0, len(ids), 2000):
        chunk = ids[start:start + 2000]
        rows = db.execute(
            select(LedgerLine.entry_id, CustomerAccount.family, func.sum(LedgerLine.amount))
            .join(CustomerAccount, CustomerAccount.account_id == LedgerLine.account_id)
            .where(LedgerLine.entry_id.in_(chunk))
            .group_by(LedgerLine.entry_id, CustomerAccount.family)
        ).all()
        for eid, fam, amount in rows:
            bucket = out.setdefault(eid, _fam())
            bucket[family_key(fam)] += abs(_d(amount))
    return out


def collections_by_user(db: Session, user_ids, d1: date, d2: date, *,
                        attribute_by_customer_rep: bool = True) -> dict[int, dict]:
    users = set(u for u in user_ids if u)
    out: dict[int, dict] = {}
    if not users:
        return out

    def slot(uid: int) -> dict:
        return out.setdefault(uid, _fam() | {"invoice_cash": ZERO, "receipts": ZERO,
                                             "via_customer": ZERO, "receipt_count": 0})

    day = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    rep_cond = SalesInvoice.rep_id.in_(users)
    if attribute_by_customer_rep:
        rep_cond = or_(rep_cond, and_(SalesInvoice.rep_id.is_(None), Customer.rep_id.in_(users)))
    for cash, fam, inv_rep, cust_rep in db.execute(
        select(SalesInvoice.cash_amount, SalesInvoice.family, SalesInvoice.rep_id,
               Customer.rep_id)
        .outerjoin(Customer, Customer.id == SalesInvoice.customer_id)
        .where(SalesInvoice.cash_amount > 0,
               or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
               day >= d1, day <= d2, rep_cond)
    ).all():
        uid = inv_rep if inv_rep in users else cust_rep
        if uid not in users:
            continue
        s = slot(uid)
        amount = _d(cash)
        s[family_key(fam)] += amount
        s["invoice_cash"] += amount
        if inv_rep is None:
            s["via_customer"] += amount

    vcond = or_(Voucher.rep_user_id.in_(users),
                and_(Voucher.rep_user_id.is_(None), Voucher.actor_user_id.in_(users)))
    if attribute_by_customer_rep:
        vcond = or_(vcond, and_(Voucher.rep_user_id.is_(None), Customer.rep_id.in_(users)))
    rows = db.execute(
        select(Voucher.amount, Voucher.family, Voucher.reverses_id, Voucher.ledger_entry_id,
               Voucher.rep_user_id, Voucher.actor_user_id, Customer.rep_id)
        .join(Customer, Customer.id == Voucher.customer_id)
        .where(Voucher.kind == VoucherKind.receipt, Voucher.voucher_date >= d1,
               Voucher.voucher_date <= d2, vcond)
    ).all()
    split = _voucher_families(db, [r[3] for r in rows if not r[1]])
    for amount, fam, reverses_id, entry_id, rep_uid, actor_uid, cust_rep in rows:
        via_customer = False
        if rep_uid is not None:
            uid = rep_uid
        elif actor_uid in users:
            uid = actor_uid
        else:
            uid, via_customer = cust_rep, True
        if uid not in users:
            continue
        value = -_d(amount) if reverses_id is not None else _d(amount)
        s = slot(uid)
        if fam:
            s[family_key(fam)] += value
        else:
            parts = split.get(entry_id)
            total = sum(parts.values(), ZERO) if parts else ZERO
            if total > 0:
                for k in FAMILIES:
                    s[k] += value * parts[k] / total
            else:
                s["other"] += value
        s["receipts"] += value
        s["receipt_count"] += -1 if reverses_id is not None else 1
        if via_customer:
            s["via_customer"] += value
    return out


def sales_by_user(db: Session, user_ids, d1: date, d2: date, *,
                  attribute_by_customer_rep: bool = True) -> dict[int, Decimal]:
    users = set(u for u in user_ids if u)
    out: dict[int, Decimal] = defaultdict(lambda: ZERO)
    if not users:
        return out
    day = func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))
    cond = SalesInvoice.rep_id.in_(users)
    if attribute_by_customer_rep:
        cond = or_(cond, and_(SalesInvoice.rep_id.is_(None), Customer.rep_id.in_(users)))
    for net, inv_rep, cust_rep in db.execute(
        select(SalesInvoice.net, SalesInvoice.rep_id, Customer.rep_id)
        .outerjoin(Customer, Customer.id == SalesInvoice.customer_id)
        .where(or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
               day >= d1, day <= d2, cond)
    ).all():
        uid = inv_rep if inv_rep in users else cust_rep
        if uid in users:
            out[uid] += _d(net)
    rday = func.coalesce(SalesReturn.return_date, cast(SalesReturn.created_at, Date))
    rcond = SalesReturn.rep_id.in_(users)
    if attribute_by_customer_rep:
        rcond = or_(rcond, and_(SalesReturn.rep_id.is_(None), Customer.rep_id.in_(users)))
    for value, ret_rep, cust_rep in db.execute(
        select(SalesReturn.value, SalesReturn.rep_id, Customer.rep_id)
        .join(Customer, Customer.id == SalesReturn.customer_id)
        .where(SalesReturn.reversed_at.is_(None), rday >= d1, rday <= d2, rcond)
    ).all():
        uid = ret_rep if ret_rep in users else cust_rep
        if uid in users:
            out[uid] -= _d(value)
    return out


def debt_by_user(db: Session, user_ids, as_of: date) -> dict[int, Decimal]:
    from src.services import customer_profile_service

    users = [u for u in set(user_ids) if u]
    out: dict[int, Decimal] = defaultdict(lambda: ZERO)
    if not users:
        return out
    base = customer_profile_service.apply_filters(
        select(Customer.id, Customer.rep_id)
    ).where(Customer.customer_type != "owner", Customer.rep_id.in_(users)).subquery()
    bal = customer_profile_service.family_balances_subquery(as_of)
    for rep, total in db.execute(
        select(base.c.rep_id, bal.c.total)
        .select_from(base.join(bal, bal.c.customer_id == base.c.id))
    ).all():
        t = _d(total)
        if t > 0:
            out[rep] += t
    return out


def _plumber_key(phone, name) -> str | None:
    from src.lib import phones
    from src.services.customer_merge_service import match_key

    p = phones.normalize(phone) if phone else None
    if p:
        return f"p:{p}"
    n = match_key(name or "")
    return f"n:{n}" if n else None


def technician_stats(db: Session, user_ids, d1: date, d2: date) -> dict[int, dict]:
    users = set(u for u in user_ids if u)
    out: dict[int, dict] = {u: {"coupons": 0, "inspections": 0, "plumbers": set()}
                            for u in users}
    if not users:
        return out
    cday = func.coalesce(CouponReceipt.received_date, cast(CouponReceipt.created_at, Date))
    for uid, count, notes, cust_id, cust_name, cust_phone, cust_type in db.execute(
        select(CouponReceipt.rep_user_id, CouponReceipt.coupon_count, CouponReceipt.notes,
               Customer.id, Customer.name, Customer.phone, Customer.customer_type)
        .outerjoin(Customer, Customer.id == CouponReceipt.customer_id)
        .where(CouponReceipt.rep_user_id.in_(users), receipt_counted(),
               cday >= d1, cday <= d2)
    ).all():
        o = out[uid]
        o["coupons"] += int(count or 0)
        key = None
        if cust_id is not None and (cust_type or "") == "plumber":
            key = _plumber_key(cust_phone, cust_name)
        elif cust_id is None and notes and "الفني:" in notes:
            key = _plumber_key(None, notes.split("الفني:", 1)[1].split("\n")[0])
        if key:
            o["plumbers"].add(key)
    for uid, name, phone in db.execute(
        select(Inspection.rep_user_id, Inspection.technician_name, Inspection.technician_phone)
        .where(Inspection.rep_user_id.in_(users),
               Inspection.visit_kind == VisitKind.technician,
               Inspection.status == InspectionStatus.accepted,
               Inspection.inspection_date >= d1, Inspection.inspection_date <= d2)
    ).all():
        o = out[uid]
        o["inspections"] += 1
        key = _plumber_key(phone, name)
        if key:
            o["plumbers"].add(key)
    return out


def _manual(db: Session, team_ids, year: int, month: int) -> dict[int, dict[str, Decimal]]:
    rows = db.scalars(select(HrCommissionManualCollection).where(
        HrCommissionManualCollection.team_id.in_(list(team_ids) or [-1]),
        HrCommissionManualCollection.year == year,
        HrCommissionManualCollection.month == month)).all()
    return {r.team_id: {"poly": _d(r.poly), "white": _d(r.white), "other": _d(r.other),
                        "notes": r.notes} for r in rows}


def compute(db: Session, *, branch_id: int, year: int, month: int,
            absences: dict | None = None) -> dict:
    _branch_or_error(db, branch_id)
    year, month = int(year), int(month)
    d1, d2 = month_bounds(year, month)
    st = get_settings(db, branch_id)
    attr = bool(st.attribute_by_customer_rep)
    abs_div = _d(st.absence_divisor) or Decimal("30")
    warnings: list[str] = []

    teams = db.scalars(select(HrCommissionTeam).where(
        HrCommissionTeam.branch_id == branch_id, HrCommissionTeam.active.is_(True))
        .order_by(HrCommissionTeam.sort_order, HrCommissionTeam.id)).all()
    sups = db.scalars(select(HrCommissionSupervisor).where(
        HrCommissionSupervisor.branch_id == branch_id, HrCommissionSupervisor.active.is_(True))
        .order_by(HrCommissionSupervisor.sort_order, HrCommissionSupervisor.id)).all()
    techs = db.scalars(select(HrCommissionTechnician).where(
        HrCommissionTechnician.branch_id == branch_id, HrCommissionTechnician.active.is_(True))
        .order_by(HrCommissionTechnician.sort_order, HrCommissionTechnician.id)).all()
    team_by_id = {t.id: t for t in teams}
    team_users = _team_users(db, teams)
    members: dict[int, list[HrCommissionTeamMember]] = defaultdict(list)
    for m in db.scalars(select(HrCommissionTeamMember).where(
            HrCommissionTeamMember.team_id.in_([t.id for t in teams] or [-1]))
            .order_by(HrCommissionTeamMember.id)).all():
        members[m.team_id].append(m)
    sup_links: dict[int, list[int]] = defaultdict(list)
    for lk in db.scalars(select(HrCommissionSupervisorTeam).where(
            HrCommissionSupervisorTeam.supervisor_id.in_([s.id for s in sups] or [-1]))).all():
        sup_links[lk.supervisor_id].append(lk.team_id)

    emp_ids = {m.employee_id for ms in members.values() for m in ms} \
        | {s.employee_id for s in sups} | {t.employee_id for t in techs}
    emps = {e.id: e for e in db.scalars(select(Employee).where(
        Employee.id.in_(list(emp_ids) or [-1]))).all()}
    att = absent_days(db, emp_ids, year, month)
    if absences:
        for k, v in absences.items():
            att[int(k)] = _d(v)

    result: dict = {}

    def emp_row(eid: int) -> dict:
        if eid not in result:
            e = emps.get(eid)
            result[eid] = {"name": e.name if e else f"#{eid}"} | {k: ZERO for k in AMOUNT_KEYS}
            result[eid]["absent_days"] = att.get(eid, ZERO)
            if e is not None and not e.active:
                warnings.append(f"«{e.name}» موظف موقوف ولسه في إعدادات العمولات.")
        return result[eid]

    all_users = {u for us in team_users.values() for u in us}
    coll_cache: dict[tuple[int, int], dict[int, dict]] = {}

    def team_collections(period: tuple[int, int]) -> dict[int, dict]:
        if period in coll_cache:
            return coll_cache[period]
        p1, p2 = month_bounds(*period)
        per_user = collections_by_user(db, all_users, p1, p2, attribute_by_customer_rep=attr)
        manual = _manual(db, team_by_id.keys(), *period)
        out = {}
        for t in teams:
            agg = _fam() | {"invoice_cash": ZERO, "receipts": ZERO, "via_customer": ZERO,
                            "receipt_count": 0}
            for uid in team_users.get(t.id, []):
                for k, v in per_user.get(uid, {}).items():
                    agg[k] += v
            man = manual.get(t.id)
            agg["manual"] = {k: (man or {}).get(k, ZERO) for k in FAMILIES}
            agg["manual_notes"] = (man or {}).get("notes")
            for k in FAMILIES:
                agg[k] += agg["manual"][k]
            agg["total"] = sum((agg[k] for k in FAMILIES), ZERO)
            out[t.id] = agg
        coll_cache[period] = out
        return out

    current = team_collections((year, month))

    team_details = []
    for t in teams:
        c = current[t.id]
        rates = {"poly": _d(t.rate_poly), "white": _d(t.rate_white), "other": _d(t.rate_other)}
        parts = {k: c[k] * rates[k] / HUNDRED for k in FAMILIES}
        gross = sum(parts.values(), ZERO)
        ms = members[t.id]
        n = len(ms)
        share = (gross / n if (n and t.split_equally) else gross)
        if not team_users.get(t.id) and c["total"] == 0:
            warnings.append(f"«{t.name}»: مالهاش حسابات مناديب ولا تحصيل يدوي — تحصيلها صفر.")
        if not ms and gross > 0:
            warnings.append(f"«{t.name}»: عمولتها {to_money(gross)} ومالهاش أفراد يقبضوها.")
        mrows = []
        for m in ms:
            days = att.get(m.employee_id, ZERO)
            ded = min(share, share / abs_div * days) if days > 0 else ZERO
            net = share - ded
            row = emp_row(m.employee_id)
            row["commission"] += net
            mrows.append({"employee_id": m.employee_id, "name": row["name"],
                          "exempt_25": bool(m.exempt_25), "absent_days": days,
                          "share": to_money(share), "absence_deduction": to_money(ded),
                          "net": to_money(net)})
        team_details.append({
            "id": t.id, "name": t.name,
            "users": [{"user_id": u, "name": n_} for u, n_ in
                      _user_names(db, team_users.get(t.id, [])).items()],
            "collections": {k: to_money(c[k]) for k in (*FAMILIES, "total", "invoice_cash",
                                                          "receipts", "via_customer")}
            | {"receipt_count": c["receipt_count"], "manual": _money_dict(c["manual"]),
               "manual_notes": c["manual_notes"]},
            "rates": rates, "parts": _money_dict(parts), "commission": to_money(gross),
            "split_equally": bool(t.split_equally), "member_count": n,
            "share_per_member": to_money(share), "members": mrows,
        })

    pen_users = {u for t in teams if t.penalty_enabled for u in team_users.get(t.id, [])}
    sales = sales_by_user(db, pen_users, d1, d2, attribute_by_customer_rep=attr)
    debts = debt_by_user(db, pen_users, d2)
    pct = _d(st.penalty_sales_pct)
    per_k = _d(st.penalty_per_thousand)
    excess_by_team: dict[int, Decimal] = {}
    for td, t in zip(team_details, teams, strict=True):
        if not t.penalty_enabled:
            td["penalty"] = {"enabled": False}
            continue
        uids = team_users.get(t.id, [])
        s_total = sum((sales.get(u, ZERO) for u in uids), ZERO)
        d_total = sum((debts.get(u, ZERO) for u in uids), ZERO)
        credit = _d(t.credit_limit)
        after_credit = d_total - credit
        pct_amount = s_total * pct / HUNDRED
        excess = after_credit - pct_amount
        excess_by_team[t.id] = excess
        penalty = excess / THOUSAND * per_k if excess > 0 else ZERO
        ms = members[t.id]
        each = penalty / len(ms) if ms else penalty
        mrows = []
        for m in ms:
            amount = ZERO if m.exempt_25 else each
            emp_row(m.employee_id)["penalty_25"] += amount
            mrows.append({"employee_id": m.employee_id, "name": emp_row(m.employee_id)["name"],
                          "exempt_25": bool(m.exempt_25), "amount": to_money(amount)})
        td["penalty"] = {
            "enabled": True, "sales": to_money(s_total), "sales_pct": pct,
            "sales_pct_amount": to_money(pct_amount), "debt": to_money(d_total),
            "credit_limit": to_money(credit), "debt_after_credit": to_money(after_credit),
            "excess": to_money(excess), "per_thousand": per_k, "penalty": to_money(penalty),
            "share_per_member": to_money(each), "members": mrows,
        }

    sup_details = []
    for s in sups:
        period = shift_month(year, month, int(s.period_offset or 0))
        coll = team_collections(period)
        tids = [tid for tid in sup_links.get(s.id, []) if tid in team_by_id]
        if not tids:
            warnings.append(f"المشرف «{emp_row(s.employee_id)['name']}» مالوش سيارات.")
        totals = _fam()
        trows = []
        for tid in tids:
            c = coll[tid]
            for k in FAMILIES:
                totals[k] += c[k]
            trows.append({"team_id": tid, "name": team_by_id[tid].name}
                         | {k: to_money(c[k]) for k in (*FAMILIES, "total")})
        rates = {"poly": _d(s.rate_poly), "white": _d(s.rate_white), "other": _d(s.rate_other)}
        parts = {k: totals[k] * rates[k] / HUNDRED for k in FAMILIES}
        gross = sum(parts.values(), ZERO)
        days = att.get(s.employee_id, ZERO) if s.deduct_absence else ZERO
        ded = min(gross, gross / abs_div * days) if days > 0 else ZERO
        net = gross - ded
        row = emp_row(s.employee_id)
        row["supervision"] += net
        pen_base = sum((max(excess_by_team.get(tid, ZERO), ZERO) for tid in tids), ZERO)
        pen = pen_base * _d(s.penalty_rate) / HUNDRED
        row["penalty_25"] += pen
        if _d(s.penalty_rate) > 0 and not any(team_by_id[t].penalty_enabled for t in tids):
            warnings.append(f"المشرف «{row['name']}» عليه نسبة خصم وسياراته مافيهاش خصم ٢٥٪.")
        sup_details.append({
            "id": s.id, "employee_id": s.employee_id, "name": row["name"], "label": s.label,
            "period": {"year": period[0], "month": period[1]},
            "period_offset": int(s.period_offset or 0), "teams": trows,
            "totals": _money_dict(totals) | {"total": to_money(sum(totals.values(), ZERO))},
            "rates": rates, "parts": _money_dict(parts), "gross": to_money(gross),
            "deduct_absence": bool(s.deduct_absence), "absent_days": days,
            "absence_deduction": to_money(ded), "net": to_money(net),
            "penalty_rate": _d(s.penalty_rate), "penalty_base": to_money(pen_base),
            "penalty": to_money(pen),
        })

    tech_users = {}
    for t in techs:
        e = emps.get(t.employee_id)
        tech_users[t.id] = e.user_id if e else None
        if e is not None and e.user_id is None:
            warnings.append(f"الفني «{e.name}» مالوش حساب على التطبيق — كوبوناته ومعايناته صفر.")
    stats = technician_stats(db, [u for u in tech_users.values() if u], d1, d2)
    own = [t for t in techs if (t.scope or "own") == "own"]
    all_coupons = sum((stats.get(tech_users[t.id], {}).get("coupons", 0) for t in own), 0)
    all_insp = sum((stats.get(tech_users[t.id], {}).get("inspections", 0) for t in own), 0)
    pv = _d(st.point_value)
    ppc = int(st.points_per_coupon or 0)
    div = _d(st.factor_divisor) or Decimal("600")
    if techs and pv == 0:
        warnings.append("قيمة النقطة صفر — عمولة الكوبونات هتطلع صفر.")
    tech_details = []
    for t in techs:
        st_ = stats.get(tech_users[t.id], {"coupons": 0, "inspections": 0, "plumbers": set()})
        mine_c, mine_i = st_["coupons"], st_["inspections"]
        if (t.scope or "own") == "all":
            coupons, inspections = all_coupons + mine_c, all_insp + mine_i
        else:
            coupons, inspections = mine_c, mine_i
        points = coupons * ppc
        points_value = Decimal(points) * pv
        rate = _d(t.factor) / div
        coupon_comm = points_value * rate
        mn = int(t.min_inspections or 0)
        per_insp = coupon_comm / mn if mn > 0 else ZERO
        shortfall = max(mn - inspections, 0) if mn > 0 else 0
        min_ded = min(coupon_comm, per_insp * shortfall)
        payable = ZERO
        if st.pay_coupon_commission:
            payable = coupon_comm - (min_ded if st.apply_min_inspections else ZERO)
        insp_comm = Decimal(inspections) * _d(t.inspection_rate)
        plumbers = len(st_["plumbers"]) if (t.scope or "own") == "own" else 0
        bonus = Decimal(plumbers) * _d(t.plumber_rate)
        row = emp_row(t.employee_id)
        row["coupon_commission"] += coupon_comm
        row["min_inspection_deduction"] += min_ded
        row["coupon_commission_payable"] += payable
        row["inspection_commission"] += insp_comm
        row["technician_bonus"] += bonus
        tech_details.append({
            "id": t.id, "employee_id": t.employee_id, "name": row["name"],
            "user_id": tech_users[t.id], "scope": t.scope or "own",
            "coupons": coupons, "points": points, "points_value": to_money(points_value),
            "factor": _d(t.factor), "rate": rate, "coupon_commission": to_money(coupon_comm),
            "inspections": inspections, "min_inspections": mn,
            "per_inspection_share": to_money(per_insp), "shortfall": shortfall,
            "min_inspection_deduction": to_money(min_ded),
            "coupon_commission_payable": to_money(payable),
            "inspection_rate": _d(t.inspection_rate), "inspection_commission": to_money(insp_comm),
            "plumbers": plumbers, "plumber_rate": _d(t.plumber_rate),
            "technician_bonus": to_money(bonus),
            "total": to_money(payable + insp_comm + bonus),
        })

    for row in result.values():
        row["earnings"] = (row["commission"] + row["supervision"] + row["inspection_commission"]
                           + row["technician_bonus"] + row["coupon_commission_payable"])
        row["deductions"] = row["penalty_25"]
        for k in AMOUNT_KEYS:
            row[k] = to_money(row[k])

    if not teams and not sups and not techs:
        warnings.append("مافيش إعدادات عمولات للفرع ده لسه.")

    result["details"] = {
        "branch_id": branch_id, "year": year, "month": month,
        "period": {"from": d1.isoformat(), "to": d2.isoformat()},
        "settings": settings_out(st),
        "teams": team_details, "supervisors": sup_details, "technicians": tech_details,
        "warnings": list(dict.fromkeys(warnings)),
    }
    return result
