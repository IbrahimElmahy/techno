"""شيت المرتبات — المجموعات، وتجهيز الشهر، والتعديل بالخانة، والاعتماد (طلب العميل ٢٠٢٦-١٠-٠٨).

العميل بيعمل المرتبات على إكسل، والشاشة دي بتعمل نفس الورقة: مجموعات لكل فرع، كل مجموعة
بأعمدتها، وأي خانة تتكتب فوقها. الفرق إن الخانات اللي كانت بتتنقل بالإيد من أوراق تانية
(العمولة من ورقة العربيات، الغياب من الحضور، السلف من دفتر السلف) بتيجي لوحدها، وكل خانة
بتقول جت منين.

**مصادر الأعمدة** (`SOURCES`):

    basic        الأساسي — من إعدادات الراتب
    component    بند من إعدادات الراتب (بدلات، تقييم، منحة غلاء، مكالمات…) — مبلغ ثابت كل شهر
    commission   من محرك العمولات (عمولة، اشراف، عمولة معاينات، مكافأة الفنيين، خصم 25%)
    absence      الغياب = (مجموع أعمدة الأساس) ÷ القاسم × أيام الغياب
    advances     أقساط السلف المستحقة الشهر ده
    penalties    الجزاءات والاستقطاعات المعتمدة للشهر
    bonuses      المكافآت والاستحقاقات المعتمدة للشهر
    insurance    حصة الموظف في التأمينات من الشرايح (أو بند ثابت لو الشرايح مش متعرّفة)
    manual       بيتكتب كل شهر بالإيد (اضافي)

**الترحيل** بيستعمل `payroll_service.post_run` زي ما هو. عشان كده الشيت بيبني `payroll_line`
لكل صف بالشكل اللي الترحيل فاهمه، وكل عمود استقطاع له «ترحيل» بيقول يروح فين:

    reduce     بيقلل مصروف المرتبات (الغياب، خصم 25%) — فلوس الشركة ماصرفتهاش أصلاً
    advance    سلف العاملين — بيقفل السلفة
    penalty    حصيلة الجزاءات — التزام (قانون العمل: لصندوق رعاية العمال)
    insurance  تأمينات مستحقة

فالقيد: مدين مصروف = الاستحقاقات − (reduce)، ودائن مرتبات مستحقة = الصافي + الباقي كل واحد
في حسابه — ومتوازن بالبناء: الصافي = الاستحقاقات − كل الاستقطاعات.

**محرك العمولات** شغل موديول تاني (`commission_service.compute(db, branch_id=, year=, month=)`).
بيتنده جوّه `try` وجوّه savepoint: لو مش موجود أو وقع، أعمدة العمولة بتفضل صفر/يدوي والشيت
بيشتغل عادي — والشاشة بتقول إن المحرك ماردّش، بدل ما الشهر كله يقف على موديول تاني.
"""
from __future__ import annotations

import re
from calendar import monthrange
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.employee import Employee
from src.models.hr_advance import AdjustmentBasis, AdjustmentKind
from src.models.hr_attendance import AttendanceDay, AttendanceStatus
from src.models.hr_payroll import ComponentKind, EmployeeSalaryLine, SalaryComponent, SchemeKind
from src.models.hr_payroll_run import (
    DetailKind,
    DetailSource,
    PayrollLine,
    PayrollLineDetail,
    PayrollRun,
    PayrollRunStatus,
)
from src.models.hr_payroll_sheet import (
    PayrollGroup,
    PayrollGroupMember,
    PayrollSheetCell,
    PayrollSheetGroup,
    PayrollSheetRow,
)
from src.services import advance_service, audit_service, numbering
from src.services import payroll_setup_service as setup

ZERO_QTY = Decimal("0.000")


class PayrollSheetError(Exception):
    """الشيت مايتعملش زي ما هو مطلوب."""


# ------------------------------------------------------------------ الكتالوج

SOURCES: dict[str, dict] = {
    "basic": {"label": "اساسى", "kind": "earning", "hint": "من إعدادات الراتب"},
    "component": {"label": "بند راتب", "kind": None, "hint": "مبلغ ثابت من إعدادات الراتب"},
    "commission": {"label": "محرك العمولات", "kind": None, "hint": "بيتحسب من المبيعات والتحصيل"},
    "absence": {"label": "غياب", "kind": "deduction", "posting": "reduce",
                "hint": "أيام الغياب من الحضور × أجر اليوم"},
    "advances": {"label": "سلف", "kind": "deduction", "posting": "advance",
                 "hint": "أقساط السلف المستحقة الشهر ده"},
    "penalties": {"label": "عجز /جزاء", "kind": "deduction", "posting": "penalty",
                  "hint": "الجزاءات المعتمدة للشهر"},
    "bonuses": {"label": "مكافأة", "kind": "earning", "hint": "المكافآت المعتمدة للشهر"},
    "insurance": {"label": "تأمينات", "kind": "deduction", "posting": "insurance",
                  "hint": "حصة الموظف من شرايح التأمينات"},
    "manual": {"label": "يدوي", "kind": None, "hint": "بيتكتب كل شهر بالإيد"},
}

# مفاتيح محرك العمولات — نفس اللي الموديول التاني بيرجّعها لكل موظف.
COMMISSION_KEYS: dict[str, tuple[str, str]] = {
    "commission": ("عمولة", "earning"),
    "supervision": ("اشراف", "earning"),
    "inspection_commission": ("عمولة معاينات", "earning"),
    "technician_bonus": ("مكافأة الفنيين", "earning"),
    "coupon_commission_payable": ("عمولة الكوبونات", "earning"),
    "penalty_25": ("خصم25%", "deduction"),
}

POSTINGS = {
    "reduce": "يقلل مصروف المرتبات",
    "advance": "سلف العاملين",
    "penalty": "حصيلة الجزاءات",
    "insurance": "تأمينات مستحقة",
}

_SINGLE = {"basic", "absence", "advances", "penalties", "bonuses", "insurance"}


def catalog(db: Session) -> dict:
    comps = db.scalars(select(SalaryComponent).where(SalaryComponent.active.is_(True))
                       .order_by(SalaryComponent.sort_order, SalaryComponent.name)).all()
    return {
        "sources": [{"source": k, **v} for k, v in SOURCES.items()],
        "commission_keys": [{"ref": k, "label": v[0], "kind": v[1]}
                            for k, v in COMMISSION_KEYS.items()],
        "postings": [{"value": k, "label": v} for k, v in POSTINGS.items()],
        "components": [{"id": c.id, "code": c.code, "name": c.name, "kind": c.kind.value}
                       for c in comps],
    }


def _slug(text: str) -> str:
    clean = re.sub(r"[^0-9A-Za-z_]+", "_", text or "").strip("_").lower()
    return clean[:30]


def clean_columns(db: Session, columns: list[dict]) -> list[dict]:
    """بيتأكد من الأعمدة ويكمّل الناقص (المفتاح، النوع، الترحيل)."""
    out: list[dict] = []
    keys: set[str] = set()
    manual_n = 0
    for raw in columns or []:
        source = (raw.get("source") or "").strip()
        if source not in SOURCES:
            raise PayrollSheetError(f"مصدر العمود «{source}» مش معروف.")
        ref = raw.get("ref")
        label = (raw.get("label") or "").strip()
        kind = raw.get("kind")
        if source == "component":
            comp = db.get(SalaryComponent, int(ref or 0)) if ref else None
            if comp is None:
                raise PayrollSheetError("بند الراتب بتاع العمود غير موجود.")
            ref = comp.id
            kind = comp.kind.value
            label = label or comp.name
            key = f"component:{comp.id}"
        elif source == "commission":
            if ref not in COMMISSION_KEYS:
                raise PayrollSheetError(f"مفتاح العمولة «{ref}» مش معروف.")
            kind = COMMISSION_KEYS[ref][1]
            label = label or COMMISSION_KEYS[ref][0]
            key = f"commission:{ref}"
        elif source == "manual":
            if kind not in ("earning", "deduction"):
                raise PayrollSheetError("العمود اليدوي لازم يتحدد استحقاق ولا استقطاع.")
            ref = _slug(str(ref or "")) if ref else ""
            if not ref:
                manual_n += 1
                ref = f"m{manual_n}"
                while f"manual:{ref}" in keys:
                    manual_n += 1
                    ref = f"m{manual_n}"
            key = f"manual:{ref}"
            label = label or "يدوي"
        else:
            kind = SOURCES[source]["kind"]
            label = label or SOURCES[source]["label"]
            key = source
            ref = None
        if key in keys:
            raise PayrollSheetError(f"العمود «{label}» متكرر في نفس المجموعة.")
        keys.add(key)
        posting = None
        if kind == "deduction":
            posting = raw.get("posting") or SOURCES[source].get("posting") or "reduce"
            if posting not in POSTINGS:
                raise PayrollSheetError(f"ترحيل العمود «{label}» مش معروف.")
        fallback = raw.get("fallback_component_id")
        if fallback and db.get(SalaryComponent, int(fallback)) is None:
            fallback = None
        out.append({
            "key": key, "label": label[:60], "source": source, "ref": ref, "kind": kind,
            "posting": posting, "carry": bool(raw.get("carry")) if source == "manual" else False,
            "fallback_component_id": int(fallback) if fallback else None,
        })
    return out


def _clean_absence_base(columns: list[dict], base: list | None) -> list[str]:
    earning = {c["key"] for c in columns if c["kind"] == "earning"}
    picked = [k for k in (base or []) if k in earning]
    if not picked and "basic" in earning:
        picked = ["basic"]
    return picked


# ------------------------------------------------------------------ المجموعات


def _group_out(db: Session, g: PayrollGroup, members: list | None = None) -> dict:
    return {
        "id": g.id, "branch_id": g.branch_id, "name": g.name, "sort_order": g.sort_order,
        "columns": g.columns or [], "absence_base": g.absence_base or [],
        "absence_divisor": g.absence_divisor, "active": g.active, "notes": g.notes,
        "members": members if members is not None else [],
    }


def list_groups(db: Session, *, branch_id: int, include_inactive: bool = False) -> list[dict]:
    stmt = select(PayrollGroup).where(PayrollGroup.branch_id == branch_id)
    if not include_inactive:
        stmt = stmt.where(PayrollGroup.active.is_(True))
    groups = db.scalars(stmt.order_by(PayrollGroup.sort_order, PayrollGroup.id)).all()
    ids = [g.id for g in groups]
    by_group: dict[int, list] = {gid: [] for gid in ids}
    if ids:
        rows = db.execute(
            select(PayrollGroupMember, Employee)
            .join(Employee, Employee.id == PayrollGroupMember.employee_id)
            .where(PayrollGroupMember.group_id.in_(ids))
            .order_by(PayrollGroupMember.sort_order, Employee.name)
        ).all()
        for m, e in rows:
            by_group[m.group_id].append({
                "employee_id": e.id, "code": e.code, "name": e.name, "active": e.active,
                "branch_id": e.branch_id, "sort_order": m.sort_order,
            })
    return [_group_out(db, g, by_group.get(g.id, [])) for g in groups]


def save_group(
    db: Session, *, branch_id: int, name: str, columns: list[dict], actor_user_id: int,
    group_id: int | None = None, sort_order: int | None = None,
    absence_base: list | None = None, absence_divisor: int = 30, active: bool = True,
    notes: str | None = None,
) -> PayrollGroup:
    clean = (name or "").strip()
    if not clean:
        raise PayrollSheetError("اسم المجموعة مطلوب.")
    if not absence_divisor or absence_divisor <= 0:
        raise PayrollSheetError("قاسم الغياب لازم يكون أكبر من صفر.")
    cols = clean_columns(db, columns)
    if not cols:
        raise PayrollSheetError("المجموعة لازم يبقى فيها عمود واحد على الأقل.")
    dup = db.scalar(select(PayrollGroup).where(
        PayrollGroup.branch_id == branch_id, PayrollGroup.name == clean))
    if dup is not None and dup.id != group_id:
        raise PayrollSheetError("فيه مجموعة بنفس الاسم في الفرع ده.")
    if group_id is not None:
        g = db.get(PayrollGroup, group_id)
        if g is None or g.branch_id != branch_id:
            raise PayrollSheetError("المجموعة غير موجودة.")
    else:
        top = db.scalar(select(func.max(PayrollGroup.sort_order)).where(
            PayrollGroup.branch_id == branch_id))
        g = PayrollGroup(branch_id=branch_id, sort_order=(top or 0) + 1)
        db.add(g)
    g.name = clean
    g.columns = cols
    g.absence_base = _clean_absence_base(cols, absence_base)
    g.absence_divisor = int(absence_divisor)
    g.active = active
    g.notes = notes
    g.actor_user_id = actor_user_id
    if sort_order is not None:
        g.sort_order = sort_order
    db.flush()
    audit_service.record(db, action="payroll_group.save", actor_user_id=actor_user_id,
                         entity_type="payroll_group", entity_id=g.id,
                         after={"name": clean, "columns": [c["key"] for c in cols]})
    return g


def delete_group(db: Session, *, group_id: int, actor_user_id: int) -> str:
    """بيمسح المجموعة ويفك موظفينها. الشهور اللي اتجهّزت بيها فاضلة بنسختها هي."""
    g = db.get(PayrollGroup, group_id)
    if g is None:
        raise PayrollSheetError("المجموعة غير موجودة.")
    db.execute(delete(PayrollGroupMember).where(PayrollGroupMember.group_id == g.id))
    db.flush()
    name = g.name
    db.delete(g)
    db.flush()
    audit_service.record(db, action="payroll_group.delete", actor_user_id=actor_user_id,
                         entity_type="payroll_group", entity_id=group_id, before={"name": name})
    return name


def reorder_groups(db: Session, *, branch_id: int, group_ids: list[int]) -> None:
    for i, gid in enumerate(group_ids):
        g = db.get(PayrollGroup, gid)
        if g is not None and g.branch_id == branch_id:
            g.sort_order = i + 1
    db.flush()


def members_of_branch(db: Session, *, branch_id: int) -> list[dict]:
    """كل موظفي الفرع الشغّالين ومجموعة كل واحد — لشاشة التوزيع."""
    groups = {g.id: g for g in db.scalars(select(PayrollGroup).where(
        PayrollGroup.branch_id == branch_id)).all()}
    emps = db.scalars(select(Employee).where(
        Employee.branch_id == branch_id, Employee.active.is_(True)).order_by(Employee.name)).all()
    members = {m.employee_id: m for m in db.scalars(select(PayrollGroupMember).where(
        PayrollGroupMember.employee_id.in_([e.id for e in emps] or [0]))).all()}
    roster = setup.salary_roster(db, emps, date.today())
    out = []
    for e in emps:
        m = members.get(e.id)
        g = groups.get(m.group_id) if m else None
        out.append({
            "employee_id": e.id, "code": e.code, "name": e.name,
            "group_id": g.id if g else None, "group_name": g.name if g else None,
            "sort_order": m.sort_order if (m and g) else None,
            "has_salary": bool((roster.get(e.id) or {}).get("current")),
        })
    return out


def assign(db: Session, *, branch_id: int, employee_ids: list[int], group_id: int | None,
           actor_user_id: int) -> int:
    """توزيع جماعي — `group_id` فاضي = شيلهم من أي مجموعة."""
    group = None
    if group_id is not None:
        group = db.get(PayrollGroup, group_id)
        if group is None or group.branch_id != branch_id:
            raise PayrollSheetError("المجموعة غير موجودة.")
    top = db.scalar(select(func.max(PayrollGroupMember.sort_order)).where(
        PayrollGroupMember.group_id == group_id)) if group else 0
    n = 0
    for emp_id in employee_ids:
        emp = db.get(Employee, emp_id)
        if emp is None or emp.branch_id != branch_id:
            raise PayrollSheetError("الموظف مش من الفرع ده.")
        m = db.scalar(select(PayrollGroupMember).where(PayrollGroupMember.employee_id == emp_id))
        if group is None:
            if m is not None:
                db.delete(m)
                n += 1
            continue
        if m is None:
            top = (top or 0) + 1
            db.add(PayrollGroupMember(employee_id=emp_id, group_id=group.id, sort_order=top))
            n += 1
        elif m.group_id != group.id:
            top = (top or 0) + 1
            m.group_id = group.id
            m.sort_order = top
            n += 1
    db.flush()
    audit_service.record(db, action="payroll_group.assign", actor_user_id=actor_user_id,
                         entity_type="payroll_group", entity_id=group_id or 0,
                         after={"employees": employee_ids})
    return n


def reorder_members(db: Session, *, group_id: int, employee_ids: list[int]) -> None:
    for i, emp_id in enumerate(employee_ids):
        m = db.scalar(select(PayrollGroupMember).where(
            PayrollGroupMember.employee_id == emp_id, PayrollGroupMember.group_id == group_id))
        if m is not None:
            m.sort_order = i + 1
    db.flush()


def ensure_component(db: Session, *, name: str, kind: ComponentKind,
                     actor_user_id: int) -> SalaryComponent:
    row = db.scalar(select(SalaryComponent).where(SalaryComponent.name == name))
    if row is not None:
        return row
    return setup.create_component(db, name=name, kind=kind, actor_user_id=actor_user_id)


def template_groups(db: Session, *, actor_user_id: int) -> list[dict]:
    """المجموعات التلاتة بأعمدتها بالظبط زي ملف العميل («اكتوبر (2)»)."""
    c = {name: ensure_component(db, name=name, kind=kind, actor_user_id=actor_user_id).id
         for name, kind in (
             ("بدلات", ComponentKind.earning), ("تقييم", ComponentKind.earning),
             ("منحة غلاء", ComponentKind.earning), ("مكالمات", ComponentKind.earning),
             ("بدلات اضافية", ComponentKind.earning), ("اشراف", ComponentKind.earning),
             ("تأمينات", ComponentKind.deduction))}
    comp = lambda name, label=None: {"source": "component", "ref": c[name],  # noqa: E731
                                      "label": label or name}
    return [
        {"name": "البيع", "absence_base": ["basic", f"component:{c['بدلات']}"],
         "columns": [
             {"source": "basic", "label": "اساسى"}, comp("بدلات"),
             {"source": "commission", "ref": "commission", "label": "عمولة"},
             comp("تقييم"), comp("منحة غلاء"), comp("مكالمات"),
             {"source": "manual", "ref": "overtime", "kind": "earning", "label": "اضافي"},
             {"source": "absence", "label": "غياب"}, {"source": "advances", "label": "سلف"},
             {"source": "commission", "ref": "penalty_25", "label": "خصم25%"},
             {"source": "penalties", "label": "عجز /جزاء"},
         ]},
        {"name": "الإدارية", "absence_base": ["basic"],
         "columns": [
             {"source": "basic", "label": "اساسى"}, comp("بدلات"),
             {"source": "manual", "ref": "overtime", "kind": "earning", "label": "اضافى"},
             comp("تقييم"), comp("منحة غلاء"),
             {"source": "manual", "ref": "overtime2", "kind": "earning", "label": "اضافى"},
             {"source": "bonuses", "label": "مكافأة"},
             {"source": "absence", "label": "غياب"}, {"source": "advances", "label": "سلف"},
             {"source": "commission", "ref": "penalty_25", "label": "خصم25%"},
             {"source": "penalties", "label": "عجز /جزاء"},
         ]},
        {"name": "خدمة العملاء", "absence_base": ["basic"],
         "columns": [
             {"source": "basic", "label": "اساسى"}, comp("بدلات"),
             {"source": "commission", "ref": "supervision", "label": "اشراف",
              "fallback_component_id": c["اشراف"]},
             comp("تقييم"),
             {"source": "commission", "ref": "inspection_commission", "label": "عمولة معاينات"},
             comp("منحة غلاء"), comp("بدلات اضافية", "بدلات"),
             {"source": "commission", "ref": "technician_bonus", "label": "مكافأة الفنيين"},
             {"source": "bonuses", "label": "مكافأة"},
             {"source": "absence", "label": "غياب"}, {"source": "advances", "label": "سلف"},
             {"source": "penalties", "label": "جزاءات"},
             {"source": "insurance", "label": "تأمينات", "fallback_component_id": c["تأمينات"]},
         ]},
    ]


def apply_template(db: Session, *, branch_id: int, actor_user_id: int) -> list[PayrollGroup]:
    """بيعمل مجموعات الملف في الفرع — اللي موجودة بنفس الاسم بتتساب زي ما هي."""
    made = []
    for spec in template_groups(db, actor_user_id=actor_user_id):
        exists = db.scalar(select(PayrollGroup).where(
            PayrollGroup.branch_id == branch_id, PayrollGroup.name == spec["name"]))
        if exists is not None:
            continue
        made.append(save_group(db, branch_id=branch_id, name=spec["name"],
                               columns=spec["columns"], absence_base=spec["absence_base"],
                               actor_user_id=actor_user_id))
    return made


def copy_groups(db: Session, *, from_branch_id: int, to_branch_id: int,
                actor_user_id: int) -> list[PayrollGroup]:
    """نسخ مجموعات فرع لفرع تاني (الأعمدة بس — الموظفين كل فرع بيوزّعهم لوحده)."""
    made = []
    for g in db.scalars(select(PayrollGroup).where(
            PayrollGroup.branch_id == from_branch_id, PayrollGroup.active.is_(True))
            .order_by(PayrollGroup.sort_order)).all():
        if db.scalar(select(PayrollGroup).where(
                PayrollGroup.branch_id == to_branch_id, PayrollGroup.name == g.name)):
            continue
        made.append(save_group(db, branch_id=to_branch_id, name=g.name, columns=g.columns,
                               absence_base=g.absence_base, absence_divisor=g.absence_divisor,
                               actor_user_id=actor_user_id))
    return made


# ------------------------------------------------------------------ مصادر الشهر


def _period_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def _commission_values(db: Session, *, branch_id: int, year: int, month: int,
                       absences: dict | None = None):
    """محرك العمولات — جوّه try وsavepoint. بيرجّع (قيم لكل موظف، تفاصيل، ملاحظة).

    `absences` = أيام الغياب اللي اتكتبت بالإيد في الشيت، عشان العمولة تتخصم بنفس الرقم اللي
    قدّام المحاسب مش برقم الحضور.
    """
    try:
        from src.services import commission_service
    except Exception as exc:  # noqa: BLE001
        return {}, {}, f"محرك العمولات مش موجود ({type(exc).__name__})"
    fn = getattr(commission_service, "compute", None)
    if fn is None:
        return {}, {}, "محرك العمولات مش موجود"
    nested = db.begin_nested()
    try:
        try:
            result = fn(db, branch_id=branch_id, year=year, month=month,
                        absences=absences or None)
        except TypeError:
            # نسخة من المحرك من غير `absences` — نفس الحساب بأيام الحضور.
            result = fn(db, branch_id=branch_id, year=year, month=month)
        nested.commit()
    except Exception as exc:  # noqa: BLE001
        nested.rollback()
        # التفاصيل للّوج مش للشاشة — المحاسب محتاج يعرف إن العمولة يدوي الشهر ده، مش اسم الاستثناء.
        import logging
        logging.getLogger(__name__).warning("commission engine failed: %r", exc)
        return {}, {}, "محرك العمولات ماردّش على الفرع/الشهر ده — اكتب العمولات بالإيد"
    if not isinstance(result, dict):
        return {}, {}, "محرك العمولات رجّع شكل مش متوقع"
    values: dict[int, dict] = {}
    for k, v in result.items():
        try:
            emp_id = int(k)
        except (TypeError, ValueError):
            continue
        if isinstance(v, dict):
            values[emp_id] = v
    details = result.get("details") if isinstance(result.get("details"), dict) else {}
    norm_details = {}
    for k, v in (details or {}).items():
        try:
            norm_details[int(k)] = v
        except (TypeError, ValueError):
            continue
    return values, norm_details, None


def _dec(v) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except Exception:  # noqa: BLE001
        return None


def _salary_info(db: Session, employee_id: int, period_end: date) -> dict | None:
    salary = setup.salary_on(db, employee_id, period_end)
    if salary is None:
        return None
    basic = to_money(Decimal(str(salary.basic or 0)))
    comps: dict[int, Decimal] = {}
    for line in db.scalars(select(EmployeeSalaryLine).where(
            EmployeeSalaryLine.salary_id == salary.id)).all():
        if line.pct is not None:
            comps[line.component_id] = to_money(basic * Decimal(str(line.pct)) / 100)
        else:
            comps[line.component_id] = to_money(Decimal(str(line.amount or 0)))
    breakdown = setup.salary_breakdown(db, salary)
    return {"basic": basic, "components": comps,
            "insurance_base": Decimal(breakdown["insurance_base"]),
            "effective_from": salary.effective_from}


def _absent_days(db: Session, employee_id: int, year: int, month: int) -> tuple[Decimal, bool]:
    first, last = date(year, month, 1), _period_end(year, month)
    rows = db.scalars(select(AttendanceDay).where(
        AttendanceDay.employee_id == employee_id,
        AttendanceDay.work_date >= first, AttendanceDay.work_date <= last)).all()
    absent = sum(1 for r in rows if r.status == AttendanceStatus.absent)
    return to_qty(Decimal(absent)), bool(rows)


def _note_commission(details: dict, emp_id: int, ref: str) -> str:
    d = details.get(emp_id)
    if isinstance(d, dict) and d.get(ref) is not None:
        return f"محرك العمولات — {str(d.get(ref))[:240]}"
    if isinstance(d, str):
        return f"محرك العمولات — {d[:240]}"
    return "محرك العمولات"


# ------------------------------------------------------------------ تجهيز الشهر


def _runs_of(db: Session, branch_id: int, year: int, month: int) -> list[PayrollRun]:
    return db.scalars(select(PayrollRun).where(
        PayrollRun.year == year, PayrollRun.month == month,
        PayrollRun.branch_id == branch_id).order_by(PayrollRun.reversal_seq.desc())).all()


def is_sheet(db: Session, run_id: int) -> bool:
    return db.scalar(select(func.count()).select_from(PayrollSheetGroup).where(
        PayrollSheetGroup.run_id == run_id)) > 0


def current_run(db: Session, *, branch_id: int, year: int, month: int) -> PayrollRun | None:
    """شيت الشهر الحالي: المسودة/المعتمد/المرحّل — وإلا آخر واحد اتعكس (للعرض)."""
    runs = _runs_of(db, branch_id, year, month)
    for r in runs:
        if r.status != PayrollRunStatus.reversed:
            return r
    return runs[0] if runs else None


def _prev_month(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def _carry_values(db: Session, branch_id: int, year: int, month: int) -> dict:
    """قيم الشهر اللي فات للأعمدة اللي «بتتنقل» — (موظف، مفتاح) → قيمة نهائية."""
    py, pm = _prev_month(year, month)
    prev = current_run(db, branch_id=branch_id, year=py, month=pm)
    if prev is None or prev.status == PayrollRunStatus.reversed:
        return {}
    out = {}
    for row, cell in db.execute(
            select(PayrollSheetRow, PayrollSheetCell)
            .join(PayrollSheetCell, PayrollSheetCell.row_id == PayrollSheetRow.id)
            .where(PayrollSheetRow.run_id == prev.id)).all():
        out[(row.employee_id, cell.col_key)] = _final(cell)
    return out


def _final(cell: PayrollSheetCell) -> Decimal:
    v = cell.override if cell.override is not None else cell.computed
    return to_money(Decimal(str(v or 0)))


def _wipe_sheet(db: Session, run_id: int) -> None:
    rows = db.scalars(select(PayrollSheetRow.id).where(PayrollSheetRow.run_id == run_id)).all()
    if rows:
        db.execute(delete(PayrollSheetCell).where(PayrollSheetCell.row_id.in_(rows)))
        db.flush()
        db.execute(delete(PayrollSheetRow).where(PayrollSheetRow.run_id == run_id))
        db.flush()
    db.execute(delete(PayrollSheetGroup).where(PayrollSheetGroup.run_id == run_id))
    db.flush()


def _wipe_lines(db: Session, run_id: int, employee_id: int | None = None) -> None:
    stmt = select(PayrollLine.id).where(PayrollLine.run_id == run_id)
    if employee_id is not None:
        stmt = stmt.where(PayrollLine.employee_id == employee_id)
    ids = db.scalars(stmt).all()
    if not ids:
        return
    db.execute(delete(PayrollLineDetail).where(PayrollLineDetail.line_id.in_(ids)))
    db.flush()
    db.execute(delete(PayrollLine).where(PayrollLine.id.in_(ids)))
    db.flush()


def prepare(db: Session, *, branch_id: int, year: int, month: int,
            actor_user_id: int) -> PayrollRun:
    """«تجهيز الشهر» — بيعمل الشيت أو بيحدّثه. الخانات المكتوبة بالإيد بتفضل زي ما هي."""
    if not 1 <= month <= 12:
        raise PayrollSheetError("الشهر لازم يكون من 1 لـ 12.")
    runs = _runs_of(db, branch_id, year, month)
    live = next((r for r in runs if r.status != PayrollRunStatus.reversed), None)
    if live is not None and live.status == PayrollRunStatus.posted:
        raise PayrollSheetError(
            f"الشهر ده مرحّل في {live.document_number} — اعكس الترحيل الأول لو محتاج تعدّل.")
    if live is not None and live.status == PayrollRunStatus.closed:
        raise PayrollSheetError("الشهر ده معتمد — الغي الاعتماد الأول عشان تعيد التجهيز.")
    if live is not None and not is_sheet(db, live.id) and db.scalar(
            select(func.count()).select_from(PayrollLine).where(PayrollLine.run_id == live.id)):
        raise PayrollSheetError(
            f"الشهر ده عليه مسودة من «مسير الرواتب» القديم ({live.document_number}).")

    groups = db.scalars(select(PayrollGroup).where(
        PayrollGroup.branch_id == branch_id, PayrollGroup.active.is_(True))
        .order_by(PayrollGroup.sort_order, PayrollGroup.id)).all()
    if not groups:
        raise PayrollSheetError(
            "الفرع ده مالوش مجموعات مرتبات — اعملها من «مجموعات المرتبات» الأول.")

    # اللي اتكتب بالإيد — من المسودة نفسها، أو من آخر شيت اتعكس للشهر ده (عشان العكس
    # وإعادة التجهيز ماتمسحش شغل المراجعة).
    keep_from = live if live is not None else next(
        (r for r in runs if r.status == PayrollRunStatus.reversed and is_sheet(db, r.id)), None)
    overrides: dict[tuple[int, str], Decimal] = {}
    day_overrides: dict[int, Decimal] = {}
    notes: dict[int, str] = {}
    if keep_from is not None:
        for row, cell in db.execute(
                select(PayrollSheetRow, PayrollSheetCell)
                .join(PayrollSheetCell, PayrollSheetCell.row_id == PayrollSheetRow.id)
                .where(PayrollSheetRow.run_id == keep_from.id,
                       PayrollSheetCell.override.is_not(None))).all():
            overrides[(row.employee_id, cell.col_key)] = cell.override
        for row in db.scalars(select(PayrollSheetRow).where(
                PayrollSheetRow.run_id == keep_from.id)).all():
            if row.absent_days_override is not None:
                day_overrides[row.employee_id] = row.absent_days_override
            if row.notes:
                notes[row.employee_id] = row.notes

    if live is None:
        seq = db.scalar(select(func.max(PayrollRun.reversal_seq)).where(
            PayrollRun.year == year, PayrollRun.month == month,
            PayrollRun.branch_id == branch_id))
        run = PayrollRun(
            document_number=numbering.next_document_number(db, PayrollRun, "PR"),
            year=year, month=month, branch_id=branch_id,
            reversal_seq=0 if seq is None else seq + 1,
            status=PayrollRunStatus.draft, actor_user_id=actor_user_id,
        )
        db.add(run)
        db.flush()
    else:
        run = live
        _wipe_lines(db, run.id)
        _wipe_sheet(db, run.id)

    period_end = _period_end(year, month)
    ins_version = setup.version_on(db, SchemeKind.social_insurance, period_end)
    run.insurance_version_id = ins_version.id if ins_version else None
    run.tax_version_id = None
    comm, comm_details, comm_note = _commission_values(
        db, branch_id=branch_id, year=year, month=month,
        absences={k: Decimal(str(v)) for k, v in day_overrides.items()})
    carry = _carry_values(db, branch_id, year, month)
    settings = setup.settings(db)
    hours = Decimal(str(settings.hours_per_day or 8)) or Decimal("8")

    for g in groups:
        sg = PayrollSheetGroup(run_id=run.id, group_id=g.id, name=g.name,
                               sort_order=g.sort_order, columns=list(g.columns or []),
                               absence_base=list(g.absence_base or []),
                               absence_divisor=g.absence_divisor or 30)
        db.add(sg)
        db.flush()
        members = db.execute(
            select(PayrollGroupMember, Employee)
            .join(Employee, Employee.id == PayrollGroupMember.employee_id)
            .where(PayrollGroupMember.group_id == g.id, Employee.active.is_(True),
                   Employee.branch_id == branch_id)
            .order_by(PayrollGroupMember.sort_order, Employee.name)).all()
        for m, emp in members:
            _build_row(db, run=run, sg=sg, emp=emp, sort_order=m.sort_order,
                       year=year, month=month, period_end=period_end,
                       ins_version=ins_version, comm=comm, comm_details=comm_details,
                       comm_ok=comm_note is None, carry=carry, hours=hours,
                       overrides=overrides, day_override=day_overrides.get(emp.id),
                       note=notes.get(emp.id))
    run.notes = comm_note
    db.flush()
    _refresh_run_totals(db, run)
    audit_service.record(db, action="payroll_sheet.prepare", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"period": f"{year}-{month:02d}", "branch_id": branch_id})
    return run


def _build_row(db: Session, *, run, sg, emp, sort_order, year, month, period_end, ins_version,
               comm, comm_details, comm_ok, carry, hours, overrides, day_override, note) -> None:
    from src.lib import payroll_calc as calc

    info = _salary_info(db, emp.id, period_end)
    days, has_att = _absent_days(db, emp.id, year, month)
    row = PayrollSheetRow(run_id=run.id, sheet_group_id=sg.id, employee_id=emp.id,
                          sort_order=sort_order or 0, absent_days=days,
                          absent_days_override=day_override, no_salary=info is None,
                          notes=note)
    db.add(row)
    db.flush()

    comps = (info or {}).get("components", {})
    emp_comm = comm.get(emp.id, {})
    values: dict[str, tuple[Decimal, str | None]] = {}
    deferred: list[dict] = []
    for col in sg.columns:
        src, key = col["source"], col["key"]
        value: Decimal | None = None
        note_txt: str | None = None
        if src == "basic":
            value = info["basic"] if info else ZERO
            note_txt = (f"إعدادات الراتب (ساري من {info['effective_from']})" if info
                        else "مالوش إعدادات راتب")
        elif src == "component":
            value = comps.get(col["ref"], ZERO)
            note_txt = "إعدادات الراتب"
        elif src == "commission":
            raw = _dec(emp_comm.get(col["ref"])) if comm_ok else None
            if raw is not None:
                value = to_money(raw)
                note_txt = _note_commission(comm_details, emp.id, col["ref"])
            else:
                note_txt = ("محرك العمولات مارجّعش رقم للموظف ده" if comm_ok
                            else "محرك العمولات مش متاح — اكتب الرقم بالإيد")
        elif src == "advances":
            parts = advance_service.due_in(db, employee_id=emp.id, year=year, month=month)
            value = to_money(sum((Decimal(str(p.amount)) for p in parts), ZERO))
            note_txt = (f"أقساط سلف الشهر ({len(parts)})" if parts else "مافيش أقساط الشهر ده")
        elif src == "insurance":
            if ins_version is not None and info is not None:
                emp_share, _ = calc.insurance_for(
                    info["insurance_base"], employee_pct=ins_version.employee_pct or 0,
                    employer_pct=ins_version.employer_pct or 0,
                    min_base=ins_version.min_base, max_base=ins_version.max_base)
                value = to_money(emp_share)
                note_txt = f"شرايح التأمينات «{ins_version.name}»"
            else:
                note_txt = "شرايح التأمينات مش متعرّفة — اكتب الرقم بالإيد"
        elif src == "manual":
            prev = carry.get((emp.id, key)) if col.get("carry") else None
            if prev is not None:
                value = prev
                note_txt = "من الشهر اللي فات"
            else:
                value = ZERO
                note_txt = "يدوي"
        elif src in ("absence", "penalties", "bonuses"):
            deferred.append(col)
            continue
        if value is None and col.get("fallback_component_id"):
            fb = comps.get(col["fallback_component_id"])
            if fb is not None:
                value = fb
                fixed = "المبلغ الثابت من إعدادات الراتب"
                note_txt = f"{note_txt} — {fixed}" if note_txt else fixed
        values[key] = (to_money(value if value is not None else ZERO), note_txt)

    # الأعمدة المحسوبة على غيرها (الغياب والجزاءات بالأيام) بعد ما الخانات المكتوبة تتحط.
    def final_of(k: str) -> Decimal:
        if (emp.id, k) in overrides:
            return to_money(Decimal(str(overrides[(emp.id, k)])))
        return values.get(k, (ZERO, None))[0]

    base = sum((final_of(k) for k in sg.absence_base), ZERO)
    daily = (base / Decimal(sg.absence_divisor or 30)) if base else ZERO
    for col in deferred:
        src, key = col["source"], col["key"]
        if src == "absence":
            d = Decimal(str(day_override)) if day_override is not None else days
            values[key] = (to_money(daily * d), _absence_note(sg, d, day_override, has_att))
        else:
            rows = advance_service.adjustments_in(db, employee_id=emp.id, year=year, month=month)
            want_bonus = src == "bonuses"
            total = ZERO
            labels = []
            for adj in rows:
                is_bonus = adj.kind in (AdjustmentKind.bonus, AdjustmentKind.other_earning)
                if is_bonus != want_bonus:
                    continue
                if adj.basis == AdjustmentBasis.days:
                    amount = to_money(Decimal(str(adj.quantity or 0)) * daily)
                elif adj.basis == AdjustmentBasis.hours:
                    amount = to_money(Decimal(str(adj.quantity or 0)) * daily / hours)
                else:
                    amount = to_money(Decimal(str(adj.amount or 0)))
                total += amount
                labels.append(adj.reason or adj.document_number or "")
            values[key] = (to_money(total), ("، ".join(x for x in labels if x)[:240]
                                             or ("مافيش مكافآت معتمدة" if want_bonus
                                                 else "مافيش جزاءات معتمدة")))

    for col in sg.columns:
        key = col["key"]
        value, note_txt = values.get(key, (ZERO, None))
        db.add(PayrollSheetCell(row_id=row.id, col_key=key, computed=value,
                                override=overrides.get((emp.id, key)),
                                source_note=(note_txt or None) and note_txt[:300]))
    db.flush()
    _recompute_row(db, run, sg, row, emp)


def _absence_note(sg, days: Decimal, override, has_att: bool) -> str:
    base = " + ".join(c["label"] for c in sg.columns if c["key"] in (sg.absence_base or []))
    origin = "مكتوبة بالإيد" if override is not None else (
        "من الحضور" if has_att else "مافيش حضور مسجّل")
    return f"({base or 'صفر'}) ÷ {sg.absence_divisor} × {days.normalize()} يوم — {origin}"


def _recompute_row(db: Session, run: PayrollRun, sg: PayrollSheetGroup,
                   row: PayrollSheetRow, emp: Employee | None = None) -> None:
    """إجماليات الصف + خانة الغياب (بتعتمد على أعمدة الأساس) + سطر المسير."""
    cells = {c.col_key: c for c in db.scalars(select(PayrollSheetCell).where(
        PayrollSheetCell.row_id == row.id)).all()}
    absence = next((c for c in sg.columns if c["source"] == "absence"), None)
    if absence is not None and absence["key"] in cells:
        base = sum((_final(cells[k]) for k in (sg.absence_base or []) if k in cells), ZERO)
        days = Decimal(str(row.absent_days_override if row.absent_days_override is not None
                           else row.absent_days or 0))
        cell = cells[absence["key"]]
        cell.computed = to_money(base / Decimal(sg.absence_divisor or 30) * days) if base else ZERO
        note = cell.source_note or ""
        head = note.split(" — ")[-1] if " — " in note else ""
        origin = "مكتوبة بالإيد" if row.absent_days_override is not None else (
            head if head and head != "مكتوبة بالإيد" else "من الحضور")
        names = " + ".join(c["label"] for c in sg.columns if c["key"] in (sg.absence_base or []))
        cell.source_note = (f"({names or 'صفر'}) ÷ {sg.absence_divisor} × "
                            f"{days.normalize()} يوم — {origin}")[:300]
    earn = ded = ZERO
    for col in sg.columns:
        c = cells.get(col["key"])
        if c is None:
            continue
        if col["kind"] == "earning":
            earn += _final(c)
        else:
            ded += _final(c)
    row.earnings = to_money(earn)
    row.deductions = to_money(ded)
    row.net = to_money(earn - ded)
    db.flush()
    _sync_line(db, run, sg, row, cells, emp)


def _sync_line(db: Session, run, sg, row, cells, emp=None) -> None:
    """سطر `payroll_line` بالشكل اللي `payroll_service.post_run` فاهمه — شوف أول الملف."""
    from src.services.payroll_service import _cost_center_of

    _wipe_lines(db, run.id, row.employee_id)
    emp = emp or db.get(Employee, row.employee_id)
    sums = {"reduce": ZERO, "advance": ZERO, "penalty": ZERO, "insurance": ZERO}
    basic = absence_amt = bonus = ZERO
    details = []
    for col in sg.columns:
        c = cells.get(col["key"])
        if c is None:
            continue
        v = _final(c)
        src = col["source"]
        if src == "basic":
            basic += v
        if col["kind"] == "deduction":
            sums[col.get("posting") or "reduce"] += v
            if src == "absence":
                absence_amt += v
        elif src == "bonuses":
            bonus += v
        if not v:
            continue
        dsrc = {"absence": DetailSource.absence, "advances": DetailSource.advance,
                "penalties": DetailSource.penalty, "bonuses": DetailSource.bonus,
                "insurance": DetailSource.insurance}.get(src, DetailSource.component)
        details.append(dict(
            source=dsrc, component_id=col["ref"] if src == "component" else None,
            label=col["label"][:120],
            kind=DetailKind.earning if col["kind"] == "earning" else DetailKind.deduction,
            quantity=(Decimal(str(row.absent_days_override if row.absent_days_override
                                  is not None else row.absent_days)) if src == "absence"
                      else None),
            amount=v))
    earn = to_money(Decimal(str(row.earnings)))
    gross = to_money(earn - sums["reduce"])
    days = Decimal(str(row.absent_days_override if row.absent_days_override is not None
                       else row.absent_days or 0))
    line = PayrollLine(
        run_id=run.id, employee_id=row.employee_id,
        department_id=emp.department_id if emp else None,
        job_title_id=emp.job_title_id if emp else None,
        cost_center_id=_cost_center_of(db, emp) if emp else None,
        basic=basic, allowances=to_money(earn - basic), gross=gross,
        days_in_month=sg.absence_divisor or 30, days_absent=to_qty(days),
        absence_deduction=absence_amt, penalty_amount=sums["penalty"], bonus_amount=bonus,
        insurance_employee=sums["insurance"], advance_deduction=sums["advance"],
        other_deductions=ZERO,
        total_deductions=to_money(sums["penalty"] + sums["advance"] + sums["insurance"]),
        net=to_money(Decimal(str(row.net))), has_attendance=True,
    )
    db.add(line)
    db.flush()
    for d in details:
        db.add(PayrollLineDetail(line_id=line.id, **d))
    db.flush()


def _refresh_run_totals(db: Session, run: PayrollRun) -> None:
    rows = db.scalars(select(PayrollLine).where(PayrollLine.run_id == run.id)).all()

    def tot(f):
        return to_money(sum((Decimal(str(getattr(x, f) or 0)) for x in rows), ZERO))

    sheet_rows = db.scalars(select(PayrollSheetRow).where(PayrollSheetRow.run_id == run.id)).all()
    run.earnings = to_money(sum((Decimal(str(r.earnings)) for r in sheet_rows), ZERO))
    run.gross = tot("gross")
    run.absence_deduction = tot("absence_deduction")
    run.bonuses = tot("bonus_amount")
    run.penalties = tot("penalty_amount")
    run.insurance_employee = tot("insurance_employee")
    run.insurance_employer = ZERO
    run.tax = ZERO
    run.advances = tot("advance_deduction")
    run.other_deductions = to_money(run.earnings - run.gross - run.absence_deduction)
    run.total_deductions = to_money(sum((Decimal(str(r.deductions)) for r in sheet_rows), ZERO))
    run.net = tot("net")
    db.flush()


# ------------------------------------------------------------------ التعديل


def _draft(db: Session, run_id: int) -> PayrollRun:
    run = db.get(PayrollRun, run_id)
    if run is None or not is_sheet(db, run_id):
        raise PayrollSheetError("الشيت غير موجود.")
    if run.status != PayrollRunStatus.draft:
        label = {"closed": "معتمد", "posted": "مرحّل", "reversed": "متعكس"}.get(
            run.status.value, run.status.value)
        raise PayrollSheetError(f"الشيت {label} — مينفعش يتعدّل.")
    return run


def _row_of(db: Session, run_id: int, employee_id: int):
    row = db.scalar(select(PayrollSheetRow).where(
        PayrollSheetRow.run_id == run_id, PayrollSheetRow.employee_id == employee_id))
    if row is None:
        raise PayrollSheetError("الموظف مش في الشيت ده.")
    return row, db.get(PayrollSheetGroup, row.sheet_group_id)


def set_cell(db: Session, *, run_id: int, employee_id: int, col_key: str, value,
             actor_user_id: int) -> PayrollSheetRow:
    """الكتابة فوق خانة. `value` فاضي = رجّع المحسوب."""
    run = _draft(db, run_id)
    row, sg = _row_of(db, run_id, employee_id)
    col = next((c for c in sg.columns if c["key"] == col_key), None)
    if col is None:
        raise PayrollSheetError("العمود مش في المجموعة دي.")
    cell = db.scalar(select(PayrollSheetCell).where(
        PayrollSheetCell.row_id == row.id, PayrollSheetCell.col_key == col_key))
    if cell is None:
        cell = PayrollSheetCell(row_id=row.id, col_key=col_key, computed=ZERO)
        db.add(cell)
    v = _dec(value)
    if value not in (None, "") and v is None:
        raise PayrollSheetError("القيمة لازم تكون رقم.")
    if v is not None and v < 0:
        raise PayrollSheetError("القيمة مينفعش تكون بالسالب.")
    before = str(cell.override) if cell.override is not None else None
    cell.override = to_money(v) if v is not None else None
    db.flush()
    _recompute_row(db, run, sg, row)
    _refresh_run_totals(db, run)
    audit_service.record(db, action="payroll_sheet.cell", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         before={"employee_id": employee_id, "col": col_key, "value": before},
                         after={"employee_id": employee_id, "col": col_key,
                                "value": str(cell.override) if cell.override is not None
                                else None})
    return row


def set_absent_days(db: Session, *, run_id: int, employee_id: int, days,
                    actor_user_id: int) -> PayrollSheetRow:
    run = _draft(db, run_id)
    row, sg = _row_of(db, run_id, employee_id)
    v = _dec(days)
    if days not in (None, "") and v is None:
        raise PayrollSheetError("الأيام لازم تكون رقم.")
    if v is not None and (v < 0 or v > 31):
        raise PayrollSheetError("أيام الغياب من 0 لـ 31.")
    row.absent_days_override = to_qty(v) if v is not None else None
    db.flush()
    _recompute_row(db, run, sg, row)
    _refresh_run_totals(db, run)
    audit_service.record(db, action="payroll_sheet.absence", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"employee_id": employee_id, "days": str(v) if v is not None
                                else None})
    return row


def set_note(db: Session, *, run_id: int, employee_id: int, notes: str | None) -> None:
    _draft(db, run_id)
    row, _ = _row_of(db, run_id, employee_id)
    row.notes = (notes or "").strip()[:300] or None
    db.flush()


# ------------------------------------------------------------------ الحالة


def close(db: Session, *, run_id: int, actor_user_id: int) -> PayrollRun:
    run = _draft(db, run_id)
    if not db.scalar(select(func.count()).select_from(PayrollSheetRow).where(
            PayrollSheetRow.run_id == run.id)):
        raise PayrollSheetError("الشيت فاضي — مافيش موظفين في المجموعات.")
    run.status = PayrollRunStatus.closed
    db.flush()
    audit_service.record(db, action="payroll_sheet.close", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id,
                         after={"net": str(run.net)})
    return run


def reopen(db: Session, *, run_id: int, actor_user_id: int) -> PayrollRun:
    run = db.get(PayrollRun, run_id)
    if run is None or not is_sheet(db, run_id):
        raise PayrollSheetError("الشيت غير موجود.")
    if run.status != PayrollRunStatus.closed:
        raise PayrollSheetError("الشيت مش معتمد.")
    run.status = PayrollRunStatus.draft
    db.flush()
    audit_service.record(db, action="payroll_sheet.reopen", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run.id)
    return run


def post(db: Session, *, run_id: int, actor_user_id: int) -> dict:
    """الترحيل — نفس `payroll_service.post_run` بالظبط، بس من شيت معتمد بس."""
    from src.services import payroll_service

    run = db.get(PayrollRun, run_id)
    if run is None or not is_sheet(db, run_id):
        raise PayrollSheetError("الشيت غير موجود.")
    if run.status == PayrollRunStatus.draft:
        raise PayrollSheetError("اعتمد الشيت الأول، وبعدين رحّله.")
    negative = db.scalar(select(func.count()).select_from(PayrollSheetRow).where(
        PayrollSheetRow.run_id == run.id, PayrollSheetRow.net < 0))
    if negative:
        raise PayrollSheetError(f"فيه {negative} موظف صافيه بالسالب — راجعهم قبل الترحيل.")
    return payroll_service.post_run(db, run_id=run_id, actor_user_id=actor_user_id)


def reverse(db: Session, *, run_id: int, actor_user_id: int) -> dict:
    from src.services import payroll_service

    if not is_sheet(db, run_id):
        raise PayrollSheetError("الشيت غير موجود.")
    return payroll_service.reverse_run(db, run_id=run_id, actor_user_id=actor_user_id)


def delete_draft(db: Session, *, run_id: int, actor_user_id: int) -> None:
    run = _draft(db, run_id)
    number = run.document_number
    _wipe_lines(db, run.id)
    _wipe_sheet(db, run.id)
    db.delete(run)
    db.flush()
    audit_service.record(db, action="payroll_sheet.delete", actor_user_id=actor_user_id,
                         entity_type="payroll_run", entity_id=run_id,
                         before={"document_number": number})


# ------------------------------------------------------------------ القراية


def sheet_out(db: Session, run: PayrollRun) -> dict:
    groups = db.scalars(select(PayrollSheetGroup).where(PayrollSheetGroup.run_id == run.id)
                        .order_by(PayrollSheetGroup.sort_order, PayrollSheetGroup.id)).all()
    rows = db.scalars(select(PayrollSheetRow).where(PayrollSheetRow.run_id == run.id)
                      .order_by(PayrollSheetRow.sort_order, PayrollSheetRow.id)).all()
    cells: dict[int, list[PayrollSheetCell]] = {}
    if rows:
        for c in db.scalars(select(PayrollSheetCell).where(
                PayrollSheetCell.row_id.in_([r.id for r in rows]))).all():
            cells.setdefault(c.row_id, []).append(c)
    emps = {e.id: e for e in db.scalars(select(Employee).where(
        Employee.id.in_([r.employee_id for r in rows] or [0]))).all()}
    # بنود في إعدادات الراتب مالهاش عمود في المجموعة — فلوس مش هتوصل للموظف من غير ما حد ياخد باله.
    period_end = _period_end(run.year, run.month)
    comp_names = {c.id: c.name for c in db.scalars(select(SalaryComponent)).all()}

    out_groups = []
    grand = {"earnings": ZERO, "deductions": ZERO, "net": ZERO}
    for sg in groups:
        g_rows = [r for r in rows if r.sheet_group_id == sg.id]
        col_keys = [c["key"] for c in sg.columns]
        shown_comps = {c["ref"] for c in sg.columns if c["source"] == "component"} | {
            c.get("fallback_component_id") for c in sg.columns if c.get("fallback_component_id")}
        totals = {k: ZERO for k in col_keys}
        g_tot = {"earnings": ZERO, "deductions": ZERO, "net": ZERO}
        out_rows = []
        for r in g_rows:
            emp = emps.get(r.employee_id)
            rc = {c.col_key: c for c in cells.get(r.id, [])}
            out_cells = {}
            for k in col_keys:
                c = rc.get(k)
                if c is None:
                    out_cells[k] = {"value": "0.00", "computed": "0.00", "override": None,
                                    "note": None}
                    continue
                v = _final(c)
                totals[k] += v
                out_cells[k] = {"value": str(v), "computed": str(c.computed),
                                "override": str(c.override) if c.override is not None else None,
                                "note": c.source_note}
            hidden = []
            if run.status == PayrollRunStatus.draft:
                info = _salary_info(db, r.employee_id, period_end)
                for cid, amount in ((info or {}).get("components") or {}).items():
                    if cid not in shown_comps and amount:
                        hidden.append({"name": comp_names.get(cid, str(cid)),
                                       "amount": str(amount)})
            for k in ("earnings", "deductions", "net"):
                g_tot[k] += Decimal(str(getattr(r, k)))
            out_rows.append({
                "row_id": r.id, "employee_id": r.employee_id,
                "code": emp.code if emp else None, "name": emp.name if emp else None,
                "absent_days": str(r.absent_days),
                "absent_days_override": (str(r.absent_days_override)
                                         if r.absent_days_override is not None else None),
                "cells": out_cells, "earnings": str(r.earnings),
                "deductions": str(r.deductions), "net": str(r.net),
                "no_salary": r.no_salary, "hidden_components": hidden, "notes": r.notes,
            })
        for k in grand:
            grand[k] += g_tot[k]
        out_groups.append({
            "id": sg.id, "group_id": sg.group_id, "name": sg.name, "columns": sg.columns,
            "absence_base": sg.absence_base, "absence_divisor": sg.absence_divisor,
            "rows": out_rows,
            "totals": {**{k: str(to_money(v)) for k, v in totals.items()},
                       **{k: str(to_money(v)) for k, v in g_tot.items()}},
        })

    unassigned = []
    if run.status == PayrollRunStatus.draft:
        in_sheet = {r.employee_id for r in rows}
        for e in db.scalars(select(Employee).where(
                Employee.branch_id == run.branch_id, Employee.active.is_(True))
                .order_by(Employee.name)).all():
            if e.id not in in_sheet:
                unassigned.append({"id": e.id, "code": e.code, "name": e.name})

    return {
        "run": {
            "id": run.id, "document_number": run.document_number, "year": run.year,
            "month": run.month, "branch_id": run.branch_id, "status": run.status.value,
            "reversal_seq": run.reversal_seq, "net": str(run.net),
            "accrual_entry_id": run.accrual_entry_id,
            "reversal_entry_id": run.reversal_entry_id, "posted_at": run.posted_at,
            "commission_note": run.notes,
        },
        "groups": out_groups,
        "summary": [{"name": g["name"], "net": g["totals"]["net"]} for g in out_groups],
        "totals": {k: str(to_money(v)) for k, v in grand.items()},
        "unassigned": unassigned,
    }


def list_sheets(db: Session, *, branch_id: int | None, year: int | None = None) -> list[dict]:
    ids = select(PayrollSheetGroup.run_id).distinct()
    stmt = select(PayrollRun).where(PayrollRun.id.in_(ids))
    if branch_id is not None:
        stmt = stmt.where(PayrollRun.branch_id == branch_id)
    if year:
        stmt = stmt.where(PayrollRun.year == year)
    stmt = stmt.order_by(PayrollRun.year.desc(), PayrollRun.month.desc(),
                         PayrollRun.reversal_seq.desc())
    out = []
    for r in db.scalars(stmt).all():
        count = db.scalar(select(func.count()).select_from(PayrollSheetRow).where(
            PayrollSheetRow.run_id == r.id))
        out.append({"id": r.id, "document_number": r.document_number, "year": r.year,
                    "month": r.month, "branch_id": r.branch_id, "status": r.status.value,
                    "employees": count, "earnings": str(r.earnings),
                    "total_deductions": str(r.total_deductions), "net": str(r.net),
                    "posted_at": r.posted_at, "accrual_entry_id": r.accrual_entry_id})
    return out
