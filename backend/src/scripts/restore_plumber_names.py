"""يرجّع أسماء السباكين للعمود الأصلي في ملف العميل (`Name_Ar`).

    python -m src.scripts.restore_plumber_names --dir C:/pgtmp/wb2          # يعرض بس
    python -m src.scripts.restore_plumber_names --dir C:/pgtmp/wb2 --yes    # ينفّذ

بيتعاد تشغيله بأمان: المطابقة بالكود، واللي اسمه مظبوط بيتساب.

---------------------------------------------------------------------------
صفحة «سباك» فيها عمودين اسم: `Name_Ar` («فنى ابراهيم البنا») و`Name_En` اللي رغم
اسمه عربي وبلا البادئة («ابراهيم البنا»). `import_wb_plumbers` كان بياخد `Name_En`
— وده كان اختيار غلط لسببين:

* **`Name_En` ناقص.** ٨٥ صف من ١٬٦٨٥ مش مجرد `Name_Ar` بلا البادئة: أسماء مقصوصة
  («فنى احمد رجب زلط» → «احمد زلط»)، وواحد اسمه مختلف خالص («فنى رجب شعبان» →
  «احمد شعبان»). `Name_Ar` هو العمود الكامل.

* **التناقض مع الكوبونات.** مستندات الاستلام بتكتب في الملاحظات «الفني: {الاسم}»
  من `Name_Ar` — فنفس الراجل كان بيطلع باسمين في شاشتين.

الكود (`WB-P-{Code}`) هو المطابقة، فالاسم بيتصحّح من غير ما يتلمس أي ربط.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer

CODE_PREFIX = "WB-P-"


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "plumbers.tsv"))

    db = SessionLocal()
    try:
        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        plan: list[tuple[Customer, str, str]] = []
        notes: Counter = Counter()

        for r in rows:
            if r.get("kind") != "سباك":
                continue
            code, want = r.get("code", ""), r.get("name", "")
            if not code or not want:
                notes["صف بلا كود أو اسم"] += 1
                continue
            c = by_code.get(CODE_PREFIX + code)
            if c is None:
                notes["كارت مش عندنا"] += 1
                continue
            if c.name == want:
                notes["الاسم مظبوط خلاص"] += 1
                continue
            plan.append((c, c.name, want))

        print(f"صفوف السباكين: {sum(1 for r in rows if r.get('kind') == 'سباك')}")
        for k, v in notes.most_common():
            print(f"   {k:<32}{v:>7}")
        print(f"   {'اسم هيترجّع':<32}{len(plan):>7}")
        # اللي البادئة بس هي الفرق، واللي فيه فرق أعمق — الفرق التاني هو اللي
        # يستاهل عين، لأنه كان بيقصّ الاسم مش بيشيل كلمة.
        deep = [(c, o, w) for c, o, w in plan if w != f"فنى {o}"]
        print(f"   {'منها فرقها البادئة بس':<32}{len(plan) - len(deep):>7}")
        print(f"   {'منها الاسم نفسه كان ناقص':<32}{len(deep):>7}")
        if deep:
            print("\n   عيّنة من الناقص:")
            for c, o, w in deep[:15]:
                print(f"      {c.code:<14} [{o}]  →  [{w}]")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, _, want in plan:
            c.name = want[:160]
        db.commit()

        n = db.scalar(select(func.count()).select_from(Customer)
                      .where(Customer.code.like(f"{CODE_PREFIX}%"))) or 0
        bad = db.scalar(select(func.count()).select_from(Customer)
                        .where(Customer.code.like(f"{CODE_PREFIX}%"),
                               Customer.name.not_like("فنى %"))) or 0
        print(f"\n✔ اترجّع {len(plan)} اسم")
        print(f"   كروت السباكين: {n}   ·   منها اسمه مش مبتدي بـ«فنى»: {bad}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
