"""Configurable dropdown option lists (lookups) — 013-settings-lookups.

Every admin-configurable dropdown reads its options from `lookup_option`, keyed by `category`.
Two kinds of category (see src/services/lookup_registry.py):
- **system** (enum-bound): options are seeded from a backend Enum; the admin may relabel, reorder,
  and hide them, but MUST NOT add arbitrary new `value`s (business logic switches on the enum) —
  enforced in the service. `is_system=True` on those rows.
- **custom** (free lists, e.g. units of measure): full add/edit/remove.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class LookupOption(Base):
    __tablename__ = "lookup_option"
    __table_args__ = (
        UniqueConstraint("category", "value", name="uq_lookup_category_value"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(64), nullable=False)   # the code business logic uses
    label: Mapped[str] = mapped_column(String(160), nullable=False)  # Arabic display text
    # A free note on the option itself — what this category covers, when to pick this reason.
    # Lives on the lookup rather than on a category table because the lookup IS the list: it
    # already carries the name, the order and the hidden flag, and a second table holding one
    # extra field would be two places to keep the same list.
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # **الأب — `value` بتاع اختيار تاني في نفس القايمة. `NULL` = رئيسي.** (031)
    #
    # اتحطّ هنا مش على `item`: المطلوب إن فئات الأصناف تبقى شجرة، والشجرة صفة
    # **القايمة** مش صفة الصنف. `Item.category` بيفضل ماسك قيمة الفئة اللي عليها زي
    # ما هي بالحرف — ولا صنف واحد بيتغيّر عشان الشجرة تتعمل — والأبوّة بتتقري من
    # صف الفئة نفسه.
    #
    # وبالـ`value` مش بالـ`id` لأن كل النظام بيأشّر على الفئة بقيمتها (`Item.category`
    # نص)، فالمقارنة بتبقى على نفس العملة من غير join ولا خريطة id←value في كل شاشة.
    # والقيمة مابتتغيّرش بعد الإنشاء (شاشة الفئات بتعدّل الاسم بس)، فالمؤشّر ثابت.
    #
    # **مستويين وبس** — رئيسية ← فرعية ← أصناف. الخدمة بترفض أب ليه أب، وبترفض تدّي
    # أب لفئة ليها فروع. ده مش تزمّت: التجميع في التقارير بيمشي خطوة واحدة لفوق،
    # ولو الشجرة بقت عميقة يبقى كل تقرير محتاج يلف — ولا واحد فيهم بيلف دلوقتي.
    parent_value: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # True for options seeded from a backend Enum — value is locked, row cannot be deleted.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
