"""مرفقات المستندات — الصورة اللي بتتعلّق على الورقة أياً كانت.

إذن الصرف اللي عليه توقيع، إيصال الشحن، صورة الشيك، PDF بتاع عرض السعر. الورق ده بيتصوّر
فعلاً وبيتحط في دوسيه، والنظام كان بيشيل السطور بس — فاللي عايز يشوف التوقيع بيقوم من
على الشاشة ويدوّر في درج.

---------------------------------------------------------------------------
**جدول واحد لكل المستندات، مش جدول لكل نوع.**

`inspection_attachment` (الموديل الجنبي ده) اتعمل للمعاينة وحدها. تكراره لكل ورقة معناه
تلتاشر جدول بنفس ستة أعمدة بالظبط، وتلتاشر راوتر، وتلتاشر مرة نفس فحص المسار الأمني —
واللي هيتنسى في واحد فيهم هيبقى ثغرة في واحد بس، وهي أوحش من ثغرة في الكل لأنها
مابتبانش.

فالمفتاح بقى `(doc_type, doc_id)`: النوع نصّ من السجل الموحّد (`lib/stock_docs`) مش
مفتاح خارجي، لأن المفتاح الخارجي لازم يشاور على جدول واحد بعينه — وده أصلاً السبب اللي
خلّى الحل القديم جدول لكل نوع.

**والثمن معروف ومقبول:** القاعدة مش هتمسح المرفق لوحدها لما المستند يتمسح. وده مش خطر
عندنا: المستند المرحّل **مابيتمسحش** — بيتعكس وبيفضل مكانه (اقرا `document_edit_service`).

**والتخزين على القرص مش في القاعدة** — نفس سبب `models/attachment.py`: الصور بتتقرا كاملة
أو مابتتقراش، وحطّها في صفوف بيخلّي كل نسخة احتياطية وكل استعلام يجرّها وراه.

---------------------------------------------------------------------------
**والجدول ده جديد وفاضي** — بيتعمل بـ`create_all` على قاعدة العميل وهي شغّالة، ومابيلمسش
ولا جدول قايم ولا عمود فيه. فالـ`NOT NULL` هنا مالوش تكلفة: مافيش صف موجود ممكن يخالفه،
ومافيش `ALTER` بيتعمل على حاجة فيها داتا. (الأعمدة اللي بتتضاف لجدول **موجود** هي اللي
لازم تتسجّل في `_ADDED_COLUMNS` في `main.py` وتبقى nullable — ومافيش منها هنا.)
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class DocumentAttachment(Base):
    __tablename__ = "document_attachment"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # الاسم الموحّد للورقة — `stock_docs.doc_spec()` هو اللي بيقول إنه مسجّل ولا لأ.
    # النص الحرّ هنا كان هيرجّعنا لنفس مشكلة `source_doc_type`: نوع بأسمين ونص المرفقات
    # مايظهرش. الراوتر بيوحّد الاسم قبل ما يكتب، فاللي بيتخزّن اسم واحد مش اتنين.
    doc_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # **من غير مفتاح خارجي عن قصد** — `doc_id` بيشاور على جدول مختلف حسب `doc_type`،
    # ومافيش مفتاح خارجي في SQL يشاور على أكتر من جدول. اللي بيتأكد إن الرقم حقيقي هو
    # `_resolve` في الراوتر: بيجيب الموديل من القايمة المقبولة ويسأل القاعدة عليه قبل
    # ما يكتب صف، فمافيش مرفق بيتخزّن على مستند مش موجود.
    doc_id: Mapped[int] = mapped_column(BigIntPK, nullable=False)
    # اسم الملف زي ما المستخدم شايفه.
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # المسار النسبي جوّه مجلد الرفع — نسبي عشان نقل المجلد مايكسرش الصفوف.
    stored_path: Mapped[str] = mapped_column(String(400), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # `client_uuid` بتاع المرفق نفسه: الرفعة اللي اتقطعت واتبعتت تاني تتسجّل مرة واحدة.
    client_uuid: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # «وريني مرفقات الورقة دي» هو الاستعلام الوحيد على الجدول ده، وبيتنادى مع كل فتحة
    # مستند — فالفهرس على العمودين مع بعض، مش على كل واحد لوحده.
    __table_args__ = (
        Index("ix_document_attachment_doc", "doc_type", "doc_id"),
    )
