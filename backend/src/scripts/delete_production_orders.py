# -*- coding: utf-8 -*-
"""مسح أمر تشغيل بالكامل — لورق التجربة اللي مالوش لازمة يفضل في الكشف.

    python -m src.scripts.delete_production_orders WO-000001 WO-000002
    python -m src.scripts.delete_production_orders WO-000001 WO-000002 --yes

---------------------------------------------------------------------------
**ليه سكربت مش زرار.** الشاشة بتمسح **المسودة** بس، وده مقصود: الأمر اللي اتنفّذ
حرّك مخزون، ومسحه من الشاشة معناه إن رصيد اتغيّر ومافيش ورقة بتقول ليه. الورقة
الغلط بتتعكس، مابتتمسحش.

اللي هنا حالة تانية: **ورق تجربة**. اتعمل واتعكس، فأثره على المخزون صفر، ومحدش
محتاج يقرا تاريخه — بس بيفضل في الكشف ويلخبط اللي بيعد.

## الشرط اللي بيحمي ده من إنه يبقى «امسح اللي مش عاجبك»

**صافي حركة الأمر لازم يكون صفر لكل (صنف، مخزن).** يعني اتعكس فعلاً. لو خامة خرجت
وماترجعتش، المسح بيرفع رصيد من غير مستند — والسكربت بيقف ويقول الصنف والمخزن
والفرق، ومابيمسحش حاجة خالص.

**والأمر المنقول من a5 مابيتمسّش** مهما كان: حركته مش بتاعتنا أصلاً، وهي متقاسمة مع
صفوف `manufacturing_op`.

**وبيمسح الأمر ومرآته مع بعض.** لو واحد فيهم بس اتطلب، التاني بيدخل معاه — مافيش
معنى لعكس بيشاور على ورقة اتمسحت.

## اللي بيتمسح

    production_order              الورقة نفسها
    production_order_product      سطور المنتج
    production_order_material     سطور الخامة
    stock_movement                الحركة ومرآتها (الصافي صفر، فالرصيد مايتغيّرش)
    audit_log_entry               سجل اللي حصل على الورقة

ومحدش تاني: مافيش قيود دفترية ولا مرفقات ولا دفعات على أوامر التشغيل (اتفحصت).
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import delete, select

from src.core.db import SessionLocal
from src.models.audit import AuditLogEntry
from src.models.catalog import Item
from src.models.manufacturing import (
    ProductionOrder,
    ProductionOrderMaterial,
    ProductionOrderProduct,
)
from src.models.stock import StockDirection, StockMovement
from src.models.warehouse import Warehouse

DOC_TYPE = "production_order"
ZERO = Decimal("0")


def main() -> None:
    ap = argparse.ArgumentParser(description="مسح أوامر تشغيل بالكامل")
    ap.add_argument("numbers", nargs="+", help="أرقام المستندات، مثل WO-000001")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        orders = db.scalars(select(ProductionOrder)
                            .where(ProductionOrder.document_number.in_(args.numbers))).all()
        found = {o.document_number for o in orders}
        for n in args.numbers:
            if n not in found:
                raise SystemExit(f"مالقيتش أمر رقمه {n}.")

        # الأمر ومرآته بيمشوا مع بعض — الشرح فوق.
        ids = {o.id for o in orders}
        for extra in db.scalars(select(ProductionOrder).where(
                ProductionOrder.reverses_id.in_(ids)
                | ProductionOrder.id.in_([o.reverses_id for o in orders if o.reverses_id]))).all():
            if extra.id not in ids:
                ids.add(extra.id)
                orders.append(extra)

        imported = [o.document_number for o in orders if o.imported_from]
        if imported:
            raise SystemExit("الأمر المنقول من a5 مايتمسحش: " + "، ".join(imported))

        moves = db.scalars(select(StockMovement).where(
            StockMovement.source_doc_type == DOC_TYPE,
            StockMovement.source_doc_id.in_(ids))).all()

        # الشرط: الصافي صفر لكل (صنف، مخزن).
        net: dict[tuple[int, int], Decimal] = defaultdict(lambda: ZERO)
        for mv in moves:
            q = Decimal(str(mv.quantity))
            net[(mv.item_id, mv.location_id)] += (
                q if mv.direction == StockDirection.in_ else -q)
        bad = {k: v for k, v in net.items() if v != ZERO}

        names = {i.id: i.name for i in db.scalars(select(Item)).all()}
        whs = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}

        print(f"{'أوامر':<30}{len(orders):>8}")
        for o in sorted(orders, key=lambda x: x.id):
            print(f"   {o.document_number:<14}{o.state.value:<14}"
                  f"{'منقول' if o.imported_from else ''}")
        prods = db.scalars(select(ProductionOrderProduct).where(
            ProductionOrderProduct.order_id.in_(ids))).all()
        mats = db.scalars(select(ProductionOrderMaterial).where(
            ProductionOrderMaterial.order_id.in_(ids))).all()
        audits = db.scalars(select(AuditLogEntry).where(
            AuditLogEntry.entity_type == "production_order",
            AuditLogEntry.entity_id.in_(ids))).all()
        print(f"{'سطور منتج':<30}{len(prods):>8}")
        print(f"{'سطور خامة':<30}{len(mats):>8}")
        print(f"{'حركات مخزون':<30}{len(moves):>8}")
        print(f"{'سطور السجل':<30}{len(audits):>8}")

        if bad:
            print("\n⛔ الحركة مش متعكسة — المسح هيغيّر أرصدة:")
            for (item_id, loc), v in bad.items():
                print(f"   «{names.get(item_id, item_id)}» في "
                      f"{whs.get(loc, '#'+str(loc))}: {v:+}")
            raise SystemExit("\nاعكس الأمر الأول، وبعدين امسحه.")
        print("\n   ✓ صافي الحركة صفر لكل صنف ومخزن — المسح مايغيّرش رصيد.")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتمسحت. ضيف --yes للتنفيذ.")
            return

        # **سطور الأمر الأول، بعدين الحركة.** سطر الخامة بيمسك `stock_movement_id`
        # (مفتاح أجنبي)، فمسح الحركة وهي لسه متشاور عليها بيترفض من القاعدة.
        db.execute(delete(ProductionOrderMaterial).where(
            ProductionOrderMaterial.order_id.in_(ids)))
        db.execute(delete(ProductionOrderProduct).where(
            ProductionOrderProduct.order_id.in_(ids)))
        db.flush()
        # وبعدين المرآة قبل الأصل: `reverses_movement_id` بيشاور عليه.
        mirror_ids = [m.id for m in moves if m.reverses_movement_id is not None]
        if mirror_ids:
            db.execute(delete(StockMovement).where(StockMovement.id.in_(mirror_ids)))
            db.flush()
        db.execute(delete(StockMovement).where(
            StockMovement.source_doc_type == DOC_TYPE,
            StockMovement.source_doc_id.in_(ids)))
        db.execute(delete(AuditLogEntry).where(
            AuditLogEntry.entity_type == "production_order",
            AuditLogEntry.entity_id.in_(ids)))
        # المرآة بتشاور على الأصل بـ`reverses_id` — بتتمسح الأول.
        db.execute(delete(ProductionOrder).where(ProductionOrder.reverses_id.in_(ids)))
        db.execute(delete(ProductionOrder).where(ProductionOrder.id.in_(ids)))
        db.commit()
        print(f"\n   ✓ اتمسح {len(orders)} أمر.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
