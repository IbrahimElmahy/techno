"""Branch helpers — 024-multi-branch.

The company is a tree: one company, its branches, and under each branch a full independent
copy of the data (accounts, warehouses, reps, customers, treasuries). This module resolves the
*default branch* — the one every legacy/branch-less record is homed to — so the whole system
keeps working as a single branch until more branches are added.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.org import Branch, Governorate


def default_branch(db: Session) -> Branch:
    """The company's main branch — a head-office branch, else the oldest, else created.

    Every account/customer/document with no branch belongs here. Idempotent.
    """
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
    # Fresh install: create the main branch (a branch needs a governorate).
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
    """A concrete branch id — the given one, or the default branch when none is supplied."""
    if branch_id is not None:
        return branch_id
    return default_branch(db).id


def list_branches(db: Session, *, active_only: bool = False) -> list[Branch]:
    stmt = select(Branch)
    if active_only:
        stmt = stmt.where(Branch.active.is_(True))
    return db.scalars(stmt.order_by(Branch.is_head_office.desc(), Branch.id)).all()
