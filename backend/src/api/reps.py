"""المناديب — كل ما يخص المندوب في مكان واحد.

المندوب مش جدول عندنا: هو **مستخدم** بدور `sales_rep`، وحواليه أربع حاجات متفرّقة على أربع
شاشات — الموظف اللي بيربطه بمخزن عربيته، والعملاء المسنودين له، ومنطقته، وعهدته المالية.
واللي عايز يعرف «المندوب ده مسؤول عن إيه» كان بيفتح الأربعة ويجمّع في دماغه.

النظام القديم مالوش شاشة مناديب أصلاً — عنده شاشة موظفين بتتفلتر بالوظيفة، والعميل بيتربط
بمندوبه **بالاسم** في عمود نصّي (`Cust.Emp_Bos`). ولقيناه فاضي في الـ٦٥٠ عميل كلهم: الميزة
مبنية ومحدش بيستعملها، لأن اللي بيربط بالاسم بيفضل يتكسر لما الاسم يتغيّر.

المسار ده بيجمع الصورة كلها في نداء واحد، والربط كله بمفاتيح.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_USER_READ, CAP_USER_WRITE
from src.core.db import get_db
from src.models.customer import Customer
from src.models.employee import Employee
from src.models.org import Branch, Territory
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice
from src.models.stock import LocationKind, StockMovement
from src.models.user import User
from src.models.warehouse import Custody, Warehouse
from src.services.audit_service import record as audit_record

router = APIRouter(tags=["reps"])


class RepOut(BaseModel):
    user_id: int
    username: str
    full_name: str
    active: bool
    branch_id: int | None
    branch_name: str | None
    territory_id: int | None
    territory_name: str | None
    # مكان بضاعته — مخزن العربية، أو عهدة لو الشركة ماشية بعهد.
    employee_id: int | None
    warehouse_id: int | None
    warehouse_name: str | None
    custody_id: int | None
    # «مشرف المناديب» اللي المندوب تحته (`user.supervisor_id`).
    supervisor_id: int | None = None
    supervisor_name: str | None = None
    # الأرقام اللي بتقول هو شغّال ولا اسم على ورق
    customer_count: int
    invoice_count: int
    stock_items: int


class RepUpdate(BaseModel):
    """اللي الشاشة بتغيّره. الفاضي = ماتلمسوش."""

    full_name: str | None = None
    active: bool | None = None
    branch_id: int | None = None
    territory_id: int | None = None
    # مخزن بضاعة المندوب. بيتكتب على سجل الموظف — وبيتعمل موظف لو مالوش.
    warehouse_id: int | None = None


def _rep_role_id(db: Session) -> int | None:
    r = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
    return r.id if r else None


def _build(db: Session, users: list[User]) -> list[RepOut]:
    """الصورة الكاملة لكل مندوب — بستة استعلامات مجمّعة، مش ستة لكل مندوب."""
    ids = [u.id for u in users]
    if not ids:
        return []
    branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}
    terrs = {t.id: t.name for t in db.scalars(select(Territory)).all()}
    whs = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}
    emps = {e.user_id: e for e in db.scalars(
        select(Employee).where(Employee.user_id.in_(ids))).all()}
    custody = {c.rep_id: c.id for c in db.scalars(
        select(Custody).where(Custody.rep_id.in_(ids))).all()}
    cust_n = dict(db.execute(
        select(Customer.rep_id, func.count())
        .where(Customer.rep_id.in_(ids)).group_by(Customer.rep_id)).all())
    inv_n = dict(db.execute(
        select(SalesInvoice.rep_id, func.count())
        .where(SalesInvoice.rep_id.in_(ids)).group_by(SalesInvoice.rep_id)).all())

    # كام صنف فعلاً في مكان بضاعته — الرقم اللي بيفرّق بين مندوب في الشارع وحساب فاضي.
    # استعلام واحد لكل الأماكن (كان واحد لكل مندوب: ٢٠ مسح لجدول الحركات = ~٤٠٠ms).
    # العدّ نفسه زي ما هو: صف لكل صنف اتحرّك في المكان. (العهدة كانت مكتوبة
    # `LocationKind.rep` — قيمة مش موجودة، فمندوب بعهدة ومن غير مخزن كان بيوقّع الشاشة.)
    user_loc: dict[int, tuple] = {}
    for u in users:
        emp = emps.get(u.id)
        if emp is not None and emp.warehouse_id:
            user_loc[u.id] = (LocationKind.warehouse, emp.warehouse_id)
        elif u.id in custody:
            user_loc[u.id] = (LocationKind.custody, custody[u.id])
    per_loc: dict[tuple, int] = {}
    if user_loc:
        wh_ids = {lid for kind, lid in user_loc.values() if kind == LocationKind.warehouse}
        cust_ids = {lid for kind, lid in user_loc.values() if kind == LocationKind.custody}
        conds = []
        if wh_ids:
            conds.append((StockMovement.location_kind == LocationKind.warehouse)
                         & StockMovement.location_id.in_(wh_ids))
        if cust_ids:
            conds.append((StockMovement.location_kind == LocationKind.custody)
                         & StockMovement.location_id.in_(cust_ids))
        for kind, lid, _item in db.execute(
            select(StockMovement.location_kind, StockMovement.location_id,
                   StockMovement.item_id)
            .where(or_(*conds))
            .group_by(StockMovement.location_kind, StockMovement.location_id,
                      StockMovement.item_id)).all():
            key = (getattr(kind, "value", kind), lid)
            per_loc[key] = per_loc.get(key, 0) + 1
    stock_n: dict[int, int] = {
        uid: per_loc.get((getattr(kind, "value", kind), lid), 0)
        for uid, (kind, lid) in user_loc.items()
    }

    sup_ids = {u.supervisor_id for u in users if u.supervisor_id}
    sups = {s.id: (s.full_name or s.username) for s in db.scalars(
        select(User).where(User.id.in_(sup_ids))).all()} if sup_ids else {}
    out = []
    for u in users:
        emp = emps.get(u.id)
        wid = emp.warehouse_id if emp else None
        out.append(RepOut(
            user_id=u.id, username=u.username, full_name=u.full_name or u.username,
            active=u.active,
            branch_id=u.branch_id, branch_name=branches.get(u.branch_id),
            territory_id=u.territory_id, territory_name=terrs.get(u.territory_id),
            employee_id=emp.id if emp else None,
            warehouse_id=wid, warehouse_name=whs.get(wid),
            custody_id=custody.get(u.id),
            supervisor_id=u.supervisor_id, supervisor_name=sups.get(u.supervisor_id),
            customer_count=cust_n.get(u.id, 0),
            invoice_count=inv_n.get(u.id, 0),
            stock_items=stock_n.get(u.id, 0),
        ))
    return out


@router.get("/reps", response_model=list[RepOut])
def list_reps(
    include_inactive: bool = False,
    current: CurrentUser = Depends(require_capability(CAP_USER_READ)),
    db: Session = Depends(get_db),
) -> list[RepOut]:
    role_id = _rep_role_id(db)
    if role_id is None:
        return []
    stmt = select(User).where(User.role_id == role_id)
    if not include_inactive:
        stmt = stmt.where(User.active.is_(True))
    stmt = branch_scope.scope(stmt, User, current)
    return _build(db, list(db.scalars(stmt.order_by(User.id)).all()))


@router.patch("/reps/{user_id}", response_model=RepOut)
def update_rep(
    user_id: int,
    body: RepUpdate,
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> RepOut:
    u = db.get(User, user_id)
    if u is None or u.role_id != _rep_role_id(db):
        raise HTTPException(404, {"code": "not_found", "message": "المندوب غير موجود."})
    if not branch_scope.may_see(current, u):
        raise HTTPException(404, {"code": "not_found", "message": "المندوب غير موجود."})

    before = {"full_name": u.full_name, "active": u.active, "branch_id": u.branch_id,
              "territory_id": u.territory_id}

    if body.full_name is not None:
        u.full_name = body.full_name.strip()
    if body.active is not None:
        u.active = body.active
    if body.branch_id is not None:
        u.branch_id = body.branch_id or None
    if body.territory_id is not None:
        u.territory_id = body.territory_id or None

    if body.warehouse_id is not None:
        # المخزن بيتكتب على سجل الموظف لأن ده اللي `rep_store` بتقرا منه. والمندوب اللي
        # مالوش سجل موظف بيتعمله واحد هنا — بدل ما اللي قدامه يروح شاشة تانية يعمله
        # بإيده عشان يقدر يربط مخزن.
        emp = db.scalars(select(Employee).where(Employee.user_id == u.id)).first()
        if emp is None:
            n = db.scalar(select(func.count()).select_from(Employee)) or 0
            code = f"EMP-{n + 1:04d}"
            while db.scalars(select(Employee).where(Employee.code == code)).first():
                n += 1
                code = f"EMP-{n + 1:04d}"
            emp = Employee(code=code, name=u.full_name or u.username,
                           user_id=u.id, branch_id=u.branch_id, active=True)
            db.add(emp)
            db.flush()
        # مخزن واحد لمندوب واحد: مخزنين على نفس المكان معناهم رصيد واحد بيتحسب مرتين.
        if body.warehouse_id:
            clash = db.scalars(select(Employee).where(
                Employee.warehouse_id == body.warehouse_id,
                Employee.id != emp.id)).first()
            if clash is not None:
                raise HTTPException(status.HTTP_409_CONFLICT, {
                    "code": "warehouse_taken",
                    "message": f"المخزن ده مربوط بـ«{clash.name}» — فُكّه منه الأول.",
                })
        emp.warehouse_id = body.warehouse_id or None
        before["warehouse_id"] = emp.warehouse_id

    db.flush()
    audit_record(db, action="rep.update", actor_user_id=current.id,
                 entity_type="user", entity_id=u.id, before=before,
                 after={"full_name": u.full_name, "active": u.active,
                        "branch_id": u.branch_id, "territory_id": u.territory_id})
    db.commit()
    return _build(db, [u])[0]


class ReassignIn(BaseModel):
    customer_ids: list[int]
    to_rep_id: int


@router.post("/reps/{user_id}/customers", response_model=dict)
def reassign_customers(
    user_id: int,
    body: ReassignIn,
    current: CurrentUser = Depends(require_capability(CAP_USER_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    """ينقل عملاء من مندوب لمندوب.

    المندوب بيمشي وعملاؤه بيفضلوا، فالنقل عملية بتحصل فعلاً — والنظام القديم كان بيعملها
    بتغيير نص الاسم على كل عميل، وده بيسيب فواتير قديمة بتشاور على مندوب مالوش وجود.
    هنا الفواتير بتفضل على `rep_id` القديم (اللي باع هو اللي باع)، والعميل وحده هو اللي
    بيتحرّك.
    """
    target = db.get(User, body.to_rep_id)
    if target is None or target.role_id != _rep_role_id(db):
        raise HTTPException(404, {"code": "not_found", "message": "المندوب المنقول له غير موجود."})
    moved = 0
    for c in db.scalars(select(Customer).where(Customer.id.in_(body.customer_ids))).all():
        if c.rep_id == body.to_rep_id:
            continue
        audit_record(db, action="customer.reassign", actor_user_id=current.id,
                     entity_type="customer", entity_id=c.id,
                     before={"rep_id": c.rep_id}, after={"rep_id": body.to_rep_id})
        c.rep_id = body.to_rep_id
        moved += 1
    db.commit()
    return {"moved": moved, "to_rep_id": body.to_rep_id}
