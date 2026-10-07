"""يملأ جدول ربط أصناف a5 (`a5_item_link`) مرة واحدة — **قبل** توحيد الأصناف (٢٠٢٦-١٠-٠٧).

    python -m src.scripts.seed_a5_item_links --dir /opt/techno/a5october_20261006 --prefix ""   # عرض بس
    python -m src.scripts.seed_a5_item_links --dir /opt/techno/a5factory --prefix FC- --yes

بيقرا أصناف a5 (`a5_items.tsv`) وأكواد سطور المستندات (`a5_lines.tsv` لو موجود — صنف
اتمسح من a5 وعليه مستندات قديمة لسه محتاج ربط)، ويلاقي صنفنا بنفس الطريقة اللي المزامنة
بتستخدمها النهارده (الكود ثم الاسم). اللي اتلقى بيتربط؛ اللي مااتلقاش بيتقال ومابيتعملش له
صنف هنا — ده شغل المزامنة.

التشغيل مرتين آمن: اللي اتربط قبل كده بيتساب.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.scripts.import_a5 import _clean, _read, mine
from src.services.a5_item_map import A5ItemMap

# أعمدة a5_lines.tsv — زي import_a5_docs.
L_CODE, L_NAME = 7, 8


def run(folder: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        m = A5ItemMap(db, prefix, mine(db.scalars(select(Item)).all(), prefix))
        seen: set[tuple[str, str]] = set()
        made, already, missing = Counter(), 0, []

        def take(code, name, a5_id=None, source=""):
            nonlocal already
            code, name = _clean(code), _clean(name)
            if not (code or name) or (code, name) in seen:
                return
            seen.add((code, name))
            if m.linked(code, name) is not None:
                already += 1
                return
            it = m.find(code, name)
            if it is None:
                missing.append((source, code, name))
                return
            if m.remember(code, name, it, a5_id):
                made[source] += 1

        items_path = os.path.join(folder, "a5_items.tsv")
        if not os.path.exists(items_path):
            print(f"مافيش {items_path}")
            return 2
        for r in _read(items_path):
            if len(r) >= 4 and r[0].strip().isdigit():
                take(r[2], r[3], int(r[0]), "أصناف")
        lines_path = os.path.join(folder, "a5_lines.tsv")
        if os.path.exists(lines_path):
            for r in _read(lines_path):
                if len(r) > L_NAME:
                    take(r[L_CODE], r[L_NAME], None, "سطور مستندات")

        print(f"البادئة «{prefix}»: ربط جديد {sum(made.values())} {dict(made)} · مربوط قبل كده {already}"
              f" · مالقيتلوش صنف {len(missing)}")
        for src, code, name in missing[:20]:
            print(f"   مش لاقي: [{src}] {code} — {name}")
        if not execute:
            db.rollback()
            print("عرض بس — `--yes` للتنفيذ.")
            return 0
        db.commit()
        print("✔ اتحفظ.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--dir" not in a or "--prefix" not in a:
        print("لازم --dir و--prefix.")
        sys.exit(2)
    sys.exit(run(a[a.index("--dir") + 1], a[a.index("--prefix") + 1], "--yes" in a))
