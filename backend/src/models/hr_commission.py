"""إعدادات عمولات المرتبات — محرك العمولات الشهري لكل فرع.

العميل كان بيحسب العمولات في ملف إكسل كل شهر («مرتبات شهر اكتوبر»): بلوك لكل سيارة
(تحصيل بولي × ٢٫٥٪ + أبيض × ٢٪ مقسوم على الاتنين، وناقص الغياب)، وبلوك لكل مشرف (نسبة من
تحصيل مجموعة سيارات)، وبلوك «خصم ٢٥٪» لكل سيارة، وجدول للفنيين (كوبونات ومعاينات وسباكين).
الأسماء والنسب كانت مكتوبة جوّه المعادلات نفسها، فتغيير مندوب من سيارة لسيارة كان معناه
تعديل خمس خلايا في أماكن متفرّقة.

هنا كل حاجة من دول **صف**، بفرعه:

* `HrCommissionSetting` — أرقام الفرع العامة: قيمة النقطة، نقاط الكوبون، القاسم (٦٠٠)، أرقام
  خصم الـ٢٥٪، وهل عمولة الكوبونات بتتصرف أصلاً.
* `HrCommissionTeam` — «السيارة»: نسبها، حسابات المناديب اللي أرقامها بتتحسب (`team_user`)،
  وأفرادها اللي بيقتسموا العمولة (`team_member`) وكل فرد معفي من خصم الـ٢٥٪ ولا لأ.
* `HrCommissionSupervisor` — مشرف بنسبة من تحصيل سيارات معيّنة (`supervisor_team`).
* `HrCommissionTechnician` — فني خدمة عملاء بمعامله وحدّه الأدنى وسعر المعاينة والسباك.
* `HrCommissionManualCollection` — تحصيل من بره النظام لسيارة في شهر («اسكندرية»
  و«الضبعة» في الملف أرقام مكتوبة بالإيد).

**ليه مافيش إصدارات بتاريخ سريان؟** الشهر اللي اتقفل بيتقفل في شيت المرتبات نفسه (المبالغ
بتتنسخ في سطوره)، فالإعدادات مابتحتاجش تفتكر الماضي — اللي محتاجه هو «مين غيّر إيه وإمتى»،
وده في سجل العمليات (`audit_service`) مع كل حفظ. الإصدارات كانت هتضيف شاشة كاملة عشان سؤال
اتجاوب في مكان تاني.

جداول جديدة بس — `create_all` بيعملها مع التشغيل.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY

#: نسبة مئوية بأربع أرقام عشرية — ٠٫٨٨٪ و١٫٢٥٪ في الملف، و`PCT` (رقمين) كان هيقرّبهم.
RATE = Numeric(9, 4)


class HrCommissionSetting(Base):
    """أرقام الفرع العامة — صف واحد لكل فرع."""

    __tablename__ = "hr_commission_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), unique=True, nullable=False)
    # قيمة النقطة — «النقاط * 52.35 قيمة نقطة شهر 2». بتتغيّر كل كام شهر.
    point_value: Mapped[object] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    # نقاط الكوبون الواحد (٣٠ في الملف).
    points_per_coupon: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    # معامل الفني بيتقسم على الرقم ده (١٫٥ / ٦٠٠ = ٠٫٢٥٪).
    factor_divisor: Mapped[object] = mapped_column(Numeric(9, 2), default=600, nullable=False)
    # خصم الغياب من العمولة: العمولة / ٣٠ × أيام الغياب.
    absence_divisor: Mapped[object] = mapped_column(Numeric(9, 2), default=30, nullable=False)
    # خصم ٢٥٪: (المديونية − الائتمان) − ٢٥٪ من البيع، وعلى كل ١٠٠٠ زيادة ٢٠ ج.
    penalty_sales_pct: Mapped[object] = mapped_column(RATE, default=25, nullable=False)
    penalty_per_thousand: Mapped[object] = mapped_column(RATE, default=20, nullable=False)
    # سند القبض اللي مالوش مندوب (المنقول من a5) بيتحسب لمندوب العميل؟
    attribute_by_customer_rep: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # عمولة الكوبونات بتتصرف في المرتب؟ في ملف أكتوبر بتتحسب ومابتدخلش المرتب (عمود
    # «عمولة معاينات» بيشاور على المعاينات بس) — فالافتراضي لأ لحد ما العميل يقول.
    pay_coupon_commission: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # «خصم المعاينات» (الحد الأدنى): الملف بيحسب نصيب المعاينة بس والعمود فاضي — فالافتراضي لأ.
    apply_min_inspections: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class HrCommissionTeam(Base):
    """سيارة (أو أي مجموعة تحصيل) — نسبها وأفرادها."""

    __tablename__ = "hr_commission_team"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # نسب مئوية من التحصيل: بولي/تكنو، أبيض، والتحصيل اللي مالوش عيلة (حساب العميل القديم).
    rate_poly: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_white: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_other: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    # بتتقسم على الأفراد بالتساوي؟ «الشرقية» في الملف كل فرد واخد العمولة كاملة.
    split_equally: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # خصم ٢٥٪ شغّال على السيارة دي؟ والائتمان المسموح لعملائها.
    penalty_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    credit_limit: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class HrCommissionTeamUser(Base):
    """حساب مندوب أرقامه (تحصيل، بيع، مديونية عملاء) بتتحسب للسيارة.

    منفصل عن الأفراد عن قصد: «مندوب السياره ( أ )» حساب واحد على الجهاز، واللي بيقتسموا
    عمولته اتنين — واحد منهم مالوش حساب أصلاً.
    """

    __tablename__ = "hr_commission_team_user"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_hr_comm_team_user"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)


class HrCommissionTeamMember(Base):
    """فرد في السيارة بيقتسم عمولتها."""

    __tablename__ = "hr_commission_team_member"
    __table_args__ = (
        UniqueConstraint("team_id", "employee_id", name="uq_hr_comm_team_member"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), nullable=False)
    # «استثناء خصم ال 25 %» — نصيبه من الخصم مابيتخصمش منه.
    exempt_25: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class HrCommissionSupervisor(Base):
    """مشرف بياخد نسبة من تحصيل سيارات معيّنة (وممكن يتخصم منه جزء من زيادتهم)."""

    __tablename__ = "hr_commission_supervisor"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), nullable=False)
    label: Mapped[str | None] = mapped_column(String(80), nullable=True)  # «اشراف على ب/د»
    rate_poly: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_white: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    rate_other: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    # ٪ من زيادة خصم الـ٢٥٪ بتاعة السيارات اللي تحته (حسن رمضان: ٠٫٥٪ من زيادة ب + د).
    penalty_rate: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    # ٠ = تحصيل نفس الشهر، ١ = الشهر اللي فات («الشهر السابق» فوق بلوك كامل هلول).
    period_offset: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deduct_absence: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class HrCommissionSupervisorTeam(Base):
    __tablename__ = "hr_commission_supervisor_team"
    __table_args__ = (
        UniqueConstraint("supervisor_id", "team_id", name="uq_hr_comm_supervisor_team"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    supervisor_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_supervisor.id", ondelete="CASCADE"), nullable=False, index=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False)


class HrCommissionTechnician(Base):
    """فني خدمة عملاء — كوبوناته ومعايناته وسباكينه من حسابه على التطبيق (`employee.user_id`)."""

    __tablename__ = "hr_commission_technician"
    __table_args__ = (
        UniqueConstraint("branch_id", "employee_id", name="uq_hr_comm_technician"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(ForeignKey("branch.id"), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employee.id"), nullable=False)
    # «نسبة العمولة» في الملف: ١٫٥ / ٣٫٦ / ١٫٨ — بتتقسم على `factor_divisor`.
    factor: Mapped[object] = mapped_column(RATE, default=0, nullable=False)
    min_inspections: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inspection_rate: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)  # ٤٨ / ٣٠
    plumber_rate: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)     # ١٠ / ١٥
    # own = شغله هو؛ all = مسؤول الفنيين (محمد هلال): كوبونات ومعاينات الفنيين كلهم.
    scope: Mapped[str] = mapped_column(String(8), default="own", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)


class HrCommissionManualCollection(Base):
    """تحصيل شهر لسيارة من بره النظام — بيتجمع على اللي النظام حسبه."""

    __tablename__ = "hr_commission_manual_collection"
    __table_args__ = (
        UniqueConstraint("team_id", "year", "month", name="uq_hr_comm_manual_collection"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("hr_commission_team.id", ondelete="CASCADE"), nullable=False, index=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    poly: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    white: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    other: Mapped[object] = mapped_column(MONEY, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(String(300), nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
