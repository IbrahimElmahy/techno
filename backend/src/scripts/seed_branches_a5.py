"""يعمل الفروع اللي بتقابل قواعد a5، ويسمّي الفرع اللي الداتا قاعدة عليه صح.

a5 عنده قاعدة بيانات لكل شركة لكل سنة: `Techno2026` و`aliaa2026`. عندنا فرع واحد اسمه
«الفرع الرئيسي» وكل داتا `Techno2026` قاعدة عليه بالفعل — فبدل ما ننقل ٢٠٠٠ صف من فرع
لفرع، الفرع بيتسمّى «أكتوبر» وخلاص. الاسم بيتغيّر، والمفاتيح مابتتلمسش.

    python -m src.scripts.seed_branches_a5              # يعرض بس
    python -m src.scripts.seed_branches_a5 --yes        # ينفّذ

بيتعاد تشغيله بأمان.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.org import Branch, Governorate

# الفرع القديم → اسمه الجديد. «الفرع الرئيسي» هو اللي داتا Techno2026 قاعدة عليه.
RENAME = {"الفرع الرئيسي": "أكتوبر"}

# الفروع اللي لازم تبقى موجودة، وكل واحد ومحافظته.
BRANCHES = [("أكتوبر", "الجيزة"), ("العلياء", "الجيزة"), ("السادات", "المنوفية")]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        existing = {b.name: b for b in db.scalars(select(Branch)).all()}
        plan: list[str] = []
        # الملخّص بيتحسب على الحالة **بعد** التسمية، مش قبلها — وإلا بيقول إنه هيعمل فرع
        # «أكتوبر» وهو أصلاً الفرع اللي اتسمّى.
        after = set(existing)
        for old, new in RENAME.items():
            if old in after and new not in after:
                plan.append(f"يسمّي «{old}» ← «{new}» (الداتا مابتتحركش)")
                after.discard(old)
                after.add(new)
        for name, gov in BRANCHES:
            if name not in after:
                plan.append(f"يعمل فرع «{name}» في «{gov}»")
                after.add(name)

        print("الفروع دلوقتي:")
        for b in db.scalars(select(Branch).order_by(Branch.id)).all():
            print(f"   {b.id:>3} {b.name}")
        print("\nاللي هيحصل:")
        for line in plan or ["   مافيش — كله موجود"]:
            print(f"   {line}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        govs = {g.name: g for g in db.scalars(select(Governorate)).all()}

        def gov_id(name: str) -> int:
            g = govs.get(name)
            if g is None:
                g = Governorate(name=name)
                db.add(g)
                db.flush()
                govs[name] = g
            return g.id

        # التسمية الأول: الفرع القديم بيبقى «أكتوبر»، فاللي بعده مايعملوش واحد تاني بنفس الاسم.
        for old, new in RENAME.items():
            b = existing.get(old)
            if b is not None and new not in existing:
                b.name = new
                existing[new] = b
                del existing[old]
                print(f"   اتسمّى: {old} ← {new}")
        db.flush()

        for name, gov in BRANCHES:
            b = existing.get(name)
            if b is None:
                b = Branch(name=name, governorate_id=gov_id(gov), active=True)
                db.add(b)
                db.flush()
                existing[name] = b
                print(f"   اتعمل: {name}")
            elif b.governorate_id is None:
                b.governorate_id = gov_id(gov)

        db.commit()
        print("\nالفروع بعد التنفيذ:")
        for b in db.scalars(select(Branch).order_by(Branch.id)).all():
            g = db.get(Governorate, b.governorate_id) if b.governorate_id else None
            print(f"   {b.id:>3} {b.name:<14}{g.name if g else '—'}")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
