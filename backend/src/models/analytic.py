"""التوزيع التحليلي — سطر واحد على أكتر من مركز تكلفة.

`ledger_line.cost_center_id` بيجاوب «السطر ده بتاع أنهي نشاط» لما يكون نشاط واحد.
بس إيجار المخزن بيخدم المعرض والمشروع مع بعض، ومرتب السايق بيتقسّم على خطين —
والوحيد اللي كان بيعرف يكتب ده كان بيكتب سطرين بنص المبلغ، فالمستند بيبقى فيه
سطور مالهاش وجود في الورقة اللي في إيده.

الجدول ده هو `analytic_distribution` بتاع أودو بالظبط، بس كصفوف مش JSON — عشان
السؤال «المركز ده عليه كام» يبقى `JOIN` مش قراءة كل السطور وفكّ JSON لكل واحد.

**القاعدة:** السطر اللي ليه صفوف هنا، الصفوف دي هي الحقيقة، و`cost_center_id`
بيفضل `NULL`. مافيش مركز «رئيسي» بيتكتب جنبهم: اللي بيقرا العمود القديم بيشوف
السطر «غير موزّع» — وده صادق، السطر فعلاً مش على مركز واحد — بدل ما يشوف مركز
واخد المبلغ كله وهو واخد تلته.

النسبة والمبلغ الاتنين متخزّنين: النسبة هي اللي المستخدم كتبها، والمبلغ هو اللي
التقارير بتجمعه. لو حسبناه وقت القراءة، تلات مراكز بـ٣٣٫٣٣٪ مجموعهم مش هيساوي
السطر، والفرق ده بيظهر في الميزانية كقرش ضايع كل مرة حد يفتح التقرير.
"""
from __future__ import annotations

from sqlalchemy import ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY

#: دقة النسبة — ٣٣٫٣٣٣٣٪ تنفع، وده بيكفّي لأي تقسيمة بإيد.
PERCENT = Numeric(9, 4)


class LedgerLineDistribution(Base):
    """حصة مركز تكلفة من سطر قيد."""

    __tablename__ = "ledger_line_distribution"
    __table_args__ = (
        UniqueConstraint("line_id", "cost_center_id", name="uq_lld_line_center"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    line_id: Mapped[int] = mapped_column(
        ForeignKey("ledger_line.id", ondelete="CASCADE"), nullable=False, index=True
    )
    cost_center_id: Mapped[int] = mapped_column(
        ForeignKey("cost_center.id"), nullable=False, index=True
    )
    percent: Mapped[object] = mapped_column(PERCENT, nullable=False)
    #: حصة المركز من مبلغ السطر — محسوبة وقت الكتابة، والباقي بيروح لآخر حصة.
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
