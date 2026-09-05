"""يصلّح مندوب البيع لتجار ERP الجدد — من الكارت الأصلي اللي الجسر بيشاور عليه.

    python -m src.scripts.fix_erp_trader_reps --dir C:/pgtmp/erp          # يعرض بس
    python -m src.scripts.fix_erp_trader_reps --dir C:/pgtmp/erp --yes    # ينفّذ

**اللي اتقاس:** نقل الأطراف حط كل كروت ERP الجديدة على أول مندوب في الفرع
(`car.b`) كحل مؤقت — فـ2367 طرف على راجل واحد. والتاجر ده له كارت a5 أصلي
(الجسر: مفتاح ERP ← كود a5)، وكارت a5 مندوبه سليم ومتحقق عليه (`fix_customer_reps`:
1427 صح و0 يتغيّر). فمندوب التاجر الجديد = مندوب كارت a5 بتاعه. نفس التاجر،
نفس المندوب — مش تخمين.

**اللي بره النطاق عمداً:** السباكين (ERP-P) مالهمش مندوب بيع عند a5 أصلاً —
مندوبهم هو مندوب الخدمة (`service_rep_id`، متربط لـ2222). والـ15 تاجر اللي
مالهمش كود a5 في الورقة بيتقالوا ومابيتلمسوش.

بيتعاد تشغيله بأمان.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer

FILENAME = "merchant_bridge.tsv"
# أعمدة الملف: code · dist_id · merch_id · a5_code · ...
(B_CODE, B_DIST, B_MERCH, B_A5) = range(4)


def run(folder: str, *, execute: bool) -> None:
    path = os.path.join(folder, FILENAME)
    if not os.path.exists(path):
        raise SystemExit("مافيش ملف الجسر: " + path)
    rows = []
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            if i == 0 or not line.strip():
                continue
            rows.append([c.strip() for c in line.rstrip("\n").split("\t")])

    # مفتاح ERP (ERP-M-id / ERP-D-id) ← كود a5
    key_to_a5: dict[str, str] = {}
    for r in rows:
        if len(r) < 4:
            continue
        if r[B_MERCH]:
            key_to_a5[f"ERP-M-{r[B_MERCH]}"] = r[B_A5]
        if r[B_DIST]:
            key_to_a5[f"ERP-D-{r[B_DIST]}"] = r[B_A5]

    db = SessionLocal()
    try:
        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        plan: list[tuple[Customer, int, str]] = []
        no_bridge: list[str] = []
        no_a5card: list[str] = []
        same = 0
        kinds = Counter()
        for code, cust in by_code.items():
            if not (code.startswith("ERP-M-") or code.startswith("ERP-D-")):
                continue
            kinds[cust.customer_type] += 1
            a5code = key_to_a5.get(code)
            if not a5code:
                no_bridge.append(f"{code} «{cust.name}»")
                continue
            target = by_code.get(a5code)
            if target is None:
                no_a5card.append(f"{code} «{cust.name}» → {a5code} مش في الكشف")
                continue
            if cust.rep_id == target.rep_id:
                same += 1
                continue
            plan.append((cust, target.rep_id, a5code))

        users_rep = {}
        if plan:
            from src.models.user import User
            users_rep = {u.id: u.full_name for u in db.scalars(select(User)).all()}

        print(f"كروت تجار ERP: {sum(kinds.values())} ({dict(kinds)})")
        print(f"   هيتظبط مندوبهم: {len(plan)}")
        print(f"   مندوبهم صح خلاص: {same}")
        moves = Counter((c.rep_id, r) for c, r, _a in plan)
        if moves:
            from src.models.user import User as _U
            unames = {u.id: u.full_name for u in db.scalars(select(_U)).all()}
            print("\nأكبر التحويلات (من → إلى):")
            for (frm, to), n in moves.most_common(8):
                print(f"   {str(unames.get(frm))[:24]:<26} ← {str(unames.get(to))[:24]:<26}{n:>6}")
        if no_bridge:
            print(f"\n⚠️ {len(no_bridge)} كارت مالوش مفتاح في الجسر — مش هيتلمس (منهم الـ15 من غير كود a5):")
            for s in no_bridge[:10]:
                print(f"   {s}")
        if no_a5card:
            print(f"\n⚠️ {len(no_a5card)} كارت كود a5 بتاعه مش في الكشف:")
            for s in no_a5card[:10]:
                print(f"   {s}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return
        for cust, rep_id, _a in plan:
            cust.rep_id = rep_id
        db.commit()
        print(f"\n✔ اتظبط مندوب {len(plan)} تاجر.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    target_dir = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/erp"
    run(target_dir, execute="--yes" in args)
