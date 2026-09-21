"""Manufacturing (T027, extended by 012-manufacturing-bom).

Two layers coexist:
- `ManufacturingOp` (consume/produce) — the original decoupled primitive, kept as a *manual*
  adjustment for anything outside a recipe (FR-013–016). No linkage, no money.
- `ManufacturingOrder` (+ consumptions) — a linked, recipe-driven document: it consumes the
  product's BOM components and produces the product in one reversible transaction, storing the
  derived cost. Stock movements remain quantity-only; the order posts no ledger entry.
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, QTY
from src.models.stock import LocationKind


class ManufactureOpType(str, enum.Enum):
    consume = "consume"
    produce = "produce"


class ManufacturingOp(Base):
    __tablename__ = "manufacturing_op"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    op_type: Mapped[ManufactureOpType] = mapped_column(Enum(ManufactureOpType), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # Nullable so the doc can be inserted before its movement exists (Postgres FK enforcement).
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)
    # Set when this op is itself a reversal of another op (reverse-once at op level).
    reverses_op_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturing_op.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class ManufacturingOrder(Base):
    """A recipe-driven production document: consume BOM components + produce the product.

    Posts one product `production_in` movement and one `consumption_out` movement per component
    (all tagged source_doc_type="manufacturing_order"). Reversible once as a whole via a mirror
    order that swaps every movement's direction. Cost is derived (Σ component qty × raw
    purchase_price) and stored — no ledger entry (Q4 money boundary preserved).
    """

    __tablename__ = "manufacturing_order"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    bom_id: Mapped[int | None] = mapped_column(ForeignKey("bom.id"), nullable=True)
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # base units of product produced
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False)   # total_cost / quantity
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # material_cost + resource_cost
    # Cost breakdown (014): materials (Σ component line cost) vs resources (labor/machine/overhead).
    material_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    resource_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    # The product's in-movement id (for reverse). Component out-movements are on the consumption rows.
    # Nullable so the doc can be inserted before its movement exists (Postgres FK enforcement).
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)
    # Set when this order is itself the reversal of another (reverse-once at order level).
    reverses_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturing_order.id"), unique=True, nullable=True
    )
    # --- Document fields, read off their انتاج حسب النسب header -------------------------------
    # The day production happened, which is not always the day it was typed: a workshop closes a
    # batch in the evening and the office enters it next morning. Dating the document by entry
    # would put the output in the wrong day on every production report.
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True, index=True)
    # «امر تشغيل» — the shop-floor work order this production belongs to. Free text on purpose: it
    # is somebody else's numbering (a paper docket, a customer order), and validating it against a
    # table we own would reject the very references it exists to record.
    work_order_ref: Mapped[str | None] = mapped_column(String(60), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    consumptions: Mapped[list[ManufacturingOrderConsumption]] = relationship(
        cascade="all, save-update", back_populates="order"
    )
    resources: Mapped[list[ManufacturingOrderResource]] = relationship(
        cascade="all, save-update", back_populates="order"
    )


class ManufacturingOrderConsumption(Base):
    """One raw-material line consumed by a manufacturing order (snapshot of qty + cost)."""

    __tablename__ = "manufacturing_order_consumption"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_order.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # base units consumed
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # raw purchase_price snapshot
    line_cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # quantity × unit_cost
    # Portion of the consumed quantity that was scrap/waste (014); feeds the wastage report.
    waste_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    # Warehouse the material was actually pulled from (014 routing); mirrors the stock movement.
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    # Nullable so the doc can be inserted before its movement exists (Postgres FK enforcement).
    stock_movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movement.id"), nullable=True)

    order: Mapped[ManufacturingOrder] = relationship(back_populates="consumptions")


class ManufacturingOrderResource(Base):
    """A non-material input actually consumed by an order (014): labor/machine/overhead.

    Seeded from the recipe's `BomResource` (scaled to the produced quantity) and editable per order.
    Costed as `quantity × rate`; contributes to `resource_cost` — no stock movement, no ledger entry.
    """

    __tablename__ = "manufacturing_order_resource"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("manufacturing_order.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # ResourceKind value
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    rate: Mapped[object] = mapped_column(MONEY, nullable=False)
    cost: Mapped[object] = mapped_column(MONEY, nullable=False)  # quantity × rate

    order: Mapped[ManufacturingOrder] = relationship(back_populates="resources")


# ---------------------------------------------------------------------------
# أمر تشغيل — المستند اللي بيطلّع كذا منتج من كذا خامة (032)
# ---------------------------------------------------------------------------
class ProductionState(str, enum.Enum):
    """حالة أمر التشغيل. **الحركة المخزنية مابتحصلش إلا في `done`.**

    الأمر بيتكتب على مراحل: الورشة بتحجز الشغل الصبح (`draft`)، المشرف بيراجع النسب
    (`confirmed`)، الشغل بيبدأ على الأرض (`in_progress`)، وبعد ما يخلص بيتنفّذ (`done`)
    — وساعتها بس الخامات بتتصرف والتام بيدخل. من غير الفصل ده، أي ورقة بتتكتب بالنهار
    بتخصم مخزون مااتصرفش، واللي بيعدّل سطر بعد نص ساعة بيبقى بيعدّل حركة اتكتبت خلاص.

    **و`in_progress` مش تزويق.** الفرق بين «الورقة اتراجعت» و«الشغل ماشي دلوقتي» هو
    السؤال اللي بيتسأل في الورشة عشر مرات في اليوم. وهي كمان المرحلة اللي الكميات
    الفعلية والفاقد بيتكتبوا فيها: المخطّط اتحدّد وقت التأكيد، واللي بيطلع بيتسجّل وهو
    بيحصل — مش بعد ما الورقة تتقفل وتتحوّل لذاكرة.

    **ومافيش حركة مخزون فيها.** الشغل اللي ماخلصش مايخصمش خامة: لو اتعدّل بعدها —
    وده بالظبط سبب وجودها — الخصم يبقى اتكتب على كمية اتغيّرت.
    """

    draft = "draft"              # مسودة — مافيش أي أثر على المخزون
    confirmed = "confirmed"      # مؤكد — اتراجع، ولسه ماترحّلش
    in_progress = "in_progress"  # شغّال — على الأرض، والكميات بتتسجّل وهي بتحصل
    done = "done"                # منفّذ — الحركات اترحّلت والتكلفة اتجمّدت
    reversed = "reversed"        # اتعكس — الحركات المرآة اتكتبت والسطور فضلت في السجل


class ProductionOrder(Base):
    """أمر تشغيل: ورقة واحدة فيها سطور منتجات وسطور خامات، بترحّل حركة مخزون للاتنين.

    **ليه جدول جديد جنب `ManufacturingOrder` مش تعديل فيه.** `ManufacturingOrder` منتج
    واحد لكل أمر — العمود `product_id` على الترويسة نفسها — وأمر المصنع بيطلّع أربعة.
    وتلات فروع شغّالة على الأمر القديم دلوقتي، فتوسيعه معناه إن كل شاشة وتقرير وسكربت
    بيقرا `order.product_id` يتغيّر في نفس اليوم. الجديد بيتبني جنبه والقديم بيفضل شغّال
    زي ما هو لحد ما ينتقل بقرار مكتوب.

    **مافيش قيد دفتر.** قيد الإنتاج عند a5 طلع «مخزن الجودة مدين ٥٨ / مخزن الجودة دائن
    ٥٨» — يعني نقل قيمة بين مخازن، وهي نفس المعلومة اللي `stock_movement` +
    `costing_service` شايلينها عندنا. قيد فوقها بيعدّ نفس الحاجة مرتين.

    **ومافيش توزيع تكلفة.** وصفة a5 (`Nsb_entag`) منتج واحد وخاماته، والأمر اللي بيطلّع
    أربع منتجات هو أربع وصفات اتنفّذت في ورقة واحدة — كل منتج بياخد تكلفة **خاماته هو**.
    عشان كده «قيمة منتج = قيمة خام» في شاشتهم: مجموع بيساوي مجموع، مش قسمة بنسب. فكل
    سطر خامة هنا **منسوب لسطر منتج**، وتكلفة المنتج = مجموع خاماته + مصاريفه.
    """

    __tablename__ = "production_order"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    # اليوم اللي الإنتاج حصل فيه، مش يوم كتابته — الورشة بتقفل الدفعة بالليل والمكتب
    # بيدخّلها الصبح، والتأريخ بوقت الكتابة بيحط الإنتاج في يوم غلط في كل تقرير.
    production_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True, index=True)
    # **رقم الورقة اللي في إيده** — رقمنا بيتولّد بالتسلسل (`WO-000050`) والورقة اللي
    # جاية من الورشة عليها رقم تاني («أمر شغل ٣٥٣٧»)، واللي بيدوّر بعد شهر بيدوّر بيه.
    external_document_number: Mapped[str | None] = mapped_column(
        String(40), nullable=True, index=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)  # البيان
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    state: Mapped[ProductionState] = mapped_column(
        Enum(ProductionState), nullable=False, default=ProductionState.draft, index=True)
    # «مراجعة نسب الانتاج» — علامة مراجعة بشرية، مالهاش أثر على حركة ولا تكلفة.
    reviewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # مجاميع محسوبة ومخزّنة عشان القايمة ماتفتحش سطور كل أمر عشان تعرض عمود.
    material_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    expense_amount: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    planned_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    product_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    material_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    # الأمر ده اتلمّ من حركة منقولة (`"a5"`) مش اتكتب عندنا. تصدير a5 مافيهوش عمود
    # تكلفة أصلاً، فتكلفته صفر — والخانة دي هي اللي بتخلّي الشاشة تقول «منقول بغير
    # تكلفة» بدل ما الصفر يتقري على إنه إنتاج مجاني.
    imported_from: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    reverses_id: Mapped[int | None] = mapped_column(
        ForeignKey("production_order.id"), unique=True, nullable=True
    )
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    products: Mapped[list[ProductionOrderProduct]] = relationship(
        cascade="all, delete-orphan", back_populates="order")
    materials: Mapped[list[ProductionOrderMaterial]] = relationship(
        cascade="all, delete-orphan", back_populates="order")


class ProductionOrderProduct(Base):
    """سطر إنتاج تام: صنف × مخزن × كمية، وتكلفته = خاماته + مصاريفه."""

    __tablename__ = "production_order_product"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("production_order.id"), nullable=False,
                                          index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    # المخزن على **السطر** مش على الورقة — نفس اللي (030) عمله في الفواتير: الأمر الواحد
    # ممكن يودّي التام في مخزن والنص مصنّع في مخزن تاني.
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    # **المخطّط واللي حصل جنب بعض.** `planned_quantity` هي الكمية اللي الأمر اتفتح
    # عليها، و`quantity` هي اللي طلعت فعلاً — والفرق بينهم هو رقم الإنتاج اللي المصنع
    # بيسأل عليه. رقم واحد مكانهم معناه إن السؤال ده مالوش إجابة بعد ما الورقة تتقفل.
    planned_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)  # بالوحدة الأساسية
    # الوحدة اللي اتكتبت بيها، زي سطر الفاتورة والوصفة بالظبط (008).
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(QTY, nullable=False, default=1)
    # الوصفة اللي السطر اتفتح منها — `NULL` يعني الخامات اتكتبت بالإيد (إنتاج حر).
    #
    # **والوصفة قالب مش قيد.** الكميات المخطّطة بتتنسخ على السطور وقت الإنشاء، وبعدها
    # الوصفة تتعدّل براحتها والأمر المنفّذ بيفضل شايل اللي اتنفّذ بيه. من غير النسخة
    # دي، تعديل وصفة النهارده بيغيّر تكلفة إنتاج الشهر اللي فات.
    bom_id: Mapped[int | None] = mapped_column(ForeignKey("bom.id"), nullable=True)
    material_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    # مصاريف السطر — خانة واحدة. a5 عنده أربعة (أجور/كهربا/مياه/وقود) وكلهم صفر في
    # الـ٤١٠ وصفة، فأربع خانات مالهاش داتا بتزوّد شاشة مابتقولش حاجة.
    expense_amount: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    total_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True)

    order: Mapped[ProductionOrder] = relationship(back_populates="products")


class ProductionOrderMaterial(Base):
    """سطر خامة مصروفة، **منسوب لسطر منتج** — هو ده اللي بيخلي التكلفة محسوبة مش مخمّنة."""

    __tablename__ = "production_order_material"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("production_order.id"), nullable=False,
                                          index=True)
    # `NULL` للأوامر المنقولة وحدها: تصدير a5 بيدّي سطور صرف وسطور إنتاج في نفس أمر
    # الشغل من غير ما يقول أنهي خامة راحت لأنهي منتج، ونسبة بالتخمين بتحط رقم مالوش أصل
    # في تكلفة كل منتج. الأمر اللي بيتكتب عندنا لازم ينسب كل خامة (الخدمة بترفض غير كده).
    product_line_id: Mapped[int | None] = mapped_column(
        ForeignKey("production_order_product.id"), nullable=True, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False, index=True)
    warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("warehouse.id"), nullable=True)
    # **«المفروض» و«اللي حصل».** `planned_quantity` = كمية الوصفة × الكمية المطلوبة،
    # متنسخة وقت فتح الأمر. `quantity` = اللي اتصرف فعلاً. والفرق بينهم هو **الفاقد
    # أو الزيادة** — وده أنفع رقم في المصنع كله، ومافيش مكان تاني بيقوله: الحركة بتقول
    # اتصرف كام، والوصفة بتقول المفروض كام، ومحدش بيحطهم على نفس السطر.
    planned_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(QTY, nullable=False, default=1)
    # «متوسط» اللي في شاشتهم = متوسط التكلفة عندنا (`costing_service.average_cost`)،
    # متقفّل على السطر وقت الترحيل زي تكلفة البضاعة المباعة في (030): الأمر اللي اتقفل
    # الشهر اللي فات مايتغيّرش سعره لما يتشترى خامة بسعر جديد النهارده.
    unit_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    line_cost: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    waste_quantity: Mapped[object] = mapped_column(QTY, nullable=False, default=0)
    stock_movement_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_movement.id"), nullable=True)

    order: Mapped[ProductionOrder] = relationship(back_populates="materials")
