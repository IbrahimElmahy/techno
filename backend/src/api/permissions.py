from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy.orm import Session

from src.auth import rbac
from src.auth.dependencies import CurrentUser, get_current_user
from src.core.db import get_db
from src.models.permission import RoleCapability
from src.models.role import RoleName
from src.services.audit_service import record as audit_record

router = APIRouter(tags=["permissions"])

CAPABILITY_LABELS: dict[str, str] = {
    "user.read": "عرض المستخدمين",
    "user.write": "إضافة وتعديل المستخدمين",
    "user.deactivate": "إيقاف مستخدم",
    "branch.read": "عرض الفروع",
    "branch.write": "إضافة وتعديل الفروع",
    "governorate.read": "عرض المحافظات",
    "territory.read": "عرض المناطق",
    "territory.write": "إضافة وتعديل المناطق",
    "warehouse.read": "عرض المخازن",
    "warehouse.write": "إضافة وتعديل المخازن",
    "custody.read": "عرض عهدة المندوبين",
    "custody.write": "تعديل عهدة المندوبين",
    "customer.read": "عرض العملاء",
    "customer.write": "إضافة وتعديل العملاء",
    "customer.reassign": "نقل عميل إلى مندوب آخر",
    "supplier.read": "عرض الموردين",
    "supplier.write": "إضافة وتعديل الموردين",
    "catalog.read": "عرض الأصناف",
    "catalog.write": "إضافة وتعديل الأصناف",
    "stock.read": "عرض أرصدة المخزون",
    "transfer.initiate": "طلب تحويل مخزني",
    "transfer.approve": "اعتماد تحويل مخزني",
    "sales.read": "عرض المبيعات",
    "sale.write": "تسجيل فاتورة بيع",
    "sale.edit": "تعديل فاتورة بيع",
    "sale.delete": "حذف فاتورة بيع",
    "sell.below_price": "البيع تحت السعر المحدد",
    "sell.below_cost": "البيع تحت سعر التكلفة",
    "return.write": "تسجيل مرتجع",
    "purchase.write": "تسجيل فاتورة شراء",
    "treasury.read": "عرض الخزينة",
    "voucher.read": "عرض السندات",
    "voucher.write": "تسجيل سندات قبض وصرف",
    "ledger.read": "عرض دفتر الأستاذ",
    "ledger.post": "ترحيل قيد",
    "ledger.reverse": "عكس قيد",
    "accounting.chart.read": "عرض شجرة الحسابات",
    "accounting.chart.write": "تعديل شجرة الحسابات",
    "accounting.journal.post": "ترحيل قيد يومية",
    "accounting.journal.reverse": "عكس قيد يومية",
    "accounting.trial_balance.read": "عرض ميزان المراجعة",
    "audit.read": "عرض سجل العمليات",
    "settings.write": "تعديل إعدادات النظام",
    "loyalty.read": "عرض نقاط الولاء",
    "loyalty_settings.write": "تعديل إعدادات الولاء",
    "points.convert": "تحويل النقاط",
    "product_points.write": "تحديد نقاط الأصناف",
    "coupon.receive": "استلام الكوبونات",
    "coupon.custody": "عهدة الكوبونات للمناديب",
    "coupon.redeem": "صرف الكوبونات",
    "coupon.reverse": "إلغاء صرف كوبون",
    "inspection.read": "عرض المعاينات",
    "inspection.write": "تسجيل المعاينات",
    "manufacture.read": "عرض أوامر التصنيع",
    "manufacture.write": "تسجيل أوامر التصنيع",
    "hr.read": "عرض الموظفين",
    "hr.write": "إضافة وتعديل الموظفين",
    "payroll.read": "عرض الرواتب",
    "payroll.post": "ترحيل الرواتب",
    "salary.view": "عرض قيمة الراتب",
    "stats.view": "كروت الإحصائيات",
    "fleet.read": "عرض إدارة السيارات",
    "fleet.write": "تسجيل حركات السيارات (مسؤول الأسطول)",
    **rbac.APP_CAPABILITIES,
}

GROUPS: list[tuple[str, list[str]]] = [
    ("المستخدمين والصلاحيات", ["user.", "audit.", "settings."]),
    ("الهيكل التنظيمي", ["branch.", "governorate.", "territory."]),
    ("المخازن والأصناف", ["warehouse.", "catalog.", "stock.", "transfer.", "custody."]),
    ("العملاء والموردين", ["customer.", "supplier."]),
    ("المبيعات", ["sales.", "sale.", "sell.", "return."]),
    ("المشتريات", ["purchase."]),
    ("الحسابات والخزينة", ["treasury.", "voucher.", "ledger.", "accounting."]),
    ("الولاء والكوبونات", ["loyalty", "points.", "product_points.", "coupon."]),
    ("ما بعد البيع والتصنيع", ["inspection.", "manufacture."]),
    ("الموارد البشرية", ["hr.", "payroll.", "salary."]),
    ("إدارة السيارات", ["fleet."]),
    ("الإحصائيات", ["stats."]),
    ("التطبيق (الموبايل)", ["app."]),
]

ROLE_LABELS: dict[str, str] = {
    "system_admin": "مدير النظام",
    "branch_manager": "مدير فرع",
    "purchasing_manager": "مدير مشتريات",
    "sales_manager": "مدير مبيعات",
    "after_sales_staff": "خدمة ما بعد البيع",
    "sales_rep": "مندوب مبيعات",
    "accountant": "محاسب",
    "viewer": "قارئ",
    "owner": "المالك",
    "rep_supervisor": "مشرف مناديب",
}


def _group_of(cap: str) -> str:
    for title, prefixes in GROUPS:
        if any(cap.startswith(p) for p in prefixes):
            return title
    return "أخرى"


def _admin_only(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "الصلاحيات لمدير النظام وحده."})
    return current


class CapabilityOut(BaseModel):
    key: str
    label: str
    group: str


class RoleOut(BaseModel):
    role: str
    label: str
    capabilities: list[str]
    is_default: bool
    editable: bool


class PermissionsOut(BaseModel):
    capabilities: list[CapabilityOut]
    roles: list[RoleOut]


class RoleUpdate(BaseModel):
    capabilities: list[str]


def _role_out(role: RoleName, *, is_default: bool) -> RoleOut:
    return RoleOut(
        role=role.value,
        label=ROLE_LABELS.get(role.value, role.value),
        capabilities=sorted(
            rbac.ALL_CAPABILITIES if role == RoleName.system_admin
            else rbac.effective_capabilities(role)),
        is_default=is_default,
        editable=role != RoleName.system_admin,
    )


@router.get("/permissions", response_model=PermissionsOut)
def read_permissions(
    _: CurrentUser = Depends(_admin_only),
    db: Session = Depends(get_db),
) -> PermissionsOut:
    stored = {r.role for r in db.query(RoleCapability.role).distinct().all()}
    return PermissionsOut(
        capabilities=[
            CapabilityOut(key=c, label=CAPABILITY_LABELS.get(c, c), group=_group_of(c))
            for c in sorted(rbac.ALL_CAPABILITIES)
        ],
        roles=[_role_out(r, is_default=r not in stored) for r in RoleName],
    )


@router.put("/permissions/{role}", response_model=RoleOut)
def set_role_permissions(
    role: RoleName,
    body: RoleUpdate,
    current: CurrentUser = Depends(_admin_only),
    db: Session = Depends(get_db),
) -> RoleOut:
    if role == RoleName.system_admin:
        raise HTTPException(status.HTTP_409_CONFLICT, {
            "code": "role_locked",
            "message": "يحتفظ مدير النظام بصلاحياته كاملة دائماً — وإلا فلن يتمكن أحد من استعادتها.",
        })
    unknown = sorted(set(body.capabilities) - rbac.ALL_CAPABILITIES)
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "unknown_capability",
            "message": "صلاحيات غير معروفة: " + "، ".join(unknown),
        })

    before = sorted(rbac.effective_capabilities(role))
    wanted = sorted(set(body.capabilities))
    db.execute(delete(RoleCapability).where(RoleCapability.role == role))
    for cap in wanted:
        db.add(RoleCapability(role=role, capability=cap, actor_user_id=current.id))
    db.flush()
    audit_record(db, action="permissions.update", actor_user_id=current.id,
                 entity_type="role", entity_id=None,
                 before={"role": role.value, "capabilities": before},
                 after={"role": role.value, "capabilities": wanted})
    db.commit()
    rbac.refresh_overrides(db)
    return _role_out(role, is_default=False)


@router.delete("/permissions/{role}", response_model=RoleOut)
def reset_role_permissions(
    role: RoleName,
    current: CurrentUser = Depends(_admin_only),
    db: Session = Depends(get_db),
) -> RoleOut:
    before = sorted(rbac.effective_capabilities(role))
    db.execute(delete(RoleCapability).where(RoleCapability.role == role))
    db.flush()
    audit_record(db, action="permissions.reset", actor_user_id=current.id,
                 entity_type="role", entity_id=None,
                 before={"role": role.value, "capabilities": before}, after=None)
    db.commit()
    rbac.refresh_overrides(db)
    return _role_out(role, is_default=True)


from src.auth.rbac import CAP_USER_WRITE  # noqa: E402
from src.models.permission import UserCapability  # noqa: E402
from src.models.user import User  # noqa: E402

PAGE_PREFIX = "page:"


def _manager(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.is_admin:
        return current
    if not current.can(CAP_USER_WRITE) or current.branch_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "forbidden", "message": "غير مسموح لك بإدارة صلاحيات المستخدمين."})
    return current


def _role_name(db: Session, user: User) -> RoleName:
    from src.models.role import Role

    return db.get(Role, user.role_id).name


def _manageable(db: Session, current: CurrentUser, user: User | None) -> User:
    from src.api.users import BELOW_BRANCH_MANAGER

    if user is None:
        raise HTTPException(404, {"code": "not_found", "message": "المستخدم غير موجود."})
    role = _role_name(db, user)
    if current.is_admin:
        if role in (RoleName.system_admin, RoleName.owner) and not current.is_owner:
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "لا تُعدَّل صلاحيات مدير النظام أو المالك إلا من المالك."})
        return user
    if user.branch_id != current.branch_id or role not in BELOW_BRANCH_MANAGER:
        raise HTTPException(404, {"code": "not_found", "message": "المستخدم غير موجود."})
    return user


def _assignable(current: CurrentUser) -> set[str]:
    if current.is_admin:
        return set(rbac.ALL_CAPABILITIES)
    return {c for c in rbac.ALL_CAPABILITIES if current.can(c)}


class UserRow(BaseModel):
    id: int
    username: str
    full_name: str | None
    role: str
    role_label: str
    branch_id: int | None
    branch_name: str | None
    active: bool
    overrides: int


class UserPermsOut(BaseModel):
    user: UserRow
    role_capabilities: list[str]
    grants: list[str]
    denies: list[str]
    assignable: list[str]
    manager_hidden_pages: list[str]
    capabilities: list[CapabilityOut]


class UserPermsIn(BaseModel):
    grants: list[str] = []
    denies: list[str] = []


def _branches(db: Session) -> dict[int, str]:
    from src.models.org import Branch

    return {b.id: b.name for b in db.query(Branch).all()}


def _user_row(db: Session, u: User, counts: dict, branches: dict) -> UserRow:
    role = _role_name(db, u)
    return UserRow(
        id=u.id, username=u.username, full_name=u.full_name, role=role.value,
        role_label=ROLE_LABELS.get(role.value, role.value), branch_id=u.branch_id,
        branch_name=branches.get(u.branch_id) if u.branch_id else None,
        active=u.active, overrides=counts.get(u.id, 0))


@router.get("/permissions/users", response_model=list[UserRow])
def list_user_permissions(
    current: CurrentUser = Depends(_manager),
    db: Session = Depends(get_db),
) -> list[UserRow]:
    from sqlalchemy import func, select

    from src.api.users import BELOW_BRANCH_MANAGER
    from src.auth import branch_scope
    from src.models.role import Role

    stmt = select(User).order_by(User.active.desc(), User.full_name, User.username)
    if current.is_admin:
        bid = branch_scope.visible_branch_id(current)
        if bid is not None:
            stmt = stmt.where(User.branch_id == bid)
    else:
        below = [r.id for r in db.scalars(select(Role)).all() if r.name in BELOW_BRANCH_MANAGER]
        stmt = stmt.where(User.branch_id == current.branch_id, User.role_id.in_(below or [0]))
    counts = dict(db.execute(select(UserCapability.user_id, func.count())
                             .group_by(UserCapability.user_id)).all())
    branches = _branches(db)
    rows = [_user_row(db, u, counts, branches) for u in db.scalars(stmt).all()]
    if not current.is_owner:
        rows = [r for r in rows if r.role not in ("system_admin", "owner")]
    return rows


def _perms_out(db: Session, current: CurrentUser, u: User) -> UserPermsOut:
    from sqlalchemy import select

    role = _role_name(db, u)
    rows = db.execute(select(UserCapability.capability, UserCapability.granted)
                      .where(UserCapability.user_id == u.id)).all()
    return UserPermsOut(
        user=_user_row(db, u, {u.id: len(rows)}, _branches(db)),
        role_capabilities=sorted(rbac.ALL_CAPABILITIES if role == RoleName.system_admin
                                 else rbac.effective_capabilities(role)),
        grants=sorted(c for c, g in rows if g),
        denies=sorted(c for c, g in rows if not g),
        assignable=sorted(_assignable(current)),
        manager_hidden_pages=sorted(c[len(PAGE_PREFIX):] for c in current.denies
                                    if c.startswith(PAGE_PREFIX)),
        capabilities=[CapabilityOut(key=c, label=CAPABILITY_LABELS.get(c, c), group=_group_of(c))
                      for c in sorted(rbac.ALL_CAPABILITIES)],
    )


@router.get("/permissions/users/{user_id}", response_model=UserPermsOut)
def read_user_permissions(
    user_id: int,
    current: CurrentUser = Depends(_manager),
    db: Session = Depends(get_db),
) -> UserPermsOut:
    return _perms_out(db, current, _manageable(db, current, db.get(User, user_id)))


@router.put("/permissions/users/{user_id}", response_model=UserPermsOut)
def set_user_permissions(
    user_id: int,
    body: UserPermsIn,
    current: CurrentUser = Depends(_manager),
    db: Session = Depends(get_db),
) -> UserPermsOut:
    from sqlalchemy import select

    u = _manageable(db, current, db.get(User, user_id))
    if u.id == current.id and not current.is_owner:
        raise HTTPException(403, {"code": "forbidden",
                                  "message": "لا يجوز أن تعدّل صلاحياتك بنفسك — اطلبها من مسؤولك المباشر."})
    grants, denies = set(body.grants), set(body.denies)
    both = grants & denies
    if both:
        raise HTTPException(422, {"code": "validation",
                                  "message": "صلاحية ممنوحة ومسحوبة في الوقت نفسه: " + "، ".join(sorted(both))})
    caps = {c for c in grants | denies if not c.startswith(PAGE_PREFIX)}
    unknown = sorted(caps - rbac.ALL_CAPABILITIES)
    if unknown:
        raise HTTPException(422, {"code": "unknown_capability",
                                  "message": "صلاحيات غير معروفة: " + "، ".join(unknown)})
    if not current.is_admin:
        allowed = _assignable(current)
        over = sorted(c for c in grants if not c.startswith(PAGE_PREFIX) and c not in allowed)
        hidden = sorted(c for c in grants if c.startswith(PAGE_PREFIX) and c in current.denies)
        if over or hidden:
            names = ([CAPABILITY_LABELS.get(c, c) for c in over]
                     + [c[len(PAGE_PREFIX):] for c in hidden])
            raise HTTPException(403, {"code": "forbidden",
                                      "message": "لا يمكنك منح صلاحية لا تملكها: " + "، ".join(names)})

    before = db.execute(select(UserCapability.capability, UserCapability.granted)
                        .where(UserCapability.user_id == u.id)).all()
    db.execute(delete(UserCapability).where(UserCapability.user_id == u.id))
    for c in sorted(grants):
        db.add(UserCapability(user_id=u.id, capability=c, granted=True, actor_user_id=current.id))
    for c in sorted(denies):
        db.add(UserCapability(user_id=u.id, capability=c, granted=False, actor_user_id=current.id))
    db.flush()
    audit_record(db, action="permissions.user.update", actor_user_id=current.id,
                 entity_type="user", entity_id=u.id,
                 before={"grants": sorted(c for c, g in before if g),
                         "denies": sorted(c for c, g in before if not g)},
                 after={"grants": sorted(grants), "denies": sorted(denies)})
    db.commit()
    return _perms_out(db, current, u)
