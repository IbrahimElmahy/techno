"""أوامر التشغيل (032) — الورقة اللي بتطلّع كذا منتج من كذا خامة.

الشرح الكامل لليه المستند ده موجود **جنب** `ManufacturingOrder` مش بداله: في
`models/manufacturing.ProductionOrder`. المهم هنا خمس قواعد الحساب كله ماشي عليها:

* **كل خامة منسوبة لمنتج.** تكلفة سطر المنتج = مجموع خاماته + مصاريفه. مافيش توزيع
  بنسب ولا باقي قرش بيتحط على أكبر سطر — لأن وصفة a5 نفسها منتج واحد وخاماته، والأمر
  اللي بيطلّع أربعة هو أربع وصفات اتنفّذت في ورقة واحدة.

* **«المفروض» و«اللي حصل» على نفس السطر.** كل سطر شايل `planned_quantity` (من الوصفة
  × الكمية المطلوبة، متنسخة وقت الفتح) و`quantity` (اللي اتصرف فعلاً). الفرق بينهم هو
  الفاقد أو الزيادة، وهو أنفع رقم في المصنع — ومافيش مكان تاني بيقوله.

* **الحركة مابتحصلش إلا عند التنفيذ.** مسودة ← مؤكد ← منفّذ. المسودة تتعدّل براحتها
  وماحدش يخصم مخزون على ورقة لسه بتتكتب.

* **التكلفة بتتجمّد وقت التنفيذ.** `costing_service.average_cost` بيتقرا مرة واحدة
  وبيتخزّن على السطر — نفس اللي (030) عمله في تكلفة البضاعة المباعة، عشان ربح الماضي
  مايتحركش لما تتشترى خامة بسعر جديد النهارده.

* **مافيش قيد دفتر.** حركة مخزون بس. قيد الإنتاج عند a5 بيدين المخزن ويدائنه بنفس
  الرقم — يعني نقل قيمة بين مخازن، وهي نفس المعلومة اللي `stock_movement` +
  `costing_service` شايلينها. قيد فوقها بيعدّ نفس الحاجة مرتين.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.lib import production
from src.models.bom import Bom
from src.models.catalog import Item
from src.models.manufacturing import (
    ProductionOrder,
    ProductionOrderMaterial,
    ProductionOrderProduct,
    ProductionState,
)
from src.models.stock import LocationKind, StockDirection
from src.models.warehouse import Warehouse
from src.services import audit_service, costing_service, numbering, stock_service, uom_service

#: اسم المستند في `stock_movement.source_doc_type` — مسجّل في `lib/stock_docs`.
DOC_TYPE = "production_order"


class ProductionOrderError(Exception):
    pass


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, ProductionOrder, "WO")


def _factor(db: Session, item: Item, unit: str | None) -> Decimal:
    """معامل الوحدة المكتوبة، أو ١ لو مافيش وحدة — نفس مسار (008) اللي الوصفة ماشية عليه."""
    if not unit:
        return Decimal(1)
    try:
        return Decimal(uom_service.resolve_factor(db, item, unit))
    except Exception as exc:
        raise ProductionOrderError(f"وحدة «{unit}» غير معرّفة للصنف «{item.name}».") from exc


def _warehouse(db: Session, item: Item, given: int | None) -> int:
    """مخزن السطر: اللي اتكتب، وإلا المخزن الافتراضي للصنف، وإلا رفض.

    الرفض أحسن من اختيار «أول مخزن» — الحركة اللي بتتكتب في مخزن محدش اختاره بتظهر
    كعجز في مخزن وزيادة في التاني، ومحدش بيربطها بالورقة اللي عملتها.
    """
    wid = given if given is not None else item.default_warehouse_id
    if wid is None:
        raise ProductionOrderError(f"الصنف «{item.name}» محتاج مخزن على السطر.")
    if db.get(Warehouse, int(wid)) is None:
        raise ProductionOrderError("المخزن مش موجود.")
    return int(wid)


def recipe_plan(db: Session, *, product_id: int, quantity, bom_id: int | None = None):
    """خامات الوصفة مضروبة في الكمية — [(item_id, كمية مخطّطة بالوحدة الأساسية)].

    في الخدمة مش في الشاشة عشان اللي بيتعرض واللي بيتخزّن يبقى رقم واحد: معاينة بتحسب
    بطريقة وترحيل بيحسب بطريقة تانية بتخلّي أمين المخزن يدوّر على فرق مالوش سبب.

    و`bom_id` بيتبعت صراحةً لما يكون للمنتج أكتر من نسخة وصفة (A/B/C عند a5) — من غيره
    بتتاخد النشطة.
    """
    bom = db.get(Bom, bom_id) if bom_id is not None else db.scalar(
        select(Bom).where(Bom.product_id == product_id, Bom.active.is_(True)))
    if bom is None:
        return []
    if bom.product_id != product_id:
        raise ProductionOrderError("التركيبة دي مش بتاعة المنتج ده.")
    scale = production.scale_factor(bom.output_quantity, quantity)
    return [(c.item_id, production.consumed_quantity(
        c.quantity, scale, getattr(c, "unit_factor", 1) or 1)) for c in bom.components]


def _build_lines(db: Session, order: ProductionOrder, products) -> None:
    """يبني (أو يعيد بناء) سطور الأمر من الطلب. مافيش حركة مخزون هنا خالص.

    الكمية المخطّطة بتتنسخ من الوصفة وقت الفتح — نسخة، مش إشارة للوصفة — عشان تعديل
    الوصفة بكرة مايغيّرش المفروض اللي الأمر ده اتفتح عليه.
    """
    if not products:
        raise ProductionOrderError("أمر التشغيل لازم يكون فيه منتج واحد على الأقل.")

    total_expense = ZERO
    total_plan_qty = to_qty(0)
    total_actual_qty = to_qty(0)
    total_material_qty = to_qty(0)

    for p in products:
        item = db.get(Item, int(p["item_id"]))
        if item is None:
            raise ProductionOrderError("صنف المنتج مش موجود.")
        p_unit = p.get("unit") or None
        p_factor = _factor(db, item, p_unit)
        planned = to_qty(Decimal(str(p.get("planned_quantity") or p["quantity"])) * p_factor)
        actual = to_qty(Decimal(str(p["quantity"])) * p_factor)
        if actual <= to_qty(0):
            raise ProductionOrderError(f"كمية «{item.name}» لازم تكون أكبر من صفر.")
        p_wh = _warehouse(db, item, p.get("warehouse_id"))
        expense = to_money(p.get("expense_amount") or 0)
        if expense < ZERO:
            raise ProductionOrderError("المصاريف مايكونوش بالسالب.")

        line = ProductionOrderProduct(
            order_id=order.id, item_id=item.id, warehouse_id=p_wh,
            planned_quantity=planned, quantity=actual, unit=p_unit, unit_factor=to_qty(p_factor),
            bom_id=p.get("bom_id"), material_cost=ZERO, expense_amount=expense,
            total_cost=ZERO, unit_cost=ZERO)
        order.products.append(line)
        db.flush()

        rows = p.get("materials") or []
        if not rows:
            # الوصفة هي المصدر الطبيعي للسطور، فلو مافيش سطور اتبعتت بنجيبها منها بدل
            # ما نرفض ورقة اللي كاتبها كان قاصد يقول «اعمل الوصفة زي ما هي».
            rows = [{"item_id": iid, "quantity": q, "planned_quantity": q} for iid, q in
                    recipe_plan(db, product_id=item.id, quantity=actual, bom_id=p.get("bom_id"))]
        if not rows:
            raise ProductionOrderError(
                f"«{item.name}» مالوش خامات ولا وصفة — التكلفة مش هتتحسب من غيرها.")
        # الصنف مايتكررش تحت نفس المنتج: كل صف بيرحّل حركته وبيترد لوحده، فالمجموع
        # بيطلع صح بالصدفة وكل قراءة لسطر لوحده بتطلع غلط.
        if len({int(m["item_id"]) for m in rows}) != len(rows):
            raise ProductionOrderError(f"فيه خامة متكررة تحت «{item.name}».")

        for m in rows:
            raw = db.get(Item, int(m["item_id"]))
            if raw is None:
                raise ProductionOrderError("صنف الخامة مش موجود.")
            m_unit = m.get("unit") or None
            m_factor = _factor(db, raw, m_unit)
            m_planned = to_qty(
                Decimal(str(m.get("planned_quantity") or m["quantity"])) * m_factor)
            m_qty = to_qty(Decimal(str(m["quantity"])) * m_factor)
            if m_qty <= to_qty(0):
                raise ProductionOrderError(f"كمية «{raw.name}» لازم تكون أكبر من صفر.")
            waste = to_qty(m.get("waste_quantity") or 0)
            if waste < to_qty(0) or waste > m_qty:
                raise ProductionOrderError("كمية الهالك لازم تكون بين صفر والكمية المصروفة.")
            order.materials.append(ProductionOrderMaterial(
                order_id=order.id, product_line_id=line.id, item_id=raw.id,
                warehouse_id=_warehouse(db, raw, m.get("warehouse_id")),
                planned_quantity=m_planned, quantity=m_qty, unit=m_unit,
                unit_factor=to_qty(m_factor), unit_cost=ZERO, line_cost=ZERO,
                waste_quantity=waste))
            total_material_qty += m_qty

        total_expense += expense
        total_plan_qty += planned
        total_actual_qty += actual

    order.expense_amount = to_money(total_expense)
    order.planned_quantity = total_plan_qty
    order.product_quantity = total_actual_qty
    order.material_quantity = total_material_qty
    # التكلفة بتفضل صفر لحد التنفيذ — المسودة مالهاش تكلفة لأنها مااستهلكتش حاجة،
    # ورقم دلوقتي بيبقى تخمين هيتغيّر لما الأمر يتنفّذ بمتوسط تاني.
    order.material_cost = ZERO
    order.total_cost = to_money(total_expense)
    db.flush()


def create_order(
    db: Session,
    *,
    products,
    actor_user_id: int,
    production_date: date | None = None,
    branch_id: int | None = None,
    external_document_number: str | None = None,
    statement1: str | None = None,
    notes: str | None = None,
    reviewed: bool = False,
    execute: bool = False,
) -> ProductionOrder:
    """يفتح أمر تشغيل **كمسودة** — ولا حركة مخزون واحدة بتتكتب هنا.

    `execute=True` بتنفّذه في نفس النداء لواحد عارف إنه بيسجّل شغل خلص. ولسه مستند
    واحد بنداء واحد: صرف الخامات في طلب والإنتاج في طلب تاني بيسيب مخزون اتصرف
    ومافيش حاجة اتعملت لو التاني وقع.
    """
    order = ProductionOrder(
        document_number=_doc_number(db),
        production_date=production_date or date.today(), branch_id=branch_id,
        external_document_number=(external_document_number or None),
        statement1=(statement1 or None), notes=(notes or None), reviewed=bool(reviewed),
        state=ProductionState.draft,
        material_cost=ZERO, expense_amount=ZERO, total_cost=ZERO,
        planned_quantity=to_qty(0), product_quantity=to_qty(0), material_quantity=to_qty(0),
        actor_user_id=actor_user_id)
    db.add(order)
    db.flush()
    _build_lines(db, order, products)
    if order.branch_id is None and order.products:
        w = db.get(Warehouse, order.products[0].warehouse_id)
        order.branch_id = w.branch_id if w is not None else None
    audit_service.record(db, action="production_order.create", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id,
                         after={"doc": order.document_number})
    if execute:
        execute_order(db, order_id=order.id, actor_user_id=actor_user_id)
    return order


def update_order(db: Session, *, order_id: int, products, actor_user_id: int, **header) -> ProductionOrder:
    """يعيد كتابة مسودة. **المسودة بس** — المنفّذ اتحرّك مخزون عليه، والتعديل فوقه
    معناه حركة مكتوبة على ورقة بتقول حاجة تانية. اللي عايز يغيّره بيعكسه ويكتب غيره."""
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.state not in (ProductionState.draft, ProductionState.confirmed):
        raise ProductionOrderError("الأمر المنفّذ مايتعدّلش — اعكسه واكتب غيره.")
    for field in ("production_date", "branch_id", "external_document_number",
                  "statement1", "notes", "reviewed"):
        if field in header:
            setattr(order, field, header[field])
    for line in list(order.materials):
        db.delete(line)
    for line in list(order.products):
        db.delete(line)
    db.flush()
    _build_lines(db, order, products)
    order.state = ProductionState.draft
    audit_service.record(db, action="production_order.update", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id)
    return order


def confirm_order(db: Session, *, order_id: int, actor_user_id: int) -> ProductionOrder:
    """مسودة ← مؤكد: مراجعة اتعملت، ولسه مافيش حركة مخزون."""
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.state != ProductionState.draft:
        raise ProductionOrderError("التأكيد بيتعمل للمسودة بس.")
    order.state = ProductionState.confirmed
    order.reviewed = True
    db.flush()
    audit_service.record(db, action="production_order.confirm", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id)
    return order


def execute_order(db: Session, *, order_id: int, actor_user_id: int) -> ProductionOrder:
    """مؤكد ← منفّذ: بيصرف كل خامة من مخزنها وبيضيف كل منتج لمخزنه، والتكلفة بتتجمّد.

    الخامات الأول: لو خامة مش كفاية، الأمر كله بيقع من غير ما يبقى فيه منتج اتضاف
    لمخزون على خامة مااتصرفتش.
    """
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.imported_from is not None:
        raise ProductionOrderError("الأمر المنقول من a5 اتنفّذ في نظامهم — مايترحّلش تاني.")
    if order.state not in (ProductionState.draft, ProductionState.confirmed):
        raise ProductionOrderError("الأمر ده اترحّل قبل كده.")

    # المتوسط بيتقرا مرة واحدة لكل الأصناف — النداء جوّه اللفة بيبقى استعلام لكل سطر.
    averages = costing_service.average_cost_bulk(db, {m.item_id for m in order.materials})
    by_line: dict[int, Decimal] = {}

    for m in order.materials:
        mv = stock_service.post_movement(
            db, item_id=m.item_id, location_kind=LocationKind.warehouse,
            location_id=int(m.warehouse_id), movement_type="consumption_out",
            direction=StockDirection.out, quantity=to_qty(m.quantity),
            actor_user_id=actor_user_id, source_doc_type=DOC_TYPE, source_doc_id=order.id)
        # **التكلفة بتتجمّد هنا**، مش بتتحسب كل مرة الشاشة تتفتح: الأمر اللي اتقفل
        # الشهر اللي فات مايتغيّرش سعره لما تتشترى خامة بسعر جديد النهارده.
        m.unit_cost = to_money(averages.get(m.item_id, ZERO))
        m.line_cost = production.line_cost(m.quantity, m.unit_cost)
        m.stock_movement_id = mv.id
        if m.product_line_id is not None:
            by_line[m.product_line_id] = by_line.get(m.product_line_id, ZERO) + m.line_cost

    material_cost = ZERO
    for p in order.products:
        mv = stock_service.post_movement(
            db, item_id=p.item_id, location_kind=LocationKind.warehouse,
            location_id=int(p.warehouse_id), movement_type="production_in",
            direction=StockDirection.in_, quantity=to_qty(p.quantity),
            actor_user_id=actor_user_id, source_doc_type=DOC_TYPE, source_doc_id=order.id)
        p.stock_movement_id = mv.id
        p.material_cost = to_money(by_line.get(p.id, ZERO))
        p.total_cost = to_money(p.material_cost + p.expense_amount)
        p.unit_cost = production.unit_cost(p.total_cost, p.quantity)
        material_cost += p.material_cost

    order.material_cost = to_money(material_cost)
    order.total_cost = to_money(material_cost + order.expense_amount)
    order.state = ProductionState.done
    db.flush()
    audit_service.record(db, action="production_order.execute", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id,
                         after={"cost": str(order.total_cost)})
    return order


def list_orders(db: Session, *, search: str | None = None, branch_id: int | None = None,
                state: str | None = None, date_from=None, date_to=None,
                imported: bool | None = None):
    stmt = select(ProductionOrder)
    if branch_id is not None:
        stmt = stmt.where(ProductionOrder.branch_id == branch_id)
    if state:
        stmt = stmt.where(ProductionOrder.state == ProductionState(state))
    if date_from is not None:
        stmt = stmt.where(ProductionOrder.production_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(ProductionOrder.production_date <= date_to)
    if imported is True:
        stmt = stmt.where(ProductionOrder.imported_from.is_not(None))
    elif imported is False:
        stmt = stmt.where(ProductionOrder.imported_from.is_(None))
    if search:
        q = f"%{search.strip()}%"
        stmt = stmt.where(ProductionOrder.document_number.like(q)
                          | ProductionOrder.external_document_number.like(q))
    return db.scalars(stmt.order_by(ProductionOrder.id.desc())).all()


def get_order(db: Session, order_id: int) -> ProductionOrder | None:
    return db.get(ProductionOrder, order_id)


def reversed_ids(db: Session) -> set[int]:
    return {r for (r,) in db.execute(
        select(ProductionOrder.reverses_id).where(
            ProductionOrder.reverses_id.is_not(None))).all()}


def delete_draft(db: Session, *, order_id: int, actor_user_id: int) -> None:
    """المسودة تتمسح؛ المنفّذ لأ. المنفّذ حرّك مخزون، ومسحه بيسيب حركة مالهاش ورقة."""
    order = db.get(ProductionOrder, order_id)
    if order is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if order.state not in (ProductionState.draft, ProductionState.confirmed):
        raise ProductionOrderError("المنفّذ مايتمسحش — اعكسه.")
    audit_service.record(db, action="production_order.delete", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=order.id,
                         before={"doc": order.document_number})
    db.delete(order)
    db.flush()


def reverse_order(db: Session, *, order_id: int, actor_user_id: int) -> ProductionOrder:
    """يعكس كل حركة في الأمر المنفّذ: بيشيل التام ويرجّع الخامات. مرة واحدة بس.

    **حركة مرآة بتفضل في السجل، مش مسح** — نفس قاعدة `transfer_service.cancel`.

    وشيل التام الأول: لو اتباع أو اتستهلك، منع السالب بيوقّف العكس هنا — قبل ما تكون
    الخامات رجعت للمخزن على إنتاج لسه في إيد حد.
    """
    original = db.get(ProductionOrder, order_id)
    if original is None:
        raise ProductionOrderError("أمر التشغيل مش موجود.")
    if original.reverses_id is not None:
        raise ProductionOrderError("الأمر العكسي نفسه مايتعملهوش عكس.")
    if original.imported_from is not None:
        # المنقول مالوش حركة بتاعته يعكسها — سطوره بتشاور على حركات `ManufacturingOp`
        # المنقولة، وعكسها من هنا بيسيب العملية الأصلية شايلة حركة اتعكست من تحتها.
        raise ProductionOrderError("الأمر المنقول من a5 للعرض بس — مايتعكسش من هنا.")
    if original.state != ProductionState.done:
        raise ProductionOrderError("العكس بيتعمل للمنفّذ بس — المسودة تتعدّل أو تتمسح.")
    if db.scalar(select(ProductionOrder).where(
            ProductionOrder.reverses_id == order_id)) is not None:
        raise ProductionOrderError("الأمر ده اتعكس قبل كده.")

    rev = ProductionOrder(
        document_number=_doc_number(db), production_date=date.today(),
        branch_id=original.branch_id,
        external_document_number=original.external_document_number,
        statement1=f"عكس {original.document_number}", notes=original.notes,
        state=ProductionState.done,
        material_cost=original.material_cost, expense_amount=original.expense_amount,
        total_cost=original.total_cost, planned_quantity=original.planned_quantity,
        product_quantity=original.product_quantity,
        material_quantity=original.material_quantity,
        reverses_id=order_id, actor_user_id=actor_user_id)
    db.add(rev)
    db.flush()

    by_line: dict[int, int] = {}
    for p in original.products:
        mirror = stock_service.reverse_movement(
            db, original_id=p.stock_movement_id, actor_user_id=actor_user_id,
            movement_type="reverse_production_in")
        line = ProductionOrderProduct(
            order_id=rev.id, item_id=p.item_id, warehouse_id=p.warehouse_id,
            planned_quantity=p.planned_quantity, quantity=p.quantity,
            unit=p.unit, unit_factor=p.unit_factor, bom_id=p.bom_id,
            material_cost=p.material_cost, expense_amount=p.expense_amount,
            total_cost=p.total_cost, unit_cost=p.unit_cost, stock_movement_id=mirror.id)
        rev.products.append(line)
        db.flush()
        by_line[p.id] = line.id

    for m in original.materials:
        mirror = stock_service.reverse_movement(
            db, original_id=m.stock_movement_id, actor_user_id=actor_user_id,
            movement_type="reverse_consumption_out")
        rev.materials.append(ProductionOrderMaterial(
            order_id=rev.id, product_line_id=by_line.get(m.product_line_id),
            item_id=m.item_id, warehouse_id=m.warehouse_id,
            planned_quantity=m.planned_quantity, quantity=m.quantity,
            unit=m.unit, unit_factor=m.unit_factor, unit_cost=m.unit_cost,
            line_cost=m.line_cost, waste_quantity=m.waste_quantity,
            stock_movement_id=mirror.id))

    original.state = ProductionState.reversed
    db.flush()
    audit_service.record(db, action="production_order.reverse", actor_user_id=actor_user_id,
                         entity_type="production_order", entity_id=rev.id,
                         before={"order": order_id})
    return rev
