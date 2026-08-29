"""صلاحيات الأدوار كما ضبطها المستخدم — طبقة فوق الافتراضي المكتوب في الكود.

`rbac.ROLE_CAPABILITIES` هو الافتراضي: اللي الشركة بتبدأ بيه. الجدول ده هو اللي **اتقال
صراحةً** من شاشة الصلاحيات، ولما يبقى فيه صفوف لدور، بيبقى هو كلمة الدور دي — مش زيادة على
الافتراضي ولا نقصان منه، بديل كامل.

ليه بديل مش إضافة/استثناء: «الدور ده بيقدر يعمل إيه» لازم يبقى ليها إجابة واحدة تتقرا من
الشاشة. لو خزّنّا فروقات، الإجابة بتبقى «الافتراضي زائد كذا ناقص كذا» — وأول ما يتغيّر
الافتراضي في نسخة جديدة، الصلاحيات بتتحرّك تحت اللي ضبطها من غير ما حد يعرف.

ودور من غير صفوف هنا معناه «ماتقالش عنه حاجة» فبيرجع للافتراضي — مش «مالوش أي صلاحية»،
عشان الترقية اللي بتضيف صلاحيات جديدة توصل للأدوار اللي محدش لمسها.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.models.role import RoleName


class RoleCapability(Base):
    __tablename__ = "role_capability"
    __table_args__ = (
        UniqueConstraint("role", "capability", name="uq_role_capability"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    role: Mapped[RoleName] = mapped_column(Enum(RoleName), nullable=False, index=True)
    capability: Mapped[str] = mapped_column(String(60), nullable=False)
    # مين ضبطها وإمتى — السؤال الأول لما حد يلاقي نفسه بيقدر يعمل حاجة ماكانش بيقدر عليها.
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)
