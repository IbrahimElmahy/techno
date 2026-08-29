"""يشغّل دمج «تكنو فلان» مع «فلان» — عرض أولاً، وتنفيذ بـ--yes.

المنطق كله في `customer_merge_service`؛ ده بس اللي بينده عليه ويطبع النتيجة، عشان الدمج
يتعمل من سطر الأوامر زي باقي خطوات النقل بدل ما يتنده من الشاشة.

    python -m src.scripts.merge_a5_customers          # يعرض الخطة بس
    python -m src.scripts.merge_a5_customers --yes    # ينفّذ
"""
from __future__ import annotations

import sys

from src.core.db import SessionLocal
from src.services import customer_merge_service


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        p = customer_merge_service.plan(db)
        print(f"أزواج هتتدمج:        {len(p.pairs):>6}")
        print(f"«تكنو» من غير أصل:   {len(p.techno_only):>6}   (هيتشال «تكنو» من اسمه)")
        print(f"اتخطّى:              {len(p.skipped):>6}")
        if p.pairs:
            print("\nعيّنة:")
            for pair in p.pairs[:8]:
                same = "نفس المندوب" if pair.same_rep else "مندوب مختلف"
                print(f"   «{pair.merge_name}» ← «{pair.keep_name}»  ({same})")
        if p.skipped:
            print(f"\nاتخطّى ({len(p.skipped)}):")
            for name, why in p.skipped[:10]:
                print(f"   {name}: {why}")
            if len(p.skipped) > 10:
                print(f"    … و{len(p.skipped) - 10} غيرهم")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        result = customer_merge_service.apply(db, dry_run=False)
        db.commit()
        print(f"\nاتدمج دلوقتي: {result['merged_now']}   فاضل: {result['remaining']}")
        moved = result.get("documents_moved") or {}
        if moved:
            print("\nمستندات اتنقلت للعميل الباقي:")
            for table, n in sorted(moved.items(), key=lambda x: -x[1]):
                print(f"   {table:<22}{n:>7}")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
