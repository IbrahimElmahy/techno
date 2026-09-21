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


ITEM_CATEGORY = "item_category"


def parent_map(db: Session, category: str) -> dict[str, str]:
    """قيمة الفئة ← قيمة أبوها، للفئات اللي ليها أب بس. (031)

    استعلام **واحد** للقايمة كلها (عشرات الصفوف)، عشان اللي بيجمّع آلاف السطور يقرا
    منه بالقاموس بدل استعلام لكل سطر.
    """
    rows = db.execute(
        select(LookupOption.value, LookupOption.parent_value)
        .where(LookupOption.category == category,
               LookupOption.parent_value.is_not(None))
    ).all()
    return {value: parent for value, parent in rows}


def root_of(parents: dict[str, str], value: str | None) -> str | None:
    """الفئة الرئيسية لقيمة — هي نفسها لو مالهاش أب.

    خطوة واحدة لفوق لأن الشجرة مستويين (شوف `LookupOption.parent_value`). اللي بيجمّع
    على الرئيسية بيندهها لكل سطر، فمافيش لفّة ولا استعلام هنا — قراءة من قاموس وخلاص.
    """
    if value is None:
        return None
    return parents.get(value, value)


def with_children(db: Session, category: str, value: str) -> list[str]:
    """القيمة ومعاها فروعها — للفلترة على فئة رئيسية.

    الفئة اللي مالهاش فروع بترجع لوحدها، فاللي مش عامل شجرة بيفلتر بنفس القيمة الواحدة
    بالظبط زي ما كان.
    """
    kids = db.scalars(
        select(LookupOption.value)
        .where(LookupOption.category == category, LookupOption.parent_value == value)
    ).all()
    return [value, *kids]


def _check_parent(db: Session, *, category: str, value: str, parent_value: str) -> None:
    """حراسة الشجرة: أب موجود، في نفس القايمة، ومستويين وبس."""
    if parent_value == value:
        raise LookupError("الفئة مش ممكن تبقى أب نفسها.")
    parent = db.scalar(
        select(LookupOption).where(LookupOption.category == category,
                                   LookupOption.value == parent_value))
    if parent is None:
        raise LookupError("الفئة الرئيسية دي مش موجودة في نفس القايمة.")
    if parent.parent_value:
        raise LookupError("الفئة الرئيسية مالهاش تبقى فرعية هي كمان — مستويين وبس.")
    has_children = db.scalar(
        select(LookupOption.id).where(LookupOption.category == category,
                                      LookupOption.parent_value == value).limit(1))
    if has_children is not None:
        raise LookupError("الفئة دي تحتها فئات فرعية، فمينفعش تبقى فرعية لغيرها.")


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
                  sort_order: int | None = None,
                  description: str | None = None,
                  parent_value: str | None = None) -> LookupOption:
    meta = CATEGORIES.get(category)
    if meta is None:
        raise LookupError("القايمة دي مش معروفة.")
    if meta.get("system"):
        raise LookupError(
            "This list is tied to system logic — you can relabel/reorder/hide its options, "
            "but cannot add new values."
        )
    _ensure_seeded(db, category)
    if not value or not label:
        raise LookupError("القيمة والاسم الاتنين مطلوبين.")
    dup = db.scalar(
        select(LookupOption).where(LookupOption.category == category, LookupOption.value == value)
    )
    if dup is not None:
        raise LookupError("فيه اختيار بنفس القيمة في القايمة دي.")
    if sort_order is None:
        current = db.scalars(
            select(LookupOption.sort_order).where(LookupOption.category == category)
        ).all()
        sort_order = (max(current) + 1) if current else 0
    if parent_value:
        _check_parent(db, category=category, value=value, parent_value=parent_value)
    opt = LookupOption(category=category, value=value, label=label, sort_order=sort_order,
                       active=True, is_system=False, description=description,
                       parent_value=parent_value or None)
    db.add(opt)
    db.flush()
    return opt


def update_option(db: Session, *, option_id: int, label: str | None = None,
                  sort_order: int | None = None, active: bool | None = None,
                  description: str | None = None,
                  parent_value: str | None = None) -> LookupOption:
    """`parent_value=None` معناها «ماتلمسش الأب»، و`""` معناها «شيل الأب».

    زي `description` بالظبط: الحقل اللي ما اتبعتش مابيتغيّرش. لو `None` كانت معناها
    «شيل»، كل تعديل اسم من الشاشة القديمة كان هيفكّ الشجرة من غير ما حد يطلب.
    """
    opt = db.get(LookupOption, option_id)
    if opt is None:
        raise LookupError("الاختيار مش موجود.")
    if label is not None:
        opt.label = label
    if parent_value is not None:
        if parent_value:
            _check_parent(db, category=opt.category, value=opt.value,
                          parent_value=parent_value)
            opt.parent_value = parent_value
        else:
            opt.parent_value = None
    if sort_order is not None:
        opt.sort_order = sort_order
    if active is not None:
        opt.active = active
    if description is not None:
        # Blank clears it; the field is a note, so an empty note is a valid state.
        opt.description = description or None
    db.flush()
    return opt


def delete_option(db: Session, *, option_id: int) -> None:
    opt = db.get(LookupOption, option_id)
    if opt is None:
        raise LookupError("الاختيار مش موجود.")
    if opt.is_system:
        raise LookupError("A system option cannot be deleted — hide it (deactivate) instead.")
    # الأب اللي تحته فروع مابيتشالش. (031) الفرع بيأشّر على أبوه بقيمته، فشيل الأب
    # بيسيب فروع بتأشّر على حاجة مش موجودة — بتختفي من الشجرة على الشاشة وتفضل على
    # الأصناف. الرفض هنا بيخلّي اللي بيشيل يفكّ الفروع الأول وهو شايفها.
    kid = db.scalar(
        select(LookupOption.id).where(LookupOption.category == opt.category,
                                      LookupOption.parent_value == opt.value).limit(1))
    if kid is not None:
        raise LookupError("تحتها فئات فرعية — شيلها أو غيّر أبوها الأول.")
    db.delete(opt)
    db.flush()
