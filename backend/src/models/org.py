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
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    governorate: Mapped[Governorate] = relationship()
    territories: Mapped[list[Territory]] = relationship(back_populates="branch")


class Territory(Base):
    __tablename__ = "territory"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    branch: Mapped[Branch] = relationship(back_populates="territories")
