"""التسوية (Reconciliation) — المرحلة ٣ من إعادة الهيكلة على موديل أودو.

الدفعة والفاتورة قبل كده كانوا حركتين على نفس الحساب وبس: رصيد العميل بيطلع صح،
بس مافيش حاجة بتقول «الخمسين دول دفعوا فاتورة رقم كام». فالسؤال اللي بيتسأل كل يوم
— «الفاتورة دي اتدفعت؟ وفاضل عليه إيه من الشهر اللي فات؟» — ماكانش ليه جواب غير إن
حد يقعد يطرح بإيده.

أودو بيربطهم بجدولين، وده نفسهم:

* `partial_reconcile` — مطابقة بين سطر مدين وسطر دائن بمبلغ. «جزئية» لأن الدفعة
  ممكن تغطي نص الفاتورة، والفاتورة ممكن تتغطى من تلات دفعات، فالربط بيبقى شبكة
  مش واحد لواحد.
* `full_reconcile` — لما كل المبالغ تتغطى بالظبط، المجموعة بتاخد **رقم مطابقة**
  (`A00001`) وبيتكتب على كل سطورها. الرقم ده هو اللي بيخلّي «الفاتورة دي اتقفلت
  بأنهي دفعات» سؤال ليه إجابة بسطر واحد.

والمتبقّي (`ledger_line.amount_residual`) هو اللي بيمشي: بيبدأ بقيمة السطر بإشارته
(مدين موجب، دائن سالب) وبينقص مع كل مطابقة لحد الصفر. تقرير الأعمار بيتحسب منه
وبيرتّب بتاريخ الاستحقاق — بدل ما يفترض إن الأقدم اتدفع الأول.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import MONEY

#: عرض رقم المطابقة — `A00001`. نفس شكل أودو عشان اللي شايف النظامين مايتلغبطش.
NUMBER_WIDTH = 5
NUMBER_PREFIX = "A"


def format_number(seq: int) -> str:
    return f"{NUMBER_PREFIX}{seq:0{NUMBER_WIDTH}d}"


class FullReconcile(Base):
    """مجموعة سطور اتقفلت على بعضها بالكامل — ورقمها.

    الرقم بيتولد من `id` مش من عدّاد لوحده: العدّاد كان هيحتاج قفل صف وقت كل
    مطابقة، والـ`id` أصلاً متسلسل وفريد. الفجوة في الترقيم (لو مطابقة اتفكّت)
    أرخص من رقمين لمجموعتين.
    """

    __tablename__ = "full_reconcile"
    __table_args__ = (UniqueConstraint("number", name="uq_full_reconcile_number"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    number: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)


class PartialReconcile(Base):
    """ربط بين سطر مدين وسطر دائن بمبلغ — والمبلغ ده هو اللي بينقص من متبقّي الاتنين."""

    __tablename__ = "partial_reconcile"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    debit_line_id: Mapped[int] = mapped_column(
        ForeignKey("ledger_line.id"), nullable=False, index=True
    )
    credit_line_id: Mapped[int] = mapped_column(
        ForeignKey("ledger_line.id"), nullable=False, index=True
    )
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    # المجموعة اللي الربط ده بقى جزء منها لما كل المبالغ اتقفلت. NULL = لسه فيه متبقّي.
    full_reconcile_id: Mapped[int | None] = mapped_column(
        ForeignKey("full_reconcile.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
