"""حركة التصنيع من a5 — النوعين اللي `import_a5_docs` مابيعرفهمش.

    python -m src.scripts.import_a5_manufacturing --dir /opt/techno/a5factory --branch السادات --prefix FC-
    python -m src.scripts.import_a5_manufacturing --dir ... --branch ... --prefix ... --yes

---------------------------------------------------------------------------
**ليه السكربت ده موجود.** `import_a5_docs` بيعرف سبع أنواع (بيع، شرا، مردوداتهم،
تحويل، أذون) وبيفلتر أي حاجة تانية بصمت. وفي مصنع السادات ده بيرمي **٤٬٣٨٩ سطر**:

    AznType 9   ٣٬٣٢٦ سطر   صرف خامات    خارج من الجودة/سحب المواسير/الجيوان
    AznType 4   ١٬٠٦٣ سطر   إنتاج تام     داخل مخزن الانتاج التام

والنتيجة مقاسة مش نظرية: بعد النقل من غيرهم طلع **٦٧٠ زوج (صنف×مخزن)** مختلف عن a5
بفرق ٦٣٠٬٣٧٩ وحدة — مخزن الانتاج التام بالسالب عندنا لأنه بيتباع منه من غير ما يتنتج
فيه، والخامات أعلى لأنها بتتشترى ومابتتستهلكش. نص المعادلة كان ناقص.

**أمر التشغيل عندهم `EntgRef`.** كل السطور اللي بنفس الرقم مستند واحد: الاستهلاك
والإنتاج مع بعض. والأمر الواحد بيطلّع أكتر من منتج — شفنا أربعة في أمر.

---------------------------------------------------------------------------
تلات قرارات:

* **بتتسجّل عمليات مش أوامر.** `ManufacturingOrder` عندنا منتج واحد لكل أمر، وأمر a5
  بيطلّع كذا منتج. تفصيل أمر واحد لكذا أمر معناه إننا نوزّع الخامات على المنتجات
  بالتخمين — والوصفة مش دايماً موجودة. فبتتسجّل `ManufacturingOp` لكل سطر: ده اللي
  حصل فعلاً، والرصيد بيطلع مظبوط، والوصفات بتتنقل لوحدها في `import_a5_boms`.

* **رقم المستند مشتق من `EntgRef`** (`FC-MFG-3336-001`). يعني السكربت بيتعاد بأمان —
  السطر اللي اتسجّل بيتخطى — والسطر عندنا بيرجع لأصله في a5 بالرقم.

* **السالب مسموح، والفحص على نوع الصنف بيتخطى.** `manufacturing_service.consume`
  بيطلب `kind == raw_material` و`produce` بيطلب `product`، ونقل a5 عمل كل الأصناف
  `product` — فالنداء عليهم بيرفض ٣٬٣٢٦ سطر. ودي حركة حصلت خلاص من سنة، مش أمر
  بيتعمل دلوقتي: الرفض معناه إن الرصيد يفضل غلط. نفس منطق `allow_negative` في
  `import_a5_docs`.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.manufacturing import ManufactureOpType, ManufacturingOp
from src.models.org import Branch
from src.models.stock import LocationKind, StockDirection
from src.models.user import User
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read
from src.services import stock_service

#: أعمدة `a5_mfg.tsv`
(M_TYPE, M_REF, M_DATE, M_CODE, M_NAME, M_QTY, M_IN, M_OUT, M_AZN) = range(9)

PRODUCE, CONSUME = "4", "9"


def _date(v: str):
    try:
        return datetime.strptime((v or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def run(folder: str, *, execute: bool, branch_name: str, prefix: str) -> None:
    rows = [r for r in _read(os.path.join(folder, "a5_mfg.tsv"))
            if len(r) >= 9 and r[M_TYPE] in (PRODUCE, CONSUME)]

    groups: dict[str, list[list[str]]] = defaultdict(list)
    for r in rows:
        groups[_clean(r[M_REF]) or f"AZN{_clean(r[M_AZN])}"].append(r)

    n_prod = sum(1 for r in rows if r[M_TYPE] == PRODUCE)
    n_cons = len(rows) - n_prod
    print("المصدر:")
    print(f"   أوامر تشغيل          {len(groups):>7}")
    print(f"   سطور إنتاج           {n_prod:>7}")
    print(f"   سطور استهلاك         {n_cons:>7}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    try:
        branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{branch_name}».")
        actor = db.scalars(select(User).order_by(User.id)).first()

        wh = {w.name: w for w in db.scalars(
            select(Warehouse).where(Warehouse.branch_id == branch.id)).all()}
        by_code = {i.code: i for i in db.scalars(select(Item)).all()}
        by_name: dict[str, Item] = {}
        for i in by_code.values():
            by_name.setdefault(i.name, i)
        seen = {d for (d,) in db.execute(select(ManufacturingOp.document_number)).all()}

        made = {"إنتاج": 0, "استهلاك": 0}
        skipped: list[str] = []
        done = 0
        for ref, lines in sorted(groups.items(), key=lambda kv: kv[1][0][M_DATE]):
            for n, r in enumerate(lines, 1):
                doc = f"{prefix}MFG-{ref}-{n:03d}"
                if doc in seen:
                    continue
                qty = _money(r[M_QTY])
                if qty <= 0:
                    continue          # a5 بيكتب سطور بصفر — مكوّن مش مستهلك المرة دي
                code, name = _clean(r[M_CODE]), _clean(r[M_NAME])
                item = by_code.get(f"{prefix}{code}") or by_name.get(name)
                if item is None:
                    skipped.append(f"صنف مش موجود: «{name}» ({code})")
                    continue
                produce = r[M_TYPE] == PRODUCE
                store = _clean(r[M_IN]) if produce else _clean(r[M_OUT])
                w = wh.get(store)
                if w is None:
                    skipped.append(f"مخزن مش موجود: «{store}»")
                    continue

                op = ManufacturingOp(
                    document_number=doc,
                    op_type=ManufactureOpType.produce if produce else ManufactureOpType.consume,
                    item_id=item.id, location_kind=LocationKind.warehouse, location_id=w.id,
                    quantity=Decimal(str(qty)), actor_user_id=actor.id)
                db.add(op)
                db.flush()
                mv = stock_service.post_movement(
                    db, item_id=item.id, location_kind=LocationKind.warehouse, location_id=w.id,
                    movement_type="production_in" if produce else "consumption_out",
                    direction=StockDirection.in_ if produce else StockDirection.out,
                    quantity=Decimal(str(qty)), actor_user_id=actor.id,
                    source_doc_type="manufacturing", source_doc_id=op.id, allow_negative=True)
                # **التاريخ بيتحط بالإيد.** `post_movement` بيستنتجه من ورقة المستند،
                # و`ManufacturingOp` مالهاش عمود تاريخ — فكان هياخد تاريخ النهارده
                # ويحط شغل سنة كاملة في يوم واحد.
                mv.movement_date = _date(r[M_DATE]) or mv.movement_date
                op.stock_movement_id = mv.id
                seen.add(doc)
                made["إنتاج" if produce else "استهلاك"] += 1
            done += 1
            if done % 200 == 0:
                db.flush()
                print(f"   … {done}/{len(groups)}")

        db.commit()
        print("\nالكيان               اتعمل")
        print("-" * 28)
        for k, v in made.items():
            print(f"{k:<22}{v:>6}")
        if skipped:
            from collections import Counter
            c = Counter(skipped)
            print(f"\nاتخطّى {len(skipped)} سطر، {len(c)} سبب:")
            for s, n in c.most_common(15):
                print(f"   {n:>5} × {s}")
        print("\nتم.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="استيراد حركة التصنيع من a5")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(a.dir, execute=a.yes, branch_name=a.branch, prefix=a.prefix)


if __name__ == "__main__":
    main()
