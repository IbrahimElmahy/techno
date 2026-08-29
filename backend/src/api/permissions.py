"""شاشة الصلاحيات — أنهي دور بيقدر يعمل إيه.

الافتراضي مكتوب في `rbac.ROLE_CAPABILITIES`، وده اللي الشركة بتبدأ بيه. الشاشة دي بتكتب
فوقه في `role_capability`، ولما تكتب لدور بيبقى اللي اتكتب هو كلمة الدور — مش زيادة على
الافتراضي، بديل كامل. ودور ماحدش لمسه بيفضل على افتراضيه.

مدير النظام مش في الشاشة أصلاً: هو الوحيد اللي بيقدر يفتحها، وتعديل صلاحياته منها معناه
احتمال قفل الباب على نفسه من جوّه.
"""
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

# أسماء عربية للصلاحيات — القايمة الخام (`sale.edit`) مش لوحة تحكم، دي مرجع مبرمج.
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
    "customer.reassign": "نقل عميل لمندوب تاني",
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
}

# القسم اللي الصلاحية بتقع تحته في الشاشة — عشان ٥٨ صلاحية تتقرا، مش تتفحص.
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
}


def _group_of(cap: str) -> str:
    for title, prefixes in GROUPS:
        if any(cap.startswith(p) for p in prefixes):
            return title
    return "أخرى"


def _admin_only(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """الصلاحيات نفسها مش صلاحية بتتوزّع — مدير النظام وبس.

    لو بقت صلاحية زي أي حاجة تانية، أول واحد ياخدها يقدر يدّي نفسه الباقي، وساعتها كل
    القفل ده مالوش لازمة.
    """
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
        # «لسه على الافتراضي» بتفرق: الترقية اللي بتضيف صلاحيات بتوصل للأدوار دي، والمضبوطة لأ.
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
            "message": "مدير النظام بصلاحياته كاملة دايماً — وإلا مافيش حد يقدر يرجّعها.",
        })
    unknown = sorted(set(body.capabilities) - rbac.ALL_CAPABILITIES)
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "unknown_capability",
            "message": "صلاحيات مش معروفة: " + "، ".join(unknown),
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
    # الكاش يتبني من الأول على طول — من غير كده التغيير مايبقاش نافذ غير بعد إعادة تشغيل.
    rbac.refresh_overrides(db)
    return _role_out(role, is_default=False)


@router.delete("/permissions/{role}", response_model=RoleOut)
def reset_role_permissions(
    role: RoleName,
    current: CurrentUser = Depends(_admin_only),
    db: Session = Depends(get_db),
) -> RoleOut:
    """يرجّع الدور لافتراضيه — بمسح المضبوط، مش بكتابة الافتراضي مكانه.

    الفرق بيبان بعد الترقية: الدور اللي رجع لافتراضيه بياخد الصلاحيات الجديدة، واللي
    اتكتبله الافتراضي كنسخة بيفضل واقف على صورة قديمة.
    """
    before = sorted(rbac.effective_capabilities(role))
    db.execute(delete(RoleCapability).where(RoleCapability.role == role))
    db.flush()
    audit_record(db, action="permissions.reset", actor_user_id=current.id,
                 entity_type="role", entity_id=None,
                 before={"role": role.value, "capabilities": before}, after=None)
    db.commit()
    rbac.refresh_overrides(db)
    return _role_out(role, is_default=True)
