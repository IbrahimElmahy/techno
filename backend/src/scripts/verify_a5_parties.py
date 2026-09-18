"""يقارن كروت العملاء والموردين عندنا بـa5 — بالكود وبالاسم. قراءة بس.

    python -m src.scripts.verify_a5_parties --dir C:/pgtmp
    python -m src.scripts.verify_a5_parties --dir C:/pgtmp/aliaa --prefix AL-

بيخرج بكود ١ لو فيه كارت عند a5 مش عندنا — عشان يبقى بوابة قبل التشغيل.

---------------------------------------------------------------------------
**الكارت اللي ناقص مش زي الكارت اللي اسمه مختلف.** الناقص معناه إن فاتورة جاية ليه
مالهاش مكان تقع فيه. والاسم المختلف غالباً دمج اتعمل عن قصد (`merge_a5_customers`)
أو تنضيف كتابة — فالاتنين بيتعدّوا في قايمتين مختلفتين، واللي بيراجع يقرر.

**والمقارنة بالكود الأول.** الاسم في a5 بيتكتب بأكتر من صورة لنفس التاجر، والمطابقة
بالاسم لوحدها بتطلّع «ناقص» على كارت موجود باسم تاني — نفس مصيدة `seed_item_points`.
الاسم بيتطبّع (أ/إ/آ ⇐ ا، ى ⇐ ي، ة ⇐ ه) قبل أي مقارنة.

**الكارت اللي عندنا ومش عند a5 مش خطأ بالضرورة**: عميل اتسجّل عندنا بعد النقل. بيتعدّ
ويتقال من غير ما يفشّل الفحص.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.lib.item_points import normalize
from src.models.customer import Customer
from src.models.supplier import Supplier
from src.scripts.import_a5 import _clean, _read


def _a5_parties(folder: str) -> list[tuple[str, str]]:
    """(الكود، الاسم) من كشف عملاء a5 — أول عمودين زي ما المستورد بيقراهم."""
    path = os.path.join(folder, "a5_cust.tsv")
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — شغّل a5_sync.ps1 -ExportOnly الأول.")
    out: list[tuple[str, str]] = []
    for row in _read(path):
        if len(row) < 2:
            continue
        code, name = _clean(row[0]), _clean(row[1])
        if not (code or name):
            continue
        out.append((code, name))
    return out


def run(folder: str, prefix: str) -> int:
    db = SessionLocal()
    try:
        customers = db.scalars(select(Customer)).all()
        suppliers = db.scalars(select(Supplier)).all()

        by_code: dict[str, object] = {}
        by_name: dict[str, list] = defaultdict(list)
        for party in [*customers, *suppliers]:
            code = getattr(party, "code", None)
            if code:
                by_code[str(code)] = party
            by_name[normalize(getattr(party, "name", ""))].append(party)

        theirs = _a5_parties(folder)
        matched_code = matched_name = merged = 0
        missing: list[tuple[str, str]] = []
        seen: set[int] = set()

        for code, name in theirs:
            hit = by_code.get(f"{prefix}{code}") or by_code.get(code)
            if hit is not None:
                matched_code += 1
            else:
                candidates = by_name.get(normalize(name)) or []
                hit = candidates[0] if candidates else None
                if hit is not None:
                    matched_name += 1
            if hit is None:
                # **«تكنو فلان» و«فلان» شخص واحد.** النظام القديم مكانش بيدّي العميل غير
                # حساب مديونية واحد، فبيع خطّين ليه معناه فتحه مرتين: «محمد عامر» للأبيض
                # و«تكنو محمد عامر» للبولي. الدمج لمّهم في كارت واحد بحسابين عيلة —
                # فالكارت «الناقص» ده موجود، بالاسم اللي بعد الدمج.
                stripped = normalize(name)
                for lead in ("تكنو ", "تكنوو "):
                    if stripped.startswith(normalize(lead)):
                        stripped = stripped[len(normalize(lead)):].strip()
                        break
                candidates = by_name.get(stripped) or []
                hit = candidates[0] if candidates else None
                if hit is not None:
                    merged += 1
            if hit is None:
                missing.append((code, name))
            else:
                seen.add(id(hit))

        extra = [p for p in [*customers, *suppliers] if id(p) not in seen]

        print("=" * 56)
        print(f"{'كروت a5 في الكشف':<34}{len(theirs):>8}")
        print("-" * 56)
        print(f"{'اتطابقت بالكود':<34}{matched_code:>8}")
        print(f"{'اتطابقت بالاسم':<34}{matched_name:>8}")
        print(f"{'اتطابقت بعد شيل «تكنو» (دمج)':<34}{merged:>8}")
        print(f"{'ناقصة عندنا':<34}{len(missing):>8}")
        print("-" * 56)
        print(f"{'كروتنا (عملاء + موردين)':<34}{len(customers) + len(suppliers):>8}")
        print(f"{'  عندنا ومش في كشف a5':<34}{len(extra):>8}")

        if missing:
            print(f"\n— ناقصة عندنا ({len(missing)}):")
            for code, name in missing[:40]:
                print(f"   {code:<14}{name}")
            if len(missing) > 40:
                print(f"   … و{len(missing) - 40} غيرهم")

        if extra:
            print(f"\n— عندنا ومش في كشف a5 ({len(extra)}) — مش غلط بالضرورة:")
            for party in extra[:20]:
                print(f"   {getattr(party, 'code', '') or '—':<14}{getattr(party, 'name', '')}")
            if len(extra) > 20:
                print(f"   … و{len(extra) - 20} غيرهم")

        return 1 if missing else 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    pfx = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    raise SystemExit(run(folder, pfx))
