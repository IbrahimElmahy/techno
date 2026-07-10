"""Lookup (configurable dropdown) service — 013-settings-lookups.

Lazily seeds each category from the registry on first read, so fresh DBs and tests always have the
enum-bound defaults without an explicit seed step. Enforces the system/custom guard on writes.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.lookup import LookupOption
from src.services import lookup_registry
from src.services.lookup_registry import CATEGORIES


class LookupError(Exception):
    pass


def _ensure_seeded(db: Session, category: str) -> None:
    """Populate a category's default options once (idempotent)."""
    meta = CATEGORIES.get(category)
    if meta is None:
        return
    exists = db.scalar(select(LookupOption.id).where(LookupOption.category == category).limit(1))
    if exists is not None:
        return
    for i, (value, label) in enumerate(meta["defaults"]):
        db.add(LookupOption(category=category, value=value, label=label, sort_order=i,
                            active=True, is_system=bool(meta.get("system"))))
    db.flush()


def list_options(db: Session, category: str, active_only: bool = False) -> list[LookupOption]:
    _ensure_seeded(db, category)
    stmt = select(LookupOption).where(LookupOption.category == category)
    if active_only:
        stmt = stmt.where(LookupOption.active.is_(True))
    return list(db.scalars(stmt.order_by(LookupOption.sort_order, LookupOption.id)).all())


def categories() -> list[dict]:
    """Registry grouped by page for the Settings UI."""
    pages: dict[str, dict] = {}
    for key, meta in CATEGORIES.items():
        page = meta["page"]
        pages.setdefault(page, {
            "page": page,
            "page_label": lookup_registry.PAGE_LABELS.get(page, page),
            "categories": [],
        })
        pages[page]["categories"].append(
            {"category": key, "label": meta["label"], "system": bool(meta.get("system"))}
        )
    return list(pages.values())


def create_option(db: Session, *, category: str, value: str, label: str,
                  sort_order: int | None = None) -> LookupOption:
    meta = CATEGORIES.get(category)
    if meta is None:
        raise LookupError("Unknown category.")
    if meta.get("system"):
        raise LookupError(
            "This list is tied to system logic — you can relabel/reorder/hide its options, "
            "but cannot add new values."
        )
    _ensure_seeded(db, category)
    if not value or not label:
        raise LookupError("Both value and label are required.")
    dup = db.scalar(
        select(LookupOption).where(LookupOption.category == category, LookupOption.value == value)
    )
    if dup is not None:
        raise LookupError("An option with this value already exists in the list.")
    if sort_order is None:
        current = db.scalars(
            select(LookupOption.sort_order).where(LookupOption.category == category)
        ).all()
        sort_order = (max(current) + 1) if current else 0
    opt = LookupOption(category=category, value=value, label=label, sort_order=sort_order,
                       active=True, is_system=False)
    db.add(opt)
    db.flush()
    return opt


def update_option(db: Session, *, option_id: int, label: str | None = None,
                  sort_order: int | None = None, active: bool | None = None) -> LookupOption:
    opt = db.get(LookupOption, option_id)
    if opt is None:
        raise LookupError("Option not found.")
    if label is not None:
        opt.label = label
    if sort_order is not None:
        opt.sort_order = sort_order
    if active is not None:
        opt.active = active
    db.flush()
    return opt


def delete_option(db: Session, *, option_id: int) -> None:
    opt = db.get(LookupOption, option_id)
    if opt is None:
        raise LookupError("Option not found.")
    if opt.is_system:
        raise LookupError("A system option cannot be deleted — hide it (deactivate) instead.")
    db.delete(opt)
    db.flush()
