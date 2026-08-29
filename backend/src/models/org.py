"""Organization models (T032–T033). FR-012, FR-014.

Head office + branches (each in an Egyptian governorate); territories each wholly within
one branch.
"""
from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK


class Governorate(Base):
    __tablename__ = "governorate"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)


class HeadOffice(Base):
    __tablename__ = "head_office"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)


class Branch(Base):
    __tablename__ = "branch"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    governorate_id: Mapped[int] = mapped_column(ForeignKey("governorate.id"), nullable=False)
    is_head_office: Mapped[bool] = mapped_column(default=False, nullable=False)
    # «بيان ١» و«بيان ٢» — two free note lines off their الفروع form (031). Deliberately unnamed
    # and unvalidated: a branch collects things that belong to no column — a landlord's number, a
    # licence reference, «التسليم من باب المخزن مش الشارع» — and giving them a shape now would
    # only be a shape somebody has to work around later.
    note1: Mapped[str | None] = mapped_column(String(300), nullable=True)
    note2: Mapped[str | None] = mapped_column(String(300), nullable=True)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    governorate: Mapped[Governorate] = relationship()
    territories: Mapped[list[Territory]] = relationship(back_populates="branch")


class Territory(Base):
    __tablename__ = "territory"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False)
    # (038) المنطقة الأب — «٦ اكتوبر» فوق «الحى الأول» و«الفردوس» و«المستقبل».
    #
    # النظام القديم بيعمل المستويين بالاسم: كل عميل شايل نص المنطقة ونص أبوها. فتغيير اسم
    # منطقة بيسيب العملاء على الاسم القديم، ومافيش حاجة بتمنع منطقة اسمها «.» أو «0» —
    # ولقينا الاتنين في بياناتهم فعلاً.
    #
    # هنا مفتاح: الأب منطقة زي أي منطقة، والابن بيشاور عليها. تغيير الاسم بيتحرّك لوحده،
    # والحذف بيترفض طالما تحتها حاجة.
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("territory.id"), nullable=True, index=True)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    branch: Mapped[Branch] = relationship(back_populates="territories")
    parent: Mapped["Territory | None"] = relationship(remote_side="Territory.id")
