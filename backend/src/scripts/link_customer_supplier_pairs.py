# -*- coding: utf-8 -*-
"""الطرف اللي بنشتري منه وبنبيع له — كارتين لواحد، بيتوصّلوا.

    python -m src.scripts.link_customer_supplier_pairs
    python -m src.scripts.link_customer_supplier_pairs --branch السادات --yes

**المشكلة.** عند a5 الطرف كارت واحد: هو في `Mourd` وبس، وفاتورة البيع له بتتكتب
بـ`Cust_id = 0` — اسمه على الورقة والقيد على حسابه هو. قِسناها: مافيش ولا اسم واحد
موجود في `Cust` و`Mourd` مع بعض في قاعدة المصنع، والعشر فواتير اللي طرفها مورد كلها
`Cust_id = 0`.

وعندنا الفاتورة **لازم** يكون ليها عميل — `import_a5_docs.Ctx.party()` بيخترع كارت
لأي طرف على مستند مش في الكشف، بكود `A5X`. فالراجل بقى كارتين: كارت مورد عليه
مشترياتنا منه، وكارت عميل مخترع عليه مبيعاتنا له. و«هو عليه كام؟» بقى ليها إجابتين
مالهمش طريق يتجمعوا.

**والحل رابط، مش مسح.** الفواتير متعلّقة بكارت العميل ومسحه بيضيّعها. الرابط بيخلّي
الشاشة تعرف إنهم واحد وتوصّل، والتقارير تبطّل تعدّه اتنين.

**والمطابقة بالاسم المجرّد، والمرشّح الواحد بس.** `arabic.bare` بيوحّد الهمزة والتاء
المربوطة، فـ«احمد» بتلاقي «أحمد». والاسم اللي بيتجرّد لأكتر من مورد بيتقال في الكشف
ومابيتربطش — ربط غلط أوحش من مافيش ربط، لأنه بيخبّي نفسه.
"""
from __future__ import annotations

import argparse
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.lib import arabic
from src.models.customer import Customer
from src.models.org import Branch
from src.models.supplier import Supplier


def main() -> None:
    ap = argparse.ArgumentParser(description="ربط كارت العميل بكارت المورد لنفس الطرف")
    ap.add_argument("--branch", help="اسم فرع معيّن — من غيره بيشتغل على الكل")
    ap.add_argument("--yes", action="store_true", help="نفّذ الربط")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        branch_id = None
        if args.branch:
            branch = db.scalars(select(Branch).where(Branch.name == args.branch)).first()
            if branch is None:
                raise SystemExit(f"مافيش فرع اسمه «{args.branch}».")
            branch_id = branch.id

        cstmt = select(Customer)
        sstmt = select(Supplier)
        if branch_id is not None:
            cstmt = cstmt.where(Customer.branch_id == branch_id)
            sstmt = sstmt.where(Supplier.branch_id == branch_id)
        customers = db.scalars(cstmt).all()
        suppliers = db.scalars(sstmt).all()

        # فهرس الموردين بالاسم المجرّد. الاسم اللي ليه أكتر من مورد بيتقال ومابيتربطش.
        by_bare: dict[str, list[Supplier]] = defaultdict(list)
        for s in suppliers:
            by_bare[arabic.bare(s.name or "")].append(s)

        linked: list[tuple] = []
        already: list[tuple] = []
        ambiguous: list[tuple] = []

        for c in customers:
            hits = by_bare.get(arabic.bare(c.name or ""), [])
            if not hits:
                continue
            if len(hits) > 1:
                ambiguous.append((c, hits))
                continue
            s = hits[0]
            if c.supplier_id == s.id:
                already.append((c, s))
                continue
            if c.supplier_id is not None:
                # مربوط بمورد تاني — قرار اتاخد قبل كده، ومابنكتبش فوقه.
                ambiguous.append((c, hits))
                continue
            linked.append((c, s))

        print(f"{'عملاء':<26}{len(customers):>7,}")
        print(f"{'موردين':<26}{len(suppliers):>7,}")
        print(f"{'هيتربطوا':<26}{len(linked):>7,}")
        print(f"{'مربوطين خلاص':<26}{len(already):>7,}")
        print(f"{'محتاجين مراجعة بالإيد':<26}{len(ambiguous):>7,}")

        if linked:
            print(f"\n{'كارت العميل':<16}{'كارت المورد':<16}الاسم")
            for c, s in linked:
                print(f"{(c.code or ''):<16}{(s.code or ''):<16}{c.name}")
        if ambiguous:
            print("\n--- مابتربطش: أكتر من مورد بنفس الاسم، أو مربوط بغيره ---")
            for c, hits in ambiguous:
                codes = "، ".join(s.code or "" for s in hits)
                print(f"{(c.code or ''):<16}{c.name}  ⇦  {codes}")

        if not args.yes:
            print("\n[عرض فقط] مافيش حاجة اتغيّرت. ضيف --yes للتنفيذ.")
            return

        for c, s in linked:
            c.supplier_id = s.id
        db.commit()
        print(f"\n   ✓ اتربط {len(linked):,} كارت.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
