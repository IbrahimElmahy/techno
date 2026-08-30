"""يملا `product_point_value` من ملف قيم النقاط اللي جه من العميل.

    python -m src.scripts.seed_item_points --file C:/pgtmp/points.tsv
    python -m src.scripts.seed_item_points --file C:/pgtmp/points.tsv --yes

الملف ٣ أعمدة مفصولة tab: العائلة، اسم الصنف، قيمة النقطة. المطابقة بالاسم على `item`.

**التطبيع مش رفاهية.** الأسماء في الملف والكتالوج مكتوبة بأيادي مختلفة على مدى سنين:
«أ/إ/آ» في مقابل «ا»، «ى» في مقابل «ي»، «ة» في مقابل «ه»، تشكيل وتطويل، ومسافتين
مكان واحدة. من غير التطبيع المطابقة بتطلع أرقام ضعيفة والسكربت بيقول «تمام» وهو فاضي —
نفس المصيدة اللي وقعنا فيها مع فئات الكوبونات بالظبط.

**الاسم المكرر في الكتالوج بياخد النقطة على كل كروته.** ٦٩ اسم في الملف بيقابل أكتر من
كارت صنف (نفس المنتج متسجّل مرتين بفروق فرع/وحدة). اختيار كارت واحد منهم معناه إن نص
فواتير المنتج ده مش هتكسب نقط، والفرق مش هيبان في أي شاشة — هيبان في شكوى تاجر بعد شهور.
القايمة بتتطبع كاملة عشان اللي بيراجع يشوف على إيه اتحطت النقطة.

Idempotent: بيعيد الكتابة على نفس الكارت مش بيضيف صف جديد.
"""
from __future__ import annotations

import io
import re
import sys
import unicodedata
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.loyalty import ProductPointValue

# التشكيل + التطويل. بيتشالوا قبل أي استبدال تاني عشان «هَاء» و«هاء» يبقوا حاجة واحدة.
_MARKS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]")

# الحروف اللي بتتكتب بأكتر من صورة. المفتاح الصورة الغريبة، القيمة الصورة الموحّدة.
_FOLD = {
    "\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627", "\u0671": "\u0627",  # أ إ آ ٱ → ا
    "\u0649": "\u064a", "\u06cc": "\u064a",                                          # ى ی → ي
    "\u0629": "\u0647",                                                              # ة → ه
    "\u06a9": "\u0643",                                                              # ک → ك
}


def normalize(name: str) -> str:
    """اسم الصنف في صورة واحدة يتقارن بيها."""
    text = unicodedata.normalize("NFKC", str(name or ""))
    text = _MARKS.sub("", text)
    for src, dst in _FOLD.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip().lower()


def _read_rows(path: str) -> list[tuple[str, str, Decimal]]:
    rows: list[tuple[str, str, Decimal]] = []
    with io.open(path, encoding="utf-8-sig") as handle:
        for lineno, raw in enumerate(handle, 1):
            line = raw.rstrip("\r\n")
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                print(f"  ⚠ سطر {lineno} مالوش ٣ أعمدة — اتجاهل: {line[:60]}")
                continue
            family, name, value = parts[0].strip(), parts[1].strip(), parts[2].strip()
            try:
                points = Decimal(value)
            except InvalidOperation:
                print(f"  ⚠ سطر {lineno} قيمة النقطة مش رقم ({value!r}) — اتجاهل.")
                continue
            if points < 0:
                print(f"  ⚠ سطر {lineno} قيمة النقطة سالبة — اتجاهل.")
                continue
            rows.append((family, name, points))
    return rows


def run(path: str, *, execute: bool) -> None:
    rows = _read_rows(path)
    print(f"سطور الملف: {len(rows)}")

    db = SessionLocal()
    try:
        by_name: dict[str, list[Item]] = defaultdict(list)
        for item in db.scalars(select(Item)).all():
            by_name[normalize(item.name)].append(item)

        existing = {ppv.item_id: ppv for ppv in db.scalars(select(ProductPointValue)).all()}

        one_to_one = 0
        duplicated: list[tuple[str, list[Item]]] = []
        missing: list[str] = []
        written = updated = unchanged = 0

        for _family, name, points in rows:
            hits = by_name.get(normalize(name), [])
            if not hits:
                missing.append(name)
                continue
            if len(hits) == 1:
                one_to_one += 1
            else:
                duplicated.append((name, hits))
            for item in hits:
                ppv = existing.get(item.id)
                if ppv is None:
                    ppv = ProductPointValue(item_id=item.id, point_value=points)
                    db.add(ppv)
                    existing[item.id] = ppv
                    written += 1
                elif Decimal(str(ppv.point_value)) != points:
                    ppv.point_value = points
                    updated += 1
                else:
                    unchanged += 1

        print()
        print("=" * 52)
        print("المطابقة بالاسم:")
        print("=" * 52)
        print(f"{'تطابق واحد لواحد':<34}{one_to_one:>8}")
        print(f"{'اسم مكرر في الكتالوج':<34}{len(duplicated):>8}")
        print(f"{'مالوش مقابل في الكتالوج':<34}{len(missing):>8}")
        print("-" * 52)
        print(f"{'كروت أصناف هتاخد نقطة':<34}{written + updated + unchanged:>8}")
        print(f"{'  جديد':<34}{written:>8}")
        print(f"{'  اتعدّل':<34}{updated:>8}")
        print(f"{'  زي ما هو':<34}{unchanged:>8}")

        if duplicated:
            print()
            print(f"— أسماء مكررة في الكتالوج ({len(duplicated)}): النقطة اتحطّت على كل الكروت")
            for name, hits in duplicated:
                ids = ", ".join(str(i.id) for i in hits)
                print(f"   {name}  →  {len(hits)} كارت (#{ids})")

        if missing:
            print()
            print(f"— مالهاش مقابل في الكتالوج ({len(missing)}): مافيش نقط اتحطّت ليها")
            for name in missing:
                print(f"   {name}")

        if not execute:
            print("\n[عرض فقط — DRY RUN] مافيش حاجة اتحفظت. ضيف --yes للتنفيذ الفعلي.")
            return

        db.commit()
        print("\n✔ اتحفظت قيم النقاط.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    file_path = args[args.index("--file") + 1] if "--file" in args else "C:/pgtmp/points.tsv"
    run(file_path, execute="--yes" in args)
