"""إعدادات المحاسبة — صف واحد للشركة كلها (المرحلة ٤).

أودو بيحط تاريخين قفل على الشركة، والاتنين بيمنعوا أي حركة في الدفتر بتاريخ أقدم
منهم — مش المستند اللي بيتكتب النهارده، ده اللي بيتكتب **بتاريخ** جوّه الفترة
المقفولة:

* `fiscalyear_lock_date` — قفل السنة. بيقفل على **الكل** من غير استثناء، حتى الأدمن.
  ده بيتحط لما الميزانية تتقدّم وتخلص، وبعده مافيش حاجة بتتغيّر في السنة دي.
* `period_lock_date` — قفل الفترة. بيقفل على اللي مش محاسب: المبيعات والمخازن
  مايقدروش يكتبوا بتاريخ قديم، والمحاسب لسه بيقدر يظبط.

**الخانتين بيبدأوا فاضيين وبيفضلوا كده لحد ما الأدمن يحطهم.** ده مقصود: الإقفال
اتشال قبل كده بطلب العميل عشان الفاتورة اللي اتأخرت تتكتب بتاريخها الحقيقي، فرجوعه
لازم يبقى قرار مكتوب بإيد مش سلوك بيشتغل لوحده يوم التحديث.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class AccountingSetting(Base):
    """صف واحد بس. `lock_date_service` بيعمله لو مش موجود."""

    __tablename__ = "accounting_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    fiscalyear_lock_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_lock_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # مهلة السداد بالأيام — الفاتورة اللي مالهاش تاريخ استحقاق مكتوب بتستحق بعد المدة
    # دي من تاريخها.
    #
    # **بتبدأ صفر عن قصد.** صفر معناه «مستحقة يوم ما اتكتبت»، وهو الصح لبيع نقدي.
    # لو حطينا ٣٠ من عندنا كنا هنقول على ٢٬٦٥٣٬٥٣٩ جنيه «مش متأخرة» من غير ما حد
    # يقرر ده — والرقم ده بيتبني عليه اللي بيتكلّم مع التاجر. الرقم قرار العميل.
    payment_terms_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0,
                                                    server_default="0")
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=True
    )
    updated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id"), nullable=True
    )
