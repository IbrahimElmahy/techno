"""Stock as an append-only movement model (T013–T014).

On-hand per (item × location) is DERIVED from immutable movements (no stored balance, SC-002).
Movements are quantity-only (no monetary value — Q4 boundary, FR-008a) and reversible (FR-007/025).
`StockLocator` is a lock anchor for the No-Negative-Stock write check (research R3).
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK
from src.core.money import QTY


class LocationKind(str, enum.Enum):
    warehouse = "warehouse"
    custody = "custody"


class StockDirection(str, enum.Enum):
    in_ = "in"
    out = "out"


class StockDoc:
    """أنواع المستندات اللي بتحرّك مخزون — الاسم الواحد اللي الكل بيكتب ويقرا بيه.

    **كانوا اسمين لكل نوع.** الخدمات كانت بتكتب `"sale"` و`"purchase"` و`"sale_return"`،
    ونقل a5 كتب `"sales_invoice"` و`"purchase_invoice"` و`"sales_return"`. النتيجة في
    قاعدة العميل:

        sales_invoice    44,798 حركة  ·  sale           32
        purchase_invoice  3,824 حركة  ·  purchase        0
        sales_return      1,901 حركة  ·  sale_return     2

    والكود اللي بيشيل حركات المستند وقت التعديل أو الحذف (`document_edit_service`) كان
    بيدوّر على الاسم القصير بس. يعني **تعديل أي فاتورة منقولة من a5** — وهي كل الفواتير
    تقريباً — كان بيسيب حركتها القديمة مكانها ويكتب واحدة جديدة فوقها، فالصنف بينخصم
    مرتين والرصيد بيقلّ من غير سبب ظاهر.

    اتقاس على نسخة من الإنتاج بفاتورة AL-S67575: بعد `purge_sale` الحركة فضلت مكانها
    والرصيد فضل ٣٥ بدل ما يرجع ٣٦.

    الأسماء المختارة هي أسماء الجداول، لأنها اللي الداتا كلها عليها ولأن المستند
    والحركة بيبقوا مسمّيين نفس الاسم.
    """

    SALE = "sales_invoice"
    SALE_RETURN = "sales_return"
    PURCHASE = "purchase_invoice"
    PURCHASE_RETURN = "purchase_return"
    TRANSFER = "stock_transfer"
    PERMIT = "stock_permit"
    # الرصيد الافتتاحي المنقول من a5، والتصحيح اللي اتكتب بعده لسد العجز.
    OPENING = "a5_opening"
    OPENING_FIX = "a5_opening_fix"


class StockMovement(Base):
    """Immutable quantity change for an (item × location). On-hand = Σ(in − out)."""

    __tablename__ = "stock_movement"

    # (037) الفرع اللي المستند ده بتاعه — عزل بيانات الفروع.
    #
    # بيتاخد من مخزن السطر لو المستند بيحرّك بضاعة، وإلا من فرع اللي كتبه. NULL = مستند
    # اتكتب قبل العزل، وبيتشاف من كل الفروع لحد ما يتعبّى.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True,
                                                  index=True)
    __table_args__ = (CheckConstraint("quantity > 0", name="ck_stock_movement_qty_positive"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[StockDirection] = mapped_column(Enum(StockDirection), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # quantity-only, no money
    source_doc_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    source_doc_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reverses_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    # **تاريخ الحركة — تاريخ ورقتها، مش وقت كتابة الصف.**
    #
    # `created_at` كان هو الاتنين، والفرق بينهم مش نظري: النقل من a5 كتب كل حركة
    # الشركة في يوم واحد، فالجرد بأي تاريخ قبل يوم النقل كان بيرجع مخزن فاضي، وكارت
    # الصنف بيقول إن بيع يناير حصل في سبتمبر.
    #
    # بيتملي في `post_movement` من `stock_docs.date_of` — مكان واحد بيعرف تاريخ كل
    # نوع مستند. و`NULL` بتفضل للقديم لغاية ما `backfill_movement_dates` تعدّي،
    # والقراءة بتعمل `COALESCE(movement_date, created_at)` فمافيش لحظة بيغيب فيها رقم.
    movement_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)


class StockLocator(Base):
    """Lock anchor per (item × location) for No-Negative-Stock serialization. Stores no quantity."""

    __tablename__ = "stock_locator"
    __table_args__ = (
        UniqueConstraint("item_id", "location_kind", "location_id", name="uq_stock_locator"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)


class CostingMethod(str, enum.Enum):
    """How a unit of stock is valued (نوع التكلفة، B5).

    `average` is the shipped default and what every existing cost on a document was computed
    with — changing the setting must never rewrite those, only how new valuations are derived.
    FIFO is deliberately absent: it needs per-receipt cost layers, which is a data change, not a
    setting.
    """

    average = "average"              # المتوسط المرجح
    last_purchase = "last_purchase"  # آخر سعر شراء


class StockSetting(Base):
    """Singleton stock settings — currently just the costing method."""

    __tablename__ = "stock_setting"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    costing_method: Mapped[CostingMethod] = mapped_column(
        Enum(CostingMethod), default=CostingMethod.average, nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class StockImmutableError(Exception):
    """Raised when code attempts to mutate or delete a posted stock movement."""


def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise StockImmutableError(
        "stock_movement is immutable; post a reversal movement instead (FR-007/025)."
    )


# ORM-level immutability guard (DB-agnostic; MySQL trigger enforces the same in production).
# اتشال — نفس سبب قيد الدفتر: تعديل المستند بيشيل حركته القديمة ويكتب واحدة جديدة.
_ = _block_mutation
