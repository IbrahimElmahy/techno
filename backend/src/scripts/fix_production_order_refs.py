# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.manufacturing import ProductionOrder


def main() -> None:
    ap = argparse.ArgumentParser(description="تصحيح رقم أمر التشغيل المنقول")
    ap.add_argument("--source", default="a5", help="قيمة `imported_from`")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = db.scalars(select(ProductionOrder)
                          .where(ProductionOrder.imported_from == args.source)
                          .order_by(ProductionOrder.id)).all()
        changed = []
        for o in rows:
            old = o.external_document_number or ""
            new = old.rsplit("-", 1)[-1]
            if not new or new == old:
                continue
            changed.append((o.document_number, old, new))
            if args.yes:
                o.external_document_number = new[:40]

        print(f"{'أوامر منقولة':<28}{len(rows):>8,}")
        print(f"{'رقمها هيتصلّح':<28}{len(changed):>8,}")
        if changed:
            print(f"\n{'المستند':<24}{'كان':>18}{'بقى':>10}")
            for doc, old, new in changed[: args.limit]:
                print(f"{doc:<24}{old:>18}{new:>10}")
            if len(changed) > args.limit:
                print(f"   … و{len(changed) - args.limit:,} أمر تاني")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتصلّح {len(changed):,}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
