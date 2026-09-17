"""المستندات اللي بتحرّك مخزون وإحنا عملناها — مالهاش نظير في a5. قراءة بس.

    python -m src.scripts.audit_own_stock_docs --dirs C:/pgtmp,C:/pgtmp/aliaa --prefixes ,AL-

`audit_a5_doc_drift` بيسأل: إيه اللي في a5 ومش عندنا. ده بيسأل العكس — إيه اللي عندنا
ومش في a5. والسؤال ده هو اللي بيفسّر فرق الرصيد لما يبقى **إحنا** السبب: بيع اتعمل من
التطبيق، إذن اتكتب من الشاشة، تحويل اتعمل للتجربة. البضاعة اتحركت عندنا فعلاً وa5
مايعرفش عنها حاجة، فرصيده بيفضل أعلى — وده مش غلط في النقل، ده الفرق الطبيعي بين نظامين
شغّالين على التوازي.

**التفرقة بالرقم مش بالتاريخ.** المستند المنقول رقمه من المستورد (`{prefix}{tag}{a5_id}`)
والرقم ده موجود في التصدير. أي رقم تاني = مستند اتكتب عندنا. التاريخ مابيفرقش: النقل
بيحط تاريخ a5 على المستند، فالتاريخ مابيقولش مين كتبه.

**والفرعين بيتقروا مع بعض عن قصد.** مستنداتنا مرقّمة `SINV-000001` و`TRF-000001` —
ترقيم `numbering.py` مالوش بادئة فرع. فتشغيلة لفرع واحد بترمي مستنداتنا من الفرع
التاني، والفلترة بأصناف الفرع بترمي حركاتها كمان — والنتيجة صفر على بيع حصل فعلاً.

الخرج: لكل نوع، عدد المستندات وأثرها على المخزون، ولكل صنف أثره — عشان يتقارن على طول
بفرق `verify_a5_stock`.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.stock import StockDirection, StockMovement
from src.scripts.audit_a5_doc_drift import TABLES
from src.scripts.import_a5 import _read
from src.scripts.import_a5_docs import KIND, L_QTY, L_TYPE, _doc_key

ZERO = Decimal("0")

# نوع a5 → قيم `source_doc_type` المقبولة على حركة المخزون.
#
# **قيمتين لنفس المستند، مش واحدة.** المستورد بيكتب `sales_invoice` والخدمة الحيّة
# بتكتب `sale`؛ `stock_transfer` مقابل `transfer`؛ `purchase_invoice` مقابل `purchase`.
# لغتين لنفس الحاجة اتكتبوا في مكانين، ومحدش بيفرضهم يتفقوا — والسكربت ده لازم يشوف
# الاتنين لأن اللي بيدوّر عليه بالتحديد هو مستند اتكتب من الشاشة.
DOC_TYPES = {
    "7": ("sales_invoice", "sale"),
    "2": ("sales_return", "sale_return"),
    "1": ("purchase_invoice", "purchase"),
    "11": ("purchase_return",),
    "6": ("stock_transfer", "transfer"),
    "3": ("stock_permit",),
}


def run(pairs: list[tuple[str, str]]) -> int:
    db = SessionLocal()
    try:
        # أرقام مستندات a5 في الفرعين — اللي مش فيها بقى مستندنا إحنا.
        a5_numbers: set[str] = set()
        for folder, prefix in pairs:
            for r in _read(os.path.join(folder, "a5_lines.tsv")):
                if len(r) <= L_QTY:
                    continue
                t = r[L_TYPE].strip()
                if t not in KIND:
                    continue
                a5_numbers.add(f"{prefix}{KIND[t][1]}{_doc_key(r).strip()}")

        item_name = {i.id: i.name for i in db.scalars(select(Item)).all()}
        print(f"أرقام مستندات a5 (الفرعين): {len(a5_numbers)}")

        grand: dict[int, Decimal] = defaultdict(Decimal)
        for a5_type, (head_cls, _line_cls, _fk) in TABLES.items():
            label = KIND[a5_type][0]
            ours = [h for h in db.scalars(select(head_cls)).all()
                    if h.document_number not in a5_numbers]
            if not ours:
                continue

            # أثر المستند على المخزون من الحركة نفسها — مش من سطوره: السطر بيقول الكمية،
            # والحركة بتقول اتحركت فين وفي أي اتجاه، والرصيد مبني على التانية.
            effect: dict[int, Decimal] = defaultdict(Decimal)
            rows = 0
            for h in ours:
                for mv in db.scalars(
                    select(StockMovement).where(
                        StockMovement.source_doc_type.in_(DOC_TYPES[a5_type]),
                        StockMovement.source_doc_id == h.id)).all():
                    q = Decimal(str(mv.quantity))
                    effect[mv.item_id] += q if mv.direction == StockDirection.in_ else -q
                    rows += 1

            net = sum(effect.values(), ZERO)
            print(f"\n{label}: {len(ours)} مستند مش في a5   "
                  f"({rows} حركة مخزون، صافيها {net})")
            for h in sorted(ours, key=lambda x: x.document_number)[:40]:
                when = getattr(h, "invoice_date", None) or getattr(h, "transfer_date", None)                     or getattr(h, "permit_date", None) or getattr(h, "return_date", None)
                print(f"   {h.document_number:<16}{when or ''}")
            if len(ours) > 40:
                print(f"   … و{len(ours) - 40} كمان")
            for item_id, q in effect.items():
                grand[item_id] += q

        moved = {k: v for k, v in grand.items() if v != ZERO}
        print(f"\n{'='*70}\nأصناف اتحرّكت بمستنداتنا إحنا: {len(moved)}   "
              f"الصافي: {sum(moved.values(), ZERO)}\n{'='*70}")
        for item_id, q in sorted(moved.items(), key=lambda x: x[1]):
            print(f"   {item_name.get(item_id, item_id)[:38]:<40}{q:>12}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    dirs = (args[args.index("--dirs") + 1] if "--dirs" in args
            else "C:/pgtmp,C:/pgtmp/aliaa").split(",")
    prefixes = (args[args.index("--prefixes") + 1] if "--prefixes" in args
                else ",AL-").split(",")
    sys.exit(run(list(zip(dirs, prefixes, strict=True))))
