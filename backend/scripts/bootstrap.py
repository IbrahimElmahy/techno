"""Production bootstrap (hosted deploy): create schema + idempotent base seed.

Run once at container start (before uvicorn). Uses `Base.metadata.create_all` so it is DB-agnostic
(works on Postgres/MySQL/SQLite without the MySQL-specific Alembic migrations). Seeds roles, one
organisation, warehouses, the standard chart of accounts, cost centers, and four demo logins — but only
if the database is empty, so redeploys are safe.

Demo logins: admin/admin123 · accountant/acc123 · manager/mgr123 · rep/rep123
(Change these before real production use.)
"""
from __future__ import annotations

from src.core.db import Base, SessionLocal, engine
from src.core.security import hash_password
import src.models  # noqa: F401 — populate metadata
from src.models.ledger import AccountNature
from src.models.org import Branch, Governorate, Territory
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Warehouse, WarehouseType
from src.services import chart_service, cost_center_service


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if db.query(User).first() is not None:
            print("bootstrap: users already present — skipping seed.")
            return

        roles = {}
        for rn in RoleName:
            r = Role(name=rn)
            db.add(r)
            db.flush()
            roles[rn] = r.id

        gov = Governorate(name="القاهرة")
        db.add(gov)
        db.flush()
        branch = Branch(name="الفرع الرئيسي", governorate_id=gov.id)
        db.add(branch)
        db.flush()
        terr = Territory(name="منطقة وسط", branch_id=branch.id)
        db.add(terr)
        db.flush()
        central = Warehouse(name="المخزن المركزي", warehouse_type=WarehouseType.central)
        branch_wh = Warehouse(name="مخزن الفرع", warehouse_type=WarehouseType.branch, branch_id=branch.id)
        db.add_all([central, branch_wh])
        db.flush()

        def user(username, role, pw, **kw):
            db.add(User(username=username, password_hash=hash_password(pw), role_id=roles[role],
                        full_name=username, **kw))

        user("admin", RoleName.system_admin, "admin123")
        user("accountant", RoleName.accountant, "acc123")
        user("manager", RoleName.branch_manager, "mgr123", branch_id=branch.id)
        user("rep", RoleName.sales_rep, "rep123", branch_id=branch.id, territory_id=terr.id)
        db.flush()

        groups = chart_service.seed_standard_chart(db)
        op_group = chart_service.create_account(
            db, code="5.10", name="مصروفات تشغيلية", nature=AccountNature.expense,
            is_postable=False, parent_id=groups["5"].id)
        chart_service.create_account(
            db, code="5.10.001", name="إيجار", nature=AccountNature.expense,
            is_postable=True, parent_id=op_group.id)
        cc_root = cost_center_service.create(db, code="1", name="الفروع")
        cost_center_service.create(db, code="1.01", name="معرض مدينة نصر", parent_id=cc_root.id)

        db.commit()
        print("bootstrap: seeded base org, chart, cost centers, and demo users.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
