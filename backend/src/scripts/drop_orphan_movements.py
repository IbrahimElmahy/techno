"""حركة مخزون بتشاور على مستند مش موجود — شبح مستند اتمسح. درايَ-رن بالافتراضي.

    python -m src.scripts.drop_orphan_movements
    python -m src.scripts.drop_orphan_movements --yes

---------------------------------------------------------------------------
**المشكلة.** الرصيد عندنا **مشتق من `stock_movement`**، مش رقم مخزّن. فالحركة اللي
مستندها اتمسح بضاعة بتتحرك من غير ورقة تفسّرها: مالهاش سطر، ومالهاش رقم، ومابتظهرش في
أي كشف ولا في كارت الصنف — وبتفضل في الرصيد للأبد. البضاعة بتبان في المخزن الغلط وماحدش
يقدر يوصل للسبب، لأن السبب مش موجود.

اتقاس على قاعدة الإنتاج: **إذن تحويل واحد** (`stock_transfer#2527`) سايب ١٦ حركة صافيها
صفر بس بتنقل ٥٣ وحدة من «المخزن الرئيسى» لـ«مخزن السياره ( د )» في العلياء — وهي الفرق
الوحيد اللي فضل بين رصيدنا ورصيد a5 بعد ما اتشال أثر مستنداتنا إحنا.

**ومن فين جم.** حذف إذن التحويل كان بيشيل الرأس ويسيب الحركات. `transfer_service.
_drop_movements()` اتصلّح (بيفك الروابط وبيـ`flush` قبل الحذف)، فالأشباح الجديدة
مابقتش تتعمل — بس القديمة فاضلة في القاعدة، والإصلاح مابيلمسهاش بأثر رجعي.

**الافتتاحي مش يتيم ومابيتلمسش.** `a5_opening*` مستند وهمي بـ`source_doc_id = 0` عن
قصد: الرصيد الافتتاحي حركة مالهاش مستند أصلاً عند a5. وأي نوع مستند السكربت مايعرفوش
بيتعدّ ويتقال **ومايتمسحش** — الجهل مش سبب للحذف.

⚠️ **الحذف مش رجوع.** الحركة اليتيمة مالهاش نسخة تانية، فاللي بيتشال بيروح. وعشان كده
درايَ-رن بالافتراضي، والأثر بيتطبع صنف بصنف قبل أي كتابة.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.stock_permit import StockPermit
from src.models.transfer import StockTransfer
from src.models.warehouse import Warehouse

# `source_doc_type` → جدول الرأس. **قيمتين لنفس المستند**: المستورد بيكتب
# `sales_invoice` والخدمة الحيّة بتكتب `sale` — لغتين لنفس الحاجة، والاتنين لازم
# يتفحصوا وإلا كل مستند مستورد هيتحسب «يتيم».
HEADS = {
    "sale": SalesInvoice, "sales_invoice": SalesInvoice,
    "sale_return": SalesReturn, "sales_return": SalesReturn,
    "purchase": PurchaseInvoice, "purchase_invoice": PurchaseInvoice,
    "purchase_return": PurchaseReturn,
    "transfer": StockTransfer, "stock_transfer": StockTransfer,
    "stock_permit": StockPermit, "permit": StockPermit,
}


def run(*, execute: bool) -> int:
    db = SessionLocal()
    try:
        alive = {cls: {r[0] for r in db.execute(select(cls.id)).all()}
                 for cls in set(HEADS.values())}
        item_name = {i.id: i.name for i in db.scalars(select(Item)).all()}
        wh_name = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}

        ghosts: dict[str, int] = defaultdict(int)
        unknown: dict[str, int] = defaultdict(int)
        orphans: list[StockMovement] = []
        for m in db.scalars(select(StockMovement)).all():
            kind = m.source_doc_type or ""
            if kind.startswith("a5_opening"):
                continue
            cls = HEADS.get(kind)
            if cls is None:
                unknown[kind] += 1
                continue
            if m.source_doc_id in alive[cls]:
                continue
            ghosts[f"{kind}#{m.source_doc_id}"] += 1
            orphans.append(m)

        if unknown:
            print("أنواع مستندات مش معروفة للسكربت — مااتفحصتش ومااتمستش:")
            for k, n in sorted(unknown.items(), key=lambda x: -x[1]):
                print(f"   «{k or '(فاضي)'}» — {n} حركة")
            print("")

        if not orphans:
            print("مافيش حركة يتيمة. الرصيد كله وراه مستند.")
            return 0

        print(f"حركات يتيمة: {len(orphans)}   على {len(ghosts)} مستند شبح")
        for k, n in sorted(ghosts.items(), key=lambda x: -x[1]):
            print(f"   {k:<28}{n:>4} حركة")

        effect: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        for m in orphans:
            if m.location_kind != LocationKind.warehouse:
                continue
            q = Decimal(str(m.quantity or 0))
            effect[(m.item_id, m.location_id)] += (
                q if m.direction == StockDirection.in_ else -q)
        effect = {k: v for k, v in effect.items() if v != 0}

        print(f"\nالرصيد اللي هيترجّع: {len(effect)} زوج (صنف × مخزن)"
              f"   صافي {sum(effect.values(), Decimal(0))}")
        for (i, w), v in sorted(effect.items(), key=lambda x: -abs(x[1])):
            print(f"   {item_name.get(i, str(i))[:29]:<30}"
                  f"{wh_name.get(w, str(w))[:21]:<22}{v:>10}")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ — **والحذف مالوش رجوع**.")
            return 0

        for m in orphans:
            db.delete(m)
        db.commit()
        print(f"\nاتمسح {len(orphans)} حركة.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(run(execute="--yes" in sys.argv[1:]))
