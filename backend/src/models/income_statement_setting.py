"""إعدادات «قائمة الدخل» — صف لكل فرع (وصف NULL للشركة كلها).

القائمة بتتبني من قواعد مش من أرقام مكتوبة: «بولي» يعني أنهي فئات أصناف، «الفروع» يعني
أنهي عملاء، حساب «سولار السياره أ» يدخل تحت أنهي بند، ونسب البونص ومعاملات الكوبونات.
دي كلها اختيارات العميل — ورقته الإكسل هي اللي بتقولها — فبتتخزّن هنا وتتعدّل من
تبويب الإعدادات في نفس الشاشة، مش في الكود.

**JSON مش أعمدة عن قصد.** القواعد قوايم جوّه قوايم (فئة ⇐ عملاء وأنواع وفئات أصناف،
بند ⇐ حسابات وكلمات)، والقراءة دايماً «هات إعدادات الفرع كلها» — مافيش استعلام بيسأل
«مين الفرع اللي نسبة بونص البولي عنده ١٥٪». تفصيلها جداول كان هيبقى ست جداول بتتقري سوا.

وفيه كمان مدخلات الفترة اللي العميل بيكتبها بإيده كل ربع (جرد أول وآخر المدة الفعلي،
كوبونات البيع الفعلي، مصروفات «زيادة») — تحت مفتاح الفترة `من|إلى`، عشان رقم ربع
مايسرّبش على ربع تاني.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from src.core.db import Base, BigIntPK


class IncomeStatementSetting(Base):
    __tablename__ = "income_statement_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # NULL = الإعداد الافتراضي للشركة؛ الفرع اللي مالوش صف بيقرا منه.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  unique=True, index=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
