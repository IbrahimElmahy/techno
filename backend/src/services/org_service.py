from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.org import Branch, Governorate


def default_branch(db: Session) -> Branch:
    branch = db.scalar(
        select(Branch)
        .where(Branch.is_head_office.is_(True), Branch.active.is_(True))
        .order_by(Branch.id)
    )
    if branch is not None:
        return branch
    branch = db.scalar(select(Branch).order_by(Branch.id))
    if branch is not None:
        return branch
    gov = db.scalar(select(Governorate).order_by(Governorate.id))
    if gov is None:
        gov = Governorate(name="غير محدد")
        db.add(gov)
        db.flush()
    branch = Branch(name="الفرع الرئيسي", governorate_id=gov.id, is_head_office=True)
    db.add(branch)
    db.flush()
    return branch


def resolve_branch_id(db: Session, branch_id: int | None) -> int:
    if branch_id is not None:
        return branch_id
    return default_branch(db).id


def factory_branches(db: Session) -> list[Branch]:
    return db.scalars(select(Branch).where(
        Branch.is_factory.is_(True), Branch.active.is_(True)).order_by(Branch.id)).all()


def production_branch_problem(db: Session, branch_id: int | None,
                              warehouse_ids) -> tuple[int | None, str | None]:
    factories = factory_branches(db)
    if not factories:
        return branch_id, None
    ids = {b.id for b in factories}
    names = "، ".join(b.name for b in factories)
    if branch_id is None and len(factories) == 1:
        branch_id = factories[0].id
    if branch_id not in ids:
        return branch_id, f"أوامر التشغيل في فرع المصنع فقط ({names})."
    from src.models.warehouse import Warehouse

    wanted = {int(w) for w in warehouse_ids if w is not None}
    if wanted:
        foreign = db.scalars(select(Warehouse).where(
            Warehouse.id.in_(wanted),
            (Warehouse.branch_id != branch_id) | Warehouse.branch_id.is_(None))).all()
        if foreign:
            listed = "، ".join(w.name for w in foreign[:3])
            return branch_id, f"المخزن «{listed}» ليس من فرع المصنع ({names})."
    return branch_id, None


def list_branches(db: Session, *, active_only: bool = False) -> list[Branch]:
    stmt = select(Branch)
    if active_only:
        stmt = stmt.where(Branch.active.is_(True))
    return db.scalars(stmt.order_by(Branch.is_head_office.desc(), Branch.id)).all()
