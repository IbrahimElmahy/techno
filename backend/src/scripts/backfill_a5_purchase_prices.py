from __future__ import annotations

import argparse
import os
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.catalog import Item
from src.scripts.import_a5 import _clean, _money, _read

I_ID, I_CODE, I_NAME, I_LASTPRICE = 0, 2, 3, 10


def run(folder: str, *, execute: bool, prefix: str, overwrite: bool) -> None:
    rows = [r for r in _read(os.path.join(folder, "a5_items.tsv"))
            if len(r) > I_LASTPRICE and r[I_ID].isdigit()]
    price_of: dict[str, Decimal] = {}
    name_price: dict[str, Decimal] = {}
    for r in rows:
        p = to_money(_money(r[I_LASTPRICE]))
        if p <= 0:
            continue
        code = _clean(r[I_CODE])
        if code:
            price_of[f"{prefix}{code}"] = p
        name_price.setdefault(_clean(r[I_NAME]), p)

    print("المصدر:")
    print(f"   أصناف في الملف        {len(rows):>7,}")
    print(f"   منها بسعر شرا         {len(price_of):>7,}")

    db = SessionLocal()
    try:
        items = db.scalars(select(Item)).all()
        filled = skipped_have = no_source = 0
        for it in items:
            if it.purchase_price is not None and not overwrite:
                if it.code in price_of:
                    skipped_have += 1
                continue
            p = price_of.get(it.code)
            if p is None and prefix and it.code.startswith(prefix):
                p = name_price.get(it.name)
            if p is None:
                if it.code.startswith(prefix):
                    no_source += 1
                continue
            if execute:
                it.purchase_price = p
            filled += 1
        if execute:
            db.commit()

        print("\nالنتيجة")
        print("-" * 34)
        print(f"{'هيتملّى':<24}{filled:>8,}")
        print(f"{'عنده سعر خلاص':<24}{skipped_have:>8,}")
        print(f"{'a5 مالوش سعر ليه':<24}{no_source:>8,}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. ضيف --yes للتنفيذ.")
        else:
            print(f"\n✓ اتملّى {filled:,} صنف.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="ملء سعر شرا الصنف من a5")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--overwrite", action="store_true",
                    help="يكتب فوق السعر الموجود كمان")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(a.dir, execute=a.yes, prefix=a.prefix, overwrite=a.overwrite)


if __name__ == "__main__":
    main()
