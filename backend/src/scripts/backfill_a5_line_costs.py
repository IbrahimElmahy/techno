from __future__ import annotations

import argparse
import os
from collections import Counter
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.catalog import Item
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.scripts.import_a5 import _clean, _money, _read

(C_TYPE, C_DOC, C_CODE, C_QTY, C_TOTAL, C_UNIT) = range(6)

DOCS = {
    "7": ("S", SalesInvoice, SalesInvoiceLine, "invoice_id"),
    "2": ("SR", SalesReturn, SalesReturnLine, "return_id"),
}


def _unit_cost(r: list[str]) -> Decimal:
    qty = _money(r[C_QTY])
    total = _money(r[C_TOTAL])
    if qty and total:
        return to_money(total / qty)
    return to_money(_money(r[C_UNIT]))


def run(folder: str, *, execute: bool, prefix: str) -> None:
    rows = [r for r in _read(os.path.join(folder, "a5_cost.tsv")) if len(r) >= 6]
    cost_of: dict[tuple[str, str, str], Decimal] = {}
    for r in rows:
        c = _unit_cost(r)
        if c > 0:
            cost_of[(r[C_TYPE], _clean(r[C_DOC]), _clean(r[C_CODE]))] = c

    print("المصدر:")
    print(f"   سطور a5             {len(rows):>8,}")
    print(f"   منها بتكلفة         {len(cost_of):>8,}")

    db = SessionLocal()
    try:
        code_of = {i.id: i.code for i in db.scalars(select(Item)).all()}
        filled = Counter()
        missing = Counter()
        for a5_type, (letter, head, line, fk) in DOCS.items():
            docs = {d.document_number: d for d in db.scalars(
                select(head).where(head.document_number.like(f"{prefix}{letter}%"))).all()}
            if not docs:
                continue
            ids = {d.id: num for num, d in docs.items()}
            lines = db.scalars(select(line).where(
                getattr(line, fk).in_(list(ids)),
                line.unit_cost.is_(None))).all()
            for ln in lines:
                num = ids[getattr(ln, fk)]
                a5_doc = num[len(prefix) + len(letter):]
                code = (code_of.get(ln.item_id) or "")[len(prefix):]
                c = cost_of.get((a5_type, a5_doc, code))
                if c is None:
                    missing[letter] += 1
                    continue
                if execute:
                    ln.unit_cost = c
                filled[letter] += 1
        if execute:
            db.commit()

        print("\nالمستند              هيتملّى   مالوش تكلفة في a5")
        print("-" * 46)
        for letter in sorted(set(filled) | set(missing)):
            print(f"   {letter:<18}{filled[letter]:>8,}{missing[letter]:>18,}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. ضيف --yes للتنفيذ.")
        else:
            print(f"\n✓ اتملّى {sum(filled.values()):,} سطر.")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="ملء تكلفة سطور a5 الناقصة")
    ap.add_argument("--dir", required=True)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(a.dir, execute=a.yes, prefix=a.prefix)


if __name__ == "__main__":
    main()
