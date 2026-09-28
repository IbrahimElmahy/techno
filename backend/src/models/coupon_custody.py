"""عهدة الكوبونات — دفاتر مرقّمة في إيد المندوب، زي عهدة البضاعة بالظبط.

الشركة بتدّي المندوب «٥٠ فضي من ١٠٠١ لـ١٠٥٠» وهو بيوزّعها على العملاء في الشارع. من غير
العهدة دي النظام مايعرفش الورقة اللي في إيده جت منين: المندوب يقدر يكتب على الفاتورة أي
أرقام، والأرقام دي بترجع بعدين من السباك على إنها «متصرّفة» — وهي عمرها ما خرجت من المكتب.

مستندين:

* `CouponCustody` — المستند نفسه: صرف للمندوب (`out`) أو استرجاع منه (`in`)، بفئة ونطاق.
* `CouponCustodySerial` — **صف لكل ورقة**. النطاق على المستند بيقول اللي اتكتب يومها، والصف
  بيقول الورقة فين النهارده: مع المندوب، ولا اتصرفت لعميل، ولا رجعت المكتب. السؤال اللي
  الفاتورة بتسأله («الرقم ده في عهدة المندوب ده؟») سؤال عن ورقة واحدة، فلازم يبقى ليها صف.

الهوية (الفئة، الرقم) زي الاستلام والصرف بالظبط: «٥ ذهبي» غير «٥ فضي». والرقم بيتخزّن
بصورته الرقمية (`str(int)`) — نفس اللي `_as_int` في الاستلام بيقارن بيه — عشان «1001» على
الفاتورة و«1001» في العهدة يبقوا نفس الورقة من غير تحويل في كل مقارنة.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class CouponCustody(Base):
    """مستند عهدة كوبونات — صرف لمندوب أو استرجاع منه، فئة واحدة ونطاق واحد."""

    __tablename__ = "coupon_custody"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    # `out` = صرف للمندوب، `in` = استرجاع منه. نص مش enum عشان الجدول يتعمل زي ما هو على
    # بوستجرس والـsqlite من غير نوع مخصوص يتساب ورا لو اتغيّر.
    direction: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    rep_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)
    # فئة الدفتر من قائمة `coupon_kind` — بتتكتب بنفس إملا أول مستند للفئة دي، عشان
    # «ذهبى» و«ذهبي» مايبقوش عهدتين.
    coupon_kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    serial_from: Mapped[str] = mapped_column(String(24), nullable=False)
    serial_to: Mapped[str] = mapped_column(String(24), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    doc_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # فرع المندوب — عزل الفروع زي باقي المستندات.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class CouponCustodySerial(Base):
    """ورقة واحدة تحت العهدة، وحالتها النهارده.

    `with_rep` = مع المندوب ولسه ماتصرفتش · `given` = اتصرفت لعميل على فاتورة ·
    `returned` = رجعت المكتب، وتتصرف تاني لنفس المندوب أو لغيره.

    صف واحد للورقة طول عمرها: الصرف التاني بعد الاسترجاع بيعدّل نفس الصف مش بيكتب واحد
    جديد. القيد الفريد هو اللي بيمنع إن نفس الورقة تبقى في عهدة اتنين في نفس الوقت.
    """

    __tablename__ = "coupon_custody_serial"
    __table_args__ = (
        UniqueConstraint("coupon_kind", "serial", name="uq_coupon_custody_kind_serial"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    coupon_kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    serial: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    # المندوب اللي الورقة في عهدته (أو كانت، لو اتصرفت أو رجعت).
    rep_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    # مستند الصرف اللي الورقة طلعت بيه آخر مرة، ومستند الاسترجاع لو رجعت.
    custody_id: Mapped[int] = mapped_column(ForeignKey("coupon_custody.id"), nullable=False,
                                            index=True)
    return_id: Mapped[int | None] = mapped_column(ForeignKey("coupon_custody.id"),
                                                  nullable=True, index=True)
    # الفاتورة (أو مستند الصرف لموزع) اللي الورقة اتصرفت عليه.
    #
    # **من غير مفتاح أجنبي عن قصد.** فيه سكربتات تنضيف بتمسح فواتير على القاعدة مباشرةً،
    # ومفتاح هنا كان هيوقّفها على ورقة مش فاهمة إنها مربوطة بيها. الربط بيتفك من
    # `purge_sale` قبل ما الفاتورة تتمسح من الشاشة، وده الطريق الطبيعي.
    given_invoice_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    given_issue_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
