"""شيت المرتبات — مجموعات المرتبات وخانات الشهر (طلب العميل ٢٠٢٦-١٠-٠٨).

العميل بيعمل مرتباته على إكسل: ورقة لكل فرع فيها **مجموعات** (البيع، الإدارية، خدمة العملاء)،
كل مجموعة ليها أعمدتها هي وترتيبها هي، وتحت كل مجموعة إجمالي، وفي الآخر صافي كل مجموعة
والإجمالي العام. والشاشة لازم تشتغل زي الورقة دي بالظبط، مش زي «مسير» بأعمدة ثابتة.

**المجموعة إعداد للفرع، والشيت صورة منها وقت الشهر.** `PayrollGroup` هو اللي بيتعدّل من شاشة
«مجموعات المرتبات»؛ و`PayrollSheetGroup` نسخة منه بتتاخد مع كل «تجهيز شهر». ليه نسخة؟ لأن
مارس المعتمد لازم يفضل يتقرا بأعمدة مارس — لو حد زوّد عمود «مكالمات» في أبريل، شيت مارس
مايتغيّرش شكله ولا إجماليه.

**الخانة فيها رقمين: المحسوب والمكتوب.** `computed` هو اللي النظام جابه (إعدادات الراتب، محرك
العمولات، الحضور، السلف، الجزاءات)، و`override` هو اللي المحاسب كتبه فوقه. الاتنين بيتخزّنوا
عشان «إعادة التجهيز» تحدّث المحسوب من غير ما تمسح اللي اتكتب بالإيد — زي الإكسل بالظبط: الخانة
اللي فيها رقم مكتوب بتفضل، والخانة اللي فيها معادلة بتتحسب من جديد.

الشيت نفسه **هو** `PayrollRun` (نفس المستند ونفس الترقيم ونفس الترحيل والعكس) — الجداول دي
بتشيل شكل الإكسل بس. سطور `payroll_line` بتتبني من الشيت، فالترحيل وقسيمة الراتب وكل تقارير
المرتبات الموجودة بتشتغل عليه من غير ما تتغيّر.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY


class PayrollGroup(Base):
    """مجموعة مرتبات في فرع — «البيع»، «الإدارية»، «خدمة العملاء/الفنيين».

    `columns` قايمة أعمدة بالترتيب، كل عمود: `{key, label, source, ref, kind, posting, carry,
    fallback_component_id}` — شوف `payroll_sheet_service.SOURCES`. قايمة JSON مش جدول لأنها
    بتتقرا وتتكتب كوحدة واحدة دايماً (الترتيب جزء منها)، ومحدش بيسأل «مين بيستعمل عمود كذا».
    """

    __tablename__ = "payroll_group"
    __table_args__ = (
        UniqueConstraint("branch_id", "name", name="uq_payroll_group_branch_name"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    columns: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # الغياب = (مجموع الأعمدة دي) ÷ القاسم × الأيام. البيع: (أساسي + بدلات)/30، والإدارية
    # وخدمة العملاء: أساسي/30 — مكتوب في معادلات ملف العميل نفسه.
    absence_base: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    absence_divisor: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class PayrollGroupMember(Base):
    """الموظف في أنهي مجموعة — مجموعة واحدة بس للموظف.

    جدول لوحده مش عمود على `employee`: كارت الموظف بيتكتب من شاشات كتير (والاستيراد من a5)،
    والتوزيع على المجموعات شغل المحاسب لوحده — ماينفعش حفظ كارت يمسحه.
    """

    __tablename__ = "payroll_group_member"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, unique=True
    )
    group_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_group.id"), nullable=False, index=True
    )
    # ترتيب الصف جوّه المجموعة — ملف العميل مترتّب بإيده (مش أبجدي)، والورق المطبوع لازم
    # يطلع بنفس الترتيب اللي الناس متعوّدة تدوّر فيه.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class PayrollSheetGroup(Base):
    """نسخة المجموعة اللي الشهر اتجهّز بيها — أعمدتها متجمّدة مع الشهر."""

    __tablename__ = "payroll_sheet_group"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("payroll_run.id"), nullable=False, index=True)
    # مش FK: المجموعة ممكن تتمسح بعدين، والشهر المعتمد لازم يفضل يتقرا.
    group_id: Mapped[int | None] = mapped_column(BigIntPK, nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    columns: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    absence_base: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    absence_divisor: Mapped[int] = mapped_column(Integer, default=30, nullable=False)


class PayrollSheetRow(Base):
    """صف موظف في الشيت."""

    __tablename__ = "payroll_sheet_row"
    __table_args__ = (
        UniqueConstraint("run_id", "employee_id", name="uq_payroll_sheet_row_employee"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("payroll_run.id"), nullable=False, index=True)
    sheet_group_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_sheet_group.id"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employee.id"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # أيام الغياب من الحضور، واللي المحاسب كتبه فوقها. الحضور في الفروع لسه مش متسجّل كله،
    # فالرقم المكتوب لازم يغلب — زي `*0` و`*2` اللي بيتكتبوا بالإيد في معادلات الملف.
    absent_days: Mapped[object] = mapped_column(QTY, default=0, nullable=False)
    absent_days_override: Mapped[object | None] = mapped_column(QTY, nullable=True)
    earnings: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    deductions: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    net: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    # موظف مالوش إعدادات راتب — الصف بيظهر (عشان محدش ينساه) بس بعلامة.
    no_salary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)


class PayrollSheetCell(Base):
    """خانة واحدة — المحسوب، والمكتوب فوقه، ومنين جه."""

    __tablename__ = "payroll_sheet_cell"
    __table_args__ = (
        UniqueConstraint("row_id", "col_key", name="uq_payroll_sheet_cell"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    row_id: Mapped[int] = mapped_column(
        ForeignKey("payroll_sheet_row.id"), nullable=False, index=True
    )
    col_key: Mapped[str] = mapped_column(String(60), nullable=False)
    computed: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    override: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    # «إعدادات الراتب»، «محرك العمولات»، «الحضور: ٢ يوم»، «قسط سلفة SA-0003» — اللي بيتعرض
    # لما الماوس يقف على الخانة، عشان المحاسب يعرف الرقم ده جه منين من غير ما يسأل حد.
    source_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
