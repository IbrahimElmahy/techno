# -*- coding: utf-8 -*-
"""جرد أسماء حركة المخزون — في القاعدة وفي الكود — ومقارنتها بالسجل الموحّد.

    python -m src.scripts.audit_doc_types          # القاعدة + الكود
    python -m src.scripts.audit_doc_types --code   # الكود بس (من غير قاعدة)

بيعمل حاجتين:

* **يقرا القاعدة** ويعدّ كل قيمة في `source_doc_type` و`movement_type`، ويعلّم اللي
  مش في `stock_docs` أو اللي لسه باسم قديم.
* **يقرا الكود** ويطلّع كل نص حرفي بيتكتب في الخانتين دول، ويتأكد إنه مسجّل. ده اللي
  بيمنع تكرار المشكلة: نوع جديد يتكتب في خدمة ويتنسى من السجل بيطلع هنا، مش بعد سنة
  في كارت صنف فاضي.

العرض بس — مابيكتبش حاجة في القاعدة.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from src.lib import stock_docs

#: `movement_type="x"` أو `source_doc_type='x'` — النص الحرفي وحده.
_LITERAL = re.compile(r"""(movement_type|source_doc_type)\s*=\s*["']([a-z0-9_]+)["']""")
#: مجلدات السكربتات القديمة — بتكتب أسماء نقل قديمة عن قصد، ومش بتعدّي من الباب.
_SKIP = {"scripts"}


def _check_code() -> int:
    root = Path(__file__).resolve().parents[1]
    bad: list[tuple[str, int, str, str]] = []
    seen = 0
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if rel.parts[0] in _SKIP:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for field_name, value in _LITERAL.findall(line):
                seen += 1
                kind = "movement" if field_name == "movement_type" else "doc"
                if stock_docs.canonical(value, kind=kind) is None:
                    bad.append((str(rel), lineno, field_name, value))
    print(f"\n=== الكود ===\n   {seen} اسم حرفي متكتوب، منهم {len(bad)} مش في السجل")
    for rel, lineno, field_name, value in bad:
        print(f"   ✗ {rel}:{lineno}  {field_name}=\"{value}\"")
    return 1 if bad else 0


def _count(db, column, table_label: str) -> None:
    from sqlalchemy import func, select

    rows = db.execute(
        select(column, func.count()).group_by(column).order_by(func.count().desc())
    ).all()
    kind = "movement" if "movement_type" in table_label else "doc"
    print(f"\n=== {table_label} ===")
    for value, n in rows:
        flag = ""
        if value is not None:
            known = stock_docs.canonical(value, kind=kind)
            if known is None:
                flag = "  ← مش في السجل"
            elif known != value:
                flag = f"  ← اسم قديم، الموحّد {known}"
        print(f"   {str(value):<28}{n:>9,}{flag}   {stock_docs.label(value, kind=kind)}")


def _check_db() -> None:
    from src.core.db import SessionLocal
    from src.models.stock import StockMovement

    db = SessionLocal()
    try:
        _count(db, StockMovement.source_doc_type, "stock_movement.source_doc_type")
        _count(db, StockMovement.movement_type, "stock_movement.movement_type")
        try:
            from src.models.catalog import StockBatchMovement

            _count(db, StockBatchMovement.document_type,
                   "stock_batch_movement.document_type")
        except Exception as exc:  # noqa: BLE001
            print(f"\n(الدفعات: {exc})")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="جرد أسماء حركة المخزون")
    ap.add_argument("--code", action="store_true", help="الكود بس، من غير قاعدة")
    args = ap.parse_args()
    if not args.code:
        _check_db()
    sys.exit(_check_code())


if __name__ == "__main__":
    main()
