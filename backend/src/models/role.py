"""Role model (T024). The six constitution roles (FR-005)."""
from __future__ import annotations

import enum

from sqlalchemy import Enum
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class RoleName(str, enum.Enum):
    system_admin = "system_admin"
    branch_manager = "branch_manager"
    purchasing_manager = "purchasing_manager"
    sales_manager = "sales_manager"
    after_sales_staff = "after_sales_staff"
    sales_rep = "sales_rep"
    # General Ledger (005) — manages the chart, posts/reverses journals, reads the trial balance.
    accountant = "accountant"
    # «قارئ» — sees everything, changes nothing (their نوع المستخدم has exactly this alongside
    # «مدخل بيانات»). The owner who wants to watch the business without being able to touch a
    # document, the auditor given a login for a week, the new hire being shown around. Without it
    # those people get handed a manager's account «for now», and «for now» is how a system ends up
    # with five people able to reverse an invoice.
    viewer = "viewer"
    # «المالك» — صاحب الشركة. بيشوف كل حاجة زي مدير النظام، **وزيادة**: كروت
    # الإحصائيات اللي فوق الشاشات (إجماليات المبيعات والأرباح والمديونيات) مقصورة
    # عليه هو ومدير النظام وحدهم.
    #
    # دور لوحده مش مجرد يوزر: «اخفي الأرقام عن الكل إلا واحد» لو اتعملت بفحص اسم
    # المستخدم بتقع أول ما حد يغيّر الاسم أو يتعمل مالك تاني، والشاشة اللي بتقرر
    # بالاسم مافيش شاشة صلاحيات تقدر تعدّلها.
    owner = "owner"


class Role(Base):
    __tablename__ = "role"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[RoleName] = mapped_column(Enum(RoleName), unique=True, nullable=False)
