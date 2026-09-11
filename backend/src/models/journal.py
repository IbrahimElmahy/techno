"""دفاتر اليومية (Journals) — المرحلة ١ من إعادة الهيكلة على موديل أودو.

القيد قبل كده كان بيتعرّف بنص حر في `ledger_entry.entry_type` ("sale"، "receipt"، ...):
٢٣ قيمة مختلفة اتولدت من ١٢ موديول، مافيش حاجة بتضمن إنها فضلت متسقة، ومافيش طريقة
تقول «وريني دفتر المبيعات» غير إنك تعرف الأسماء الـ٢٣ بالحفظ.

الدفتر بيدّي القيد بيتَه: كل قيد بينتمي لدفتر واحد، والدفتر بيدّيه رقمه المتسلسل.
`entry_type` باقي زي ما هو — هو لسه بيقول «القيد ده جاي من إيه بالظبط» وفيه كود
بيعتمد عليه؛ الدفتر بيقول «القيد ده يتعرض فين ويتّرقّم إزاي».

الدفتر على مستوى الشركة مش الفرع — زي أودو بالظبط. الفرع باقي على القيد نفسه
(`ledger_entry.branch_id`)، فدفتر المبيعات واحد والترقيم متصل، والتصفية بالفرع
شغّالة زي ما هي. دفتر لكل فرع كان معناه ٩ دفاتر × عدد الفروع وترقيمين للمبيعات.
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class JournalKind(str, enum.Enum):
    """نوع الدفتر — نفس تقسيمة أودو، وهي اللي بتحدد الحساب المقابل الافتراضي بعدين."""

    sale = "sale"
    purchase = "purchase"
    cash = "cash"
    bank = "bank"
    general = "general"


JOURNAL_KIND_LABEL: dict[str, str] = {
    "sale": "مبيعات",
    "purchase": "مشتريات",
    "cash": "نقدية",
    "bank": "بنك",
    "general": "عام",
}


class Journal(Base):
    """دفتر يومية — بيت القيد ومصدر رقمه."""

    __tablename__ = "journal"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # الكود هو بادئة الترقيم كمان (`INV/2026/00001`)، فمحدود بحروف قصيرة لاتينية عشان
    # الرقم يفضل مقروء ويتكتب في خانة بحث من غير لخبطة اتجاه في واجهة عربية RTL.
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=JournalKind.general.value)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    # دفتر النظام مايتحذفش ومايتغيّرش كوده: فيه كود بيوجّه قيود عليه بالكود ده.
    is_system: Mapped[bool] = mapped_column(default=False, nullable=False)
    # ترتيب العرض في القوايم — الافتتاحي الأول والمتنوعة في الآخر.
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class JournalSequence(Base):
    """آخر رقم اتصرف في دفتر معيّن في سنة معيّنة.

    جدول لوحده مش `MAX(number)+1`: تحويل «INV/2026/00042» لرقم وزيادته بيكسر أول ما
    حد يغيّر شكل الترقيم، و`MAX` على عمود نصّي بيرتّب أبجدياً فـ«00009» بتطلع أكبر من
    «00010». والصف ده بيتقفل بـ`FOR UPDATE` وقت الترحيل، فمستحيل قيدين ياخدوا نفس الرقم.

    السنة بتتاخد من تاريخ القيد (`entry_date`) مش من النهارده: الفاتورة اللي اتأخرت
    وبتتسجّل في يناير بتاريخ ديسمبر بتاخد رقم ديسمبر.
    """

    __tablename__ = "journal_sequence"
    __table_args__ = (
        UniqueConstraint("journal_id", "year", name="uq_journal_sequence_journal_year"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    journal_id: Mapped[int] = mapped_column(
        ForeignKey("journal.id"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    last_number: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
