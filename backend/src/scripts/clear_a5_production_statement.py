"""يشيل «منقول من a5 — بغير تكلفة» من بيان أوامر التشغيل المنقولة.

    python -m src.scripts.clear_a5_production_statement
    python -m src.scripts.clear_a5_production_statement --yes

---------------------------------------------------------------------------
الجملة اتكتبت وقت النقل لأن الأوامر دخلت بتكلفة صفر، والصفر كان محتاج تفسير. بعد
`backfill_a5_production_costs` الأوامر بقت بتكلفتها، والجملة فضلت تقول «بغير تكلفة»
جنب رقم تكلفة — في الشاشة وفي تقرير الإنتاج. البيان مكانه للي المستخدم بيكتبه.

بيلمس الأوامر المنقولة بس (`imported_from = 'a5'`) واللي بيانها الجملة دي بالحرف —
أي بيان حد كتبه بإيده بيفضل زي ما هو. بيتعاد بأمان.
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.manufacturing import ProductionOrder

IMPORTED_NOTE = "منقول من a5 — بغير تكلفة"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="نفّذ (من غيرها عرض بس)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = db.scalars(select(ProductionOrder).where(
            ProductionOrder.imported_from == "a5",
            ProductionOrder.statement1 == IMPORTED_NOTE,
        )).all()
        print(f"أوامر منقولة بيانها «{IMPORTED_NOTE}»: {len(rows):,}")
        for o in rows:
            o.statement1 = None
        if not args.yes:
            db.rollback()
            print("[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"   ✓ اتشالت من {len(rows):,}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
