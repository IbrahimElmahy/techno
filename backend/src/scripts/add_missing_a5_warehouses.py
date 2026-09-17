"""مخزن موجود في a5 ومالوش نظير عندنا — بيتعمل بنفس اسمه. درايَ-رن بالافتراضي.

    python -m src.scripts.add_missing_a5_warehouses --dir C:/pgtmp --branch أكتوبر
    python -m src.scripts.add_missing_a5_warehouses --dir C:/pgtmp --branch أكتوبر --yes

---------------------------------------------------------------------------
**المشكلة اللي بيحلها.** `import_a5_docs._transfer` بيرفض الإذن كله لو مخزن المصدر أو
الوجهة مش موجود عندنا — «مخزن مش موجود». فالبضاعة اللي خرجت من مخزن عندنا وراحت لمخزن
إحنا مش شايفينه **مابتخرجش عندنا**، والرصيد بيفضل أعلى من a5 من غير سبب ظاهر.

اتقاس على قاعدة السيرفر: مخزن واحد ناقص (**«مخزن احمد دسوقى»** في أكتوبر) بيوقّف
**٣ تحويلات** فيها **٤٠ صنف** و**٣٩٨ وحدة**. والعلياء مافيهاش ولا واحد.

**الاسم زي ما هو بالحرف.** المطابقة في المستورد بالاسم المنضّف (`_clean`) والمقارنة
نصّية، فأي تعديل في الاسم — حتى مسافة — بيخلّي الإذن يترفض تاني وإحنا فاكرين إننا
صلّحنا.

**بيتعمل «مخزن فرع» مش عهدة.** العهدة عندنا بتتربط بمندوب وبحساب في الشجرة، والاتنين
مش معروفين من التصدير: a5 بيدّي اسم المخزن وبس. اختراع الربط بيعمل عهدة على مندوب
مالوش علاقة، وده أوحش من مخزن عادي بالاسم الصح. لو طلع عهدة فعلاً، بيتحوّل من الشاشة
بعدين — والحركة اللي دخلت عليه بتفضل مكانها.

⛔ **بيعمل اللي في التصدير وبس.** مافيش مخزن بيتعمل من اسم مكتوب بالإيد، ومافيش مخزن
موجود بيتلمس.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.org import Branch
from src.models.warehouse import Warehouse, WarehouseType
from src.scripts.import_a5 import _clean, _money, _read
from src.scripts.import_a5_docs import KIND, L_AZN, L_IN, L_NAME, L_OUT, L_QTY, L_TYPE


def run(folder: str, *, branch_name: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None:
            print(f"الفرع «{branch_name}» مش موجود.")
            return 2

        ours = {w.name.strip() for w in db.scalars(select(Warehouse)).all()}
        rows = defaultdict(int)
        qty: dict[str, Decimal] = defaultdict(Decimal)
        items: dict[str, set] = defaultdict(set)
        docs: dict[str, set] = defaultdict(set)

        for r in _read(os.path.join(folder, "a5_lines.tsv")):
            if len(r) <= L_QTY:
                continue
            q = Decimal(str(_money(r[L_QTY])))
            for col in (L_IN, L_OUT):
                nm = _clean(r[col])
                if not nm or nm in ours:
                    continue
                rows[nm] += 1
                qty[nm] += q
                items[nm].add(_clean(r[L_NAME]))
                docs[nm].add((r[L_TYPE].strip(), r[L_AZN].strip()))

        if not rows:
            print("كل مخازن a5 موجودة عندنا — مافيش حاجة تتعمل.")
            return 0

        print(f"مخازن في a5 ومش عندنا: {len(rows)}   (الفرع: {branch_name})\n")
        for nm, n in sorted(rows.items(), key=lambda x: -x[1]):
            kinds = defaultdict(int)
            for t, _a in docs[nm]:
                kinds[KIND.get(t, (t,))[0]] += 1
            what = " · ".join(f"{k} {v}" for k, v in sorted(kinds.items()))
            print(f"   «{nm}»")
            print(f"      {n} صف · {len(items[nm])} صنف · كمية {qty[nm]} · {what or '—'}")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            return 0

        for nm in rows:
            db.add(Warehouse(
                name=nm, warehouse_type=WarehouseType.branch, branch_id=branch.id,
                description="اتعمل من تصدير a5 — مخزن موجود عندهم وماكانش عندنا",
                active=True))
        db.commit()
        print(f"\nاتعمل {len(rows)} مخزن.")
        print("شغّل `rebuild_a5_docs` بعده عشان المستندات اللي اترفضت تنزل.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    if not branch:
        print("لازم --branch (اسم الفرع اللي المخزن يتبعه).")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, execute="--yes" in args))
