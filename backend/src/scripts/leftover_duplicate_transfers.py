# -*- coding: utf-8 -*-
"""الأوراق اللي فضلت من تكرار التحويلات — وكل سطر فيها بكميته اللي لسه موجودة.

    python -m src.scripts.leftover_duplicate_transfers
    python -m src.scripts.leftover_duplicate_transfers --csv /tmp/leftover.csv

`find_duplicate_transfers --reverse` ألغى ١١ ورقة مكررة. خمسة فضلوا ومااتلمسوش:

* **تلاتة رفضهم الحارس** — البضاعة وصلت الوجهة **واتباعت منها**، فالإلغاء كان
  هينزّل الرصيد سالب. مش ممكن نقول إن شحنة ماوصلتش وهي اتباعت.
* **واتنين مغطّيين جزئياً** — فيهم سطور مالهاش توأم في a5، يعني فيهم شغل حقيقي؛
  إلغاؤهم كان هيضيّع اللي فيهم.

الكشف ده بيدّي لكل سطر أربع حقايق: الكمية اللي اتحوّلت، هل ليها توأم في a5،
الرصيد الحالي في الوجهة، **والكمية اللي لسه ينفع ترجع** — وهي الأقل بين
الكمية المكررة والرصيد الموجود دلوقتي. الباقي اتباع خلاص ومحتاج تسوية جرد لا
إذن رجوع.

مافيش كتابة هنا خالص — عرض وتصدير بس.
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from decimal import Decimal
from typing import Any

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.stock import LocationKind
from src.models.transfer import StockTransfer, StockTransferLine, TransferStatus
from src.models.warehouse import Warehouse
from src.services.stock_service import on_hand

#: الأوراق اللي فضلت — اللي رفضها الحارس واللي مغطّاة جزئياً.
LEFTOVER = ["TRF-000012", "TRF-000013", "TRF-000014", "TRF-000004", "TRF-000022"]


def _lines(db, t: StockTransfer) -> list[tuple[int, Decimal]]:
    rows = db.scalars(select(StockTransferLine)
                      .where(StockTransferLine.transfer_id == t.id)).all()
    if rows:
        return [(r.item_id, Decimal(str(r.quantity))) for r in rows]
    return [(t.item_id, Decimal(str(t.quantity)))] if t.item_id else []


def main() -> None:
    ap = argparse.ArgumentParser(description="كشف الأوراق الفاضلة من تكرار التحويلات")
    ap.add_argument("--csv", help="مسار ملف CSV للتصدير")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        # فهرس سطور a5 عشان نعرف أنهي سطر له توأم.
        twins: dict[tuple, list[str]] = defaultdict(list)
        for t in db.scalars(select(StockTransfer)).all():
            if t.status == TransferStatus.rejected:
                continue
            if not (t.document_number or "").startswith("AL-T"):
                continue
            for item_id, qty in _lines(db, t):
                twins[(str(t.transfer_date), t.source_location_id,
                       t.dest_location_id, item_id, str(qty))].append(t.document_number)

        wh = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}
        out_rows: list[dict[str, Any]] = []

        for doc in LEFTOVER:
            t = db.scalar(select(StockTransfer)
                          .where(StockTransfer.document_number == doc))
            if t is None:
                print(f"⚠ {doc} مش موجود")
                continue
            src = wh.get(t.source_location_id, f"#{t.source_location_id}")
            dst = wh.get(t.dest_location_id, f"#{t.dest_location_id}")
            print(f"\n{'='*94}")
            print(f"{doc}   {t.transfer_date}   من «{src}» إلى «{dst}»   "
                  f"({getattr(t.status, 'value', t.status)})")
            print(f"{'الصنف':<42}{'محوّل':>9}{'مكرر؟':>8}"
                  f"{'رصيد الوجهة':>13}{'ينفع يرجع':>12}{'اتباع':>9}")
            for item_id, qty in _lines(db, t):
                it = db.get(Item, item_id)
                name = (it.name if it else str(item_id))[:40]
                key = (str(t.transfer_date), t.source_location_id,
                       t.dest_location_id, item_id, str(qty))
                dup = bool(twins.get(key))
                bal = on_hand(db, item_id, LocationKind.warehouse, t.dest_location_id)
                # اللي ينفع يرجع = الأقل بين المكرر واللي لسه موجود.
                can = min(qty, bal) if dup else Decimal("0")
                gone = (qty - can) if dup else Decimal("0")
                print(f"{name:<42}{float(qty):>9,.0f}{('نعم' if dup else 'لأ'):>8}"
                      f"{float(bal):>13,.0f}{float(can):>12,.0f}{float(gone):>9,.0f}")
                out_rows.append({
                    "المستند": doc,
                    "التاريخ": str(t.transfer_date),
                    "من": src, "إلى": dst,
                    "الصنف": it.name if it else item_id,
                    "الكود": it.code if it else "",
                    "الكمية المحوّلة": float(qty),
                    "مكرر في a5": "نعم" if dup else "لأ",
                    "توأمه": "، ".join(twins.get(key, [])),
                    "رصيد الوجهة الآن": float(bal),
                    "ينفع يرجع": float(can),
                    "اتباع (محتاج تسوية جرد)": float(gone),
                })

        tot_back = sum(r["ينفع يرجع"] for r in out_rows)
        tot_gone = sum(r["اتباع (محتاج تسوية جرد)"] for r in out_rows)
        print(f"\n{'='*94}")
        print(f"{'إجمالي اللي ينفع يرجع بإذن رجوع':<40}{tot_back:>12,.0f}")
        print(f"{'إجمالي اللي اتباع ومحتاج تسوية جرد':<40}{tot_gone:>12,.0f}")

        if args.csv and out_rows:
            with open(args.csv, "w", newline="", encoding="utf-8-sig") as fh:
                w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
                w.writeheader()
                w.writerows(out_rows)
            print(f"\nاتكتب: {args.csv}  ({len(out_rows)} سطر)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
