"""مسودّة مستند — اللي اتكتب ولسه ما اترحّلش.

    «لو خرجت وأنا شغال على فاتورة عايزها تبقى مسودّة»

---------------------------------------------------------------------------
**وليه جدول مستقل مش عمود `status` على الفاتورة.**

الشكل اللي في أودو مسودّة = صف في نفس جدول الفاتورة بحالة `draft`. وهو صح عندهم لأن
النظام كله اتبنى وهو عارفها. عندنا الفاتورة المرحّلة هي **الوحيدة** اللي موجودة، فكل
استعلام بيجمع مبيعات بيقرا `sales_invoice` على طول: الداشبورد، تقارير المبيعات وتقارير
المناديب، كشف حساب العميل، الأرباح، والمخزون المشتق من حركاتها. إضافة حالة معناها
مراجعة كل واحد فيهم وإضافة شرط — **واستعلام واحد يتنسي معناه مسودّة اتحسبت إيراد**،
والرقم ده بيروح للعميل في كشف حساب.

الجدول المستقل بيدّي نفس السلوك بالظبط (تسيبها، ترجعلها، تأكّدها فتبقى فاتورة) وبيخلّي
الاستحالة دي **بنيوية**: المسودّة مش في `sales_invoice` أصلاً، فمافيش استعلام يقدر
يشوفها حتى لو حد نسي شرط.

**والمحتوى JSON عن قصد.** المسودّة مش مستند — هي **الشاشة وهي نصّها مكتوب**: سطر من غير
صنف، كمية فاضية، عميل لسه ما اتختارش. أي محاولة نخزّنها في أعمدة بتفرض عليها صحّة مستند،
وساعتها اللي بيكتب مايقدرش يسيبها في نصّها — وده بالظبط اللي المسودّة موجودة عشانه.
والتأكيد بيبعت نفس الحمولة للـAPI العادي، فالتحقق بيحصل مرة واحدة وفي مكانه.

**ومرئية للمكتب، مش محبوسة في المتصفح.** التخزين المحلي كان أسهل، بس المسودّة ساعتها
بتضيع مع مسح الكاش وماتبانش من جهاز تاني — واللي سايب فاتورة نص عشان يسأل حد، بيرجع
يلاقيها راحت.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class DocumentDraft(Base):
    __tablename__ = "document_draft"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # نوع المستند اللي المسودّة بتاعته: `sale`، `purchase`… الشاشة بتسأل بنوعها.
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    # **بتاعة اللي كتبها.** مسودّة نص مكتوبة مش معلومة عامة: حد تاني يفتحها ويأكّدها
    # يبقى رحّل مستند مش بتاعه وناقص. المكتب بيشوف بتوعه، والمدير بيشوف كل شيء من كشف
    # المسودّات لو احتاج.
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    # سطر واحد يقول المسودّة دي بتاعة مين وبكام — عشان الكشف يبان من غير ما يفك الـJSON.
    title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # حمولة الشاشة زي ما هي. **مش بيتقرا في السيرفر** — بيتخزّن وبيترجع.
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
