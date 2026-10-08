from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.models.stock_permit import StockPermit, StockPermitLine
from src.models.transfer import StockTransfer, StockTransferLine
from src.scripts.import_a5 import _clean, _money, _read, mine
from src.scripts.import_a5_docs import (
    KIND,
    L_CODE,
    L_DATE,
    L_NAME,
    L_QTY,
    L_TYPE,
    _doc_key,
)
from src.scripts.verify_a5_stock_by_store import _fold_transfers

ZERO = Decimal("0")

TABLES = {
    "7": (SalesInvoice, SalesInvoiceLine, "invoice_id"),
    "2": (SalesReturn, SalesReturnLine, "return_id"),
    "1": (PurchaseInvoice, PurchaseInvoiceLine, "invoice_id"),
    "11": (PurchaseReturn, PurchaseReturnLine, "return_id"),
    "6": (StockTransfer, StockTransferLine, "transfer_id"),
    "3": (StockPermit, StockPermitLine, "permit_id"),
    "8": (StockPermit, StockPermitLine, "permit_id"),
}


class Drift:
    def __init__(self, a5_type: str, label: str, number: str, doc_date: str,
                 theirs: dict[int, Decimal], ours: dict[int, Decimal]) -> None:
        self.a5_type = a5_type
        self.label = label
        self.number = number
        self.doc_date = doc_date
        self.theirs = theirs
        self.ours = ours


def _ours(db, t: str, number: str) -> tuple[object | None, dict[int, Decimal]]:
    head_cls, line_cls, fk = TABLES[t]
    head = db.scalar(select(head_cls).where(head_cls.document_number == number))
    if head is None:
        return None, {}
    qty: dict[int, Decimal] = defaultdict(Decimal)
    for ln in db.scalars(select(line_cls).where(getattr(line_cls, fk) == head.id)).all():
        qty[ln.item_id] += Decimal(str(ln.quantity))
    if t == "6" and not qty and getattr(head, "item_id", None):
        qty[head.item_id] = Decimal(str(head.quantity or 0))
    return head, dict(qty)


def collect(db, folder: str, prefix: str) -> tuple[list["Drift"], list[tuple[str, str, str]], int]:
    my_items = mine(db.scalars(select(Item)).all(), prefix)
    by_code = {i.code: i for i in my_items if i.code}
    by_name = {i.name: i for i in my_items}

    def resolve(r: list[str]) -> Item | None:
        return (by_code.get(f"{prefix}{_clean(r[L_CODE])}")
                or by_name.get(_clean(r[L_NAME])))

    lines = [r for r in _read(os.path.join(folder, "a5_lines.tsv"))
             if len(r) > L_QTY]

    rows_by_type = defaultdict(list)
    for r in lines:
        rows_by_type[r[L_TYPE].strip()].append(r)
    usable = []
    for t, rs in rows_by_type.items():
        if t not in TABLES:
            continue
        usable += _fold_transfers(rs) if t == "6" else rs

    docs: dict[tuple[str, str], list[list[str]]] = defaultdict(list)
    for r in usable:
        docs[(r[L_TYPE].strip(), _doc_key(r).strip())].append(r)

    drift: list[Drift] = []
    missing: list[tuple[str, str, str]] = []
    unresolved = 0

    for (t, azn), rows in sorted(docs.items(), key=lambda kv: kv[1][0][L_DATE]):
        label, tag, _tbl = KIND[t]
        number = f"{prefix}{tag}{azn}"
        head, ours = _ours(db, t, number)
        if head is None:
            missing.append((label, number, rows[0][L_DATE]))
            continue

        theirs: dict[int, Decimal] = defaultdict(Decimal)
        for r in rows:
            it = resolve(r)
            if it is None:
                unresolved += 1
                continue
            q = Decimal(str(_money(r[L_QTY])))
            if q <= ZERO:
                continue
            theirs[it.id] += q

        if dict(theirs) != ours:
            drift.append(Drift(t, label, number, rows[0][L_DATE], dict(theirs), ours))

    return drift, missing, unresolved


def run(folder: str, prefix: str) -> int:
    db = SessionLocal()
    try:
        drift, missing, unresolved = collect(db, folder, prefix)
        names = {i.id: i.name for i in db.scalars(select(Item)).all()}
        print(f"مستندات عندنا سطورها مختلفة عن a5: {len(drift)}")
        print(f"مستندات في a5 ومش عندنا خالص: {len(missing)}")
        if unresolved:
            print(f"سطور a5 مالهاش صنف عندنا: {unresolved}")

        by_kind: dict[str, int] = defaultdict(int)
        for d in drift:
            by_kind[d.label] += 1
        if by_kind:
            print("\nالمختلف بنوعه:")
            for k, n in sorted(by_kind.items(), key=lambda x: -x[1]):
                print(f"   {k:<18}{n:>6}")

        for d in drift:
            print(f"\n{d.label} {d.number}   {d.doc_date}")
            for item_id in sorted(set(d.theirs) | set(d.ours)):
                a = d.theirs.get(item_id, ZERO)
                b = d.ours.get(item_id, ZERO)
                if a == b:
                    continue
                print(f"   {names.get(item_id, item_id)[:36]:<38} a5={a:>10}  عندنا={b:>10}")

        if missing:
            print("\nمستندات مش عندنا خالص:")
            for label, number, dt in missing[:40]:
                print(f"   {label:<18}{number:<14}{dt}")
            if len(missing) > 40:
                print(f"   … و{len(missing) - 40} كمان")

        return 1 if (drift or missing) else 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    sys.exit(run(folder, prefix))
