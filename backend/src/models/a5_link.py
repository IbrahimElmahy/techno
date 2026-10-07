"""ربط ثابت بين صنف a5 وصنفنا — قبل توحيد الأصناف (٢٠٢٦-١٠-٠٧).

المزامنة كانت بتعرف صنف a5 عندنا **بكوده واسمه** (`{prefix}{Item_cod}` أو الاسم). التوحيد
بيغيّر الاسم والكود عندنا، فالمزامنة الجاية مش هتلاقي الصنف وهتعمل نسخة جديدة بالاسم
القديم — والمخزون يتقسم على صنفين.

الجدول ده بيقول «الصنف ده في a5 = الصنف ده عندنا» مرة واحدة، والمزامنة بتسأله الأول:
* **بالكود** — `AzonDt.Item_cod` هو اللي على سطر كل مستند في a5، ومابيتغيّرش لو الاسم اتعدّل هناك.
* **بالاسم** للصنف اللي مالوش كود في a5 بس.

ولما صنفين يتدمجوا عندنا، الربط بتاعهم الاتنين بيتحوّل للصنف الموحّد — فأي مستند جاي من
a5 على أي واحد فيهم بينزل عليه.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class A5ItemLink(Base):
    __tablename__ = "a5_item_link"
    __table_args__ = (
        # الفرع (بادئته: "" أكتوبر، AL- العلياء، FC- السادات) + كود a5 + اسمه. الكود الفاضي
        # بيتخزّن "" مش NULL عشان التفرّد يشتغل على الأصناف اللي من غير كود.
        UniqueConstraint("prefix", "a5_code", "a5_name", name="uq_a5_item_link"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    prefix: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    a5_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    a5_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    # رقم الصنف في a5 (`Items.Item_Id`) — للمراجعة بس؛ السطور مابتحملوش.
    a5_item_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
