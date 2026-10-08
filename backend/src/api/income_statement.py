"""قائمة الدخل بشكل ورقة العميل — لفرع ولفترة، بإعداداتها.

الفرع: المالك/الأدمن بيختار (أو «كل الفروع» بـ`branch_id=0`)، وموظف الفرع مقفول على فرعه
مهما بعت — نفس قاعدة `branch_scope` في باقي التقارير المالية.

الفترة **إجبارية**: قائمة دخل من غير فترة مالهاش معنى، والنظام مابيختارش فترة من عنده.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import distinct, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_ACCOUNTING_CHART_WRITE, CAP_VOUCHER_READ
from src.core.db import get_db
from src.models.catalog import Item
from src.models.customer import Customer
from src.models.org import Branch
from src.services import income_statement_service as svc

router = APIRouter(prefix="/reports/income-sheet", tags=["income-statement"])


def _bad(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                         detail={"code": "invalid", "message": message})


def _branch(current: CurrentUser, branch_id: int | None) -> int | None:
    """الفرع اللي التقرير هيتعمل عليه. `0` = كل الفروع (للي يشوف الكل بس)."""
    if not branch_scope.sees_all_branches(current):
        return current.branch_id
    if branch_id is None:
        return branch_scope.visible_branch_id(current)
    return branch_id or None


def _period(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    if date_from is None or date_to is None:
        raise _bad("اختار الفترة (من / إلى) الأول.")
    if date_from > date_to:
        raise _bad("تاريخ البداية بعد تاريخ النهاية.")
    return date_from, date_to


@router.get("")
def income_sheet(
    branch_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    posted_only: bool = Query(default=True),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> dict:
    d_from, d_to = _period(date_from, date_to)
    return svc.build(db, branch_id=_branch(current, branch_id), date_from=d_from, date_to=d_to,
                     posted_only=posted_only)


@router.get("/sales-detail")
def sales_detail(
    category: str = Query(...),
    branch_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """تفصيل فئة مبيعات بالعميل وبفئة الصنف — الدوسة على رقم «بولي» مثلاً."""
    d_from, d_to = _period(date_from, date_to)
    return svc.sales_breakdown(db, branch_id=_branch(current, branch_id), date_from=d_from,
                               date_to=d_to, category_key=category)


@router.get("/inventory")
def inventory_at(
    as_of: date = Query(...),
    branch_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> dict:
    """قيمة المخزون في تاريخ صنف صنف — تفصيل مخزون أول/آخر المدة بنفس إعدادات القائمة."""
    return svc.inventory_at(db, branch_id=_branch(current, branch_id), as_of=as_of).as_dict()


@router.get("/settings")
def get_settings(
    branch_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> dict:
    branch = _branch(current, branch_id)
    cfg = svc.get_config(db, branch)
    customers_q = select(Customer.id, Customer.name, Customer.customer_type)
    if branch is not None:
        customers_q = customers_q.where(Customer.branch_id == branch)
    customers = [{"id": i, "name": n, "type": t} for i, n, t in db.execute(customers_q).all()]
    # مين بيتمسك فعلاً بكل قاعدة عملاء — عشان «ثيرم / فرع» تبان بالأسامي مش بالكلمات بس.
    resolved: dict[str, list[dict]] = {}
    for rule in cfg["sales"]["categories"]:
        ids = {int(x) for x in rule.get("customer_ids") or []}
        words = rule.get("customer_name_words") or []
        if not ids and not words:
            continue
        resolved[rule["key"]] = [c for c in customers if c["id"] in ids
                                 or any(svc._has_word(c["name"] or "", w) for w in words)]
    return {
        "branch_id": branch,
        "branch_name": (db.get(Branch, branch).name if branch else "كل الفروع"),
        "config": cfg,
        "defaults": svc.DEFAULT_CONFIG,
        "roles": svc.ROLES,
        "accounts": svc.account_roles(db, branch_id=branch, config=cfg),
        "item_categories": sorted(
            c for c in db.scalars(select(distinct(Item.category))).all() if c),
        "customer_types": sorted(t for t in db.scalars(
            select(distinct(Customer.customer_type))).all() if t),
        "customers": customers,
        "resolved_customers": resolved,
    }


def _office(current: CurrentUser, branch: int | None) -> None:
    if branch is None and not branch_scope.sees_all_branches(current):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden", "message": "إعدادات الشركة كلها للأدمن بس."})


@router.put("/settings")
def put_settings(
    payload: dict = Body(...),
    branch_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """بيحفظ إعدادات الفرع كلها (من غير مدخلات الفترات — ليها مسارها)."""
    branch = _branch(current, branch_id)
    _office(current, branch)
    config = payload.get("config") if isinstance(payload.get("config"), dict) else payload
    allowed = {k: config[k] for k in ("sales", "inventory", "accounts", "marketing") if k in config}
    for cat in (allowed.get("sales") or {}).get("categories") or []:
        if not str(cat.get("key") or "").strip() or not str(cat.get("name") or "").strip():
            raise _bad("كل فئة مبيعات لازم يبقى ليها اسم.")
    for acc_id, role in ((allowed.get("accounts") or {}).get("roles") or {}).items():
        if role not in svc.ROLES:
            raise _bad(f"دور مش معروف للحساب {acc_id}: {role}")
    # مدخلات الفترات بتاعة الصف ده بس بتفضل زي ما هي — ليها مسارها (`/period`).
    own = svc._row(db, branch)
    allowed["periods"] = ((own.config or {}).get("periods") if own else None) or {}
    out = svc.save_config(db, branch, allowed, actor_user_id=current.id)
    db.commit()
    return {"config": out}


def _num(value) -> str | None:
    if value in (None, ""):
        return None
    try:
        return str(Decimal(str(value)))
    except InvalidOperation:
        raise _bad(f"رقم مش مفهوم: {value}") from None


@router.put("/period")
def put_period_inputs(
    payload: dict = Body(...),
    branch_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current: CurrentUser = Depends(require_capability(CAP_ACCOUNTING_CHART_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """مدخلات الفترة اليدوية: الجرد الفعلي أول/آخر المدة، كوبونات البيع الفعلي، وبنود «زيادة».

    بتتحفظ على مفتاح الفترة بالظبط — رقم جرد ٣٠-٦ مالوش دعوة بربع تاني.
    """
    branch = _branch(current, branch_id)
    _office(current, branch)
    d_from, d_to = _period(date_from, date_to)
    adjustments = []
    for a in payload.get("adjustments") or []:
        if not str(a.get("label") or "").strip() or _num(a.get("amount")) is None:
            continue
        section = a.get("section") or "ga"
        if section not in svc.ADJ_SECTIONS:
            raise _bad(f"قسم مش معروف: {section}")
        adjustments.append({"label": str(a["label"]).strip(), "amount": _num(a.get("amount")),
                            "section": section, "note": (a.get("note") or "زيادة")})
    entry = {
        "opening_inventory": _num(payload.get("opening_inventory")),
        "closing_inventory": _num(payload.get("closing_inventory")),
        "sales_coupons": _num(payload.get("sales_coupons")),
        "adjustments": adjustments,
        "note": (payload.get("note") or None),
    }
    own = svc._row(db, branch)
    cfg = dict((own.config if own else None) or {})
    periods = dict(cfg.get("periods") or {})
    key = svc.period_key(d_from, d_to)
    if any(v not in (None, [], "") for v in entry.values()):
        periods[key] = entry
    else:
        periods.pop(key, None)
    cfg["periods"] = periods
    svc.save_config(db, branch, cfg, actor_user_id=current.id)
    db.commit()
    return {"period_key": key, "inputs": periods.get(key)}
