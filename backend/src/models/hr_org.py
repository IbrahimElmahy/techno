"""الهيكل التنظيمي — الأقسام ونهاية الخدمة (HR-1).

`Employee.department` is a free `String(120)`, and free text is how «المبيعات» and «مبيعات» and
«قسم المبيعات» end up being three departments in a report nobody can total. It is also why the
question «تكلفة أجور قسم المخازن» has no answer today: a string cannot carry a manager, a parent, or
a cost centre.

So a real table. It is deliberately NOT a `LookupOption` (`services/lookup_registry.py`): a lookup
gives you the list and nothing else, and the reports need the tree (a section inside a department),
the manager, and the link to `cost_center` that makes payroll land in the cost-centre P&L.

The old free-text column is kept and keeps being read where nothing has been mapped yet — the
migration is an explicit endpoint somebody runs and reviews, not startup magic.

`EmployeeTermination` is a separate table rather than three more columns on `employee` for the same
reason everything else here is: a new table costs nothing (`create_all` makes it on boot), and every
column added to `employee` costs an `_ADDED_COLUMNS` entry whose failures are swallowed at info
level.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY


class Department(Base):
    """القسم — شجرة، وليها مدير ومركز تكلفة."""

    __tablename__ = "department"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    # شجرة: «قسم المبيعات» جوّاه «مبيعات القاهرة». Unbounded depth, same shape as `cost_center`.
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("department.id"), nullable=True, index=True
    )
    # مدير القسم موظف، مش مستخدم — أمين المخزن بيدير مخزن من غير حساب دخول.
    manager_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee.id"), nullable=True
    )
    # This is what makes «تكلفة أجور القسم» readable off the cost-centre P&L instead of needing a
    # report that knows about payroll specifically: the payroll entry carries the cost centre, and
    # the cost centre is where the department already points.
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True
    )
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branch.id"), nullable=True, index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    parent: Mapped[Department | None] = relationship(remote_side=[id], backref="children")


class TerminationKind(str, enum.Enum):
    """ليه الموظف مشي. Not cosmetic: an استقالة and a فصل have different end-of-service maths."""

    resignation = "resignation"      # استقالة
    dismissal = "dismissal"          # فصل
    contract_end = "contract_end"    # انتهاء عقد
    retirement = "retirement"        # معاش
    death = "death"                  # وفاة


class EmployeeTermination(Base):
    """نهاية الخدمة — صف واحد للموظف.

    Its own table so «التعيينات والمغادرات خلال فترة» is one query, and so `employee.active` stays
    what it has always been: a flag, with no date and no reason attached to it.
    """

    __tablename__ = "employee_termination"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), unique=True, nullable=False, index=True
    )
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # آخر يوم شغل فعلي — ممكن يكون قبل تاريخ انتهاء العقد بمدة الأجازات المستحقة.
    last_working_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    kind: Mapped[TerminationKind] = mapped_column(
        # native_enum=False on purpose: a native ENUM can never gain a member on a live PG/MySQL
        # database, and `create_all` never alters. Every enum added after this project's first
        # release carries this.
        Enum(TerminationKind, native_enum=False, length=16), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    settlement_amount: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
