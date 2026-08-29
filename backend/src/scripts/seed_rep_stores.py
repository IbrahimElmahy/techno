"""يربط كل مندوب بمخزنه — وبيعمل المخزن ده لو مش موجود.

بضاعة المندوب بتقعد في مكان، و`rep_store_service.rep_store` بتلاقي المكان ده من
`employee.warehouse_id`. من غير الربط ده التطبيق بيرد «مالكش عهدة ولا مخزن مسجّل» ومايزامنش،
والمندوب مايقدرش يبيع.

وكل فرع بياخد مخزن رئيسي لو مالوش — الفرع من غير مخزن مايقدرش يستقبل شرا ولا يصرف بيع،
فبيفضل موجود على الورق وواقف في الشغل.

بيتعاد تشغيله بأمان: الموجود بيتساب زي ما هو، والناقص بس هو اللي بيتعمل.

    python -m src.scripts.seed_rep_stores
"""
from __future__ import annotations

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.org import Branch
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Warehouse, WarehouseType


def _next_code(db) -> str:
    n = db.scalar(select(func.count()).select_from(Employee)) or 0
    while True:
        n += 1
        code = f"EMP-{n:04d}"
        if not db.scalars(select(Employee).where(Employee.code == code)).first():
            return code


def run() -> None:
    db = SessionLocal()
    try:
        branches = db.scalars(select(Branch).where(Branch.active.is_(True))
                              .order_by(Branch.id)).all()

        print("مخازن الفروع:")
        for b in branches:
            has = db.scalars(select(Warehouse).where(
                Warehouse.branch_id == b.id, Warehouse.active.is_(True))).first()
            if has:
                print(f"  = {b.name}: عنده مخزن ({has.name})")
                continue
            w = Warehouse(name=f"مخزن {b.name}", warehouse_type=WarehouseType.branch,
                          branch_id=b.id, description="المخزن الرئيسي للفرع", active=True)
            db.add(w)
            db.flush()
            print(f"  + {b.name}: اتعمل «{w.name}»")

        rep_role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        reps = db.scalars(select(User).where(User.role_id == rep_role.id,
                                             User.active.is_(True)).order_by(User.id)).all()

        print("\nمناديب:")
        for u in reps:
            emp = db.scalars(select(Employee).where(Employee.user_id == u.id)).first()
            if emp is not None and emp.warehouse_id is not None:
                print(f"  = {u.username}: مربوط بمخزن {emp.warehouse_id}")
                continue

            # مخزن العربية: الموجود اللي مالوش صاحب الأول، وإلا واحد جديد باسم المندوب.
            taken = {e.warehouse_id for e in db.scalars(select(Employee)).all()
                     if e.warehouse_id}
            free = db.scalars(select(Warehouse).where(
                Warehouse.branch_id == u.branch_id,
                Warehouse.active.is_(True),
                Warehouse.name.like("%سيار%"))).all()
            wh = next((w for w in free if w.id not in taken), None)
            if wh is None:
                wh = Warehouse(name=f"مخزن {u.full_name or u.username}",
                               warehouse_type=WarehouseType.branch,
                               branch_id=u.branch_id,
                               description="بضاعة المندوب في عربيته", active=True)
                db.add(wh)
                db.flush()
                print(f"  + مخزن جديد: «{wh.name}»")

            if emp is None:
                emp = Employee(code=_next_code(db), name=u.full_name or u.username,
                               user_id=u.id, branch_id=u.branch_id, active=True)
                db.add(emp)
                db.flush()
            emp.warehouse_id = wh.id
            print(f"  + {u.username:<16} → موظف {emp.code} على «{wh.name}»")

        db.commit()

        print("\nالنتيجة:")
        for u in reps:
            e = db.scalars(select(Employee).where(Employee.user_id == u.id)).first()
            w = db.get(Warehouse, e.warehouse_id) if e and e.warehouse_id else None
            print(f"  {u.username:<16} → {w.name if w else '— لسه بلا مخزن'}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
