"""ينقل تجار صفحة «اضافه تجار» في ملف العميل — دول مش في a5 خالص.

    python -m src.scripts.import_wb_traders --dir C:/pgtmp/wb2          # يعرض بس
    python -m src.scripts.import_wb_traders --dir C:/pgtmp/wb2 --yes    # ينفّذ

بيتعاد تشغيله بأمان: المطابقة بالكود، والموجود بيتحدّث والناقص بيتعمل.

---------------------------------------------------------------------------
⛔ **قاعدة `ERP` ممنوع لمسها** (شوف `CLAUDE.md`). المصدر صفحة «اضافه تجار».

الصفحة فيها **١٢ صف بـ١١ كود** (كود مكرر) لتجار العميل ضافهم في نظام ما بعد البيع
بس — **مالهمش كارت في a5**، وكودهم في العمود الأول رقم داخلي (`1001741`) مش كود a5
رغم إن العمود اسمه `a5_code` وبيحمل نفس الرقم.

**ودول اللي كانوا مخلّيين ٨٨ صف كوبون يتخطّى.** خمسة منهم (`1001741`، `1001743`،
`1001742`، `1001761`، `1001812`) مكتوبين في عمود «كود تاجر A5» في صفحة الكوبونات،
والمستورد كان بيدوّر عليهم في كشف العملاء ومايلاقيهمش. بعد الصفحة دي بيتلاقوا.

**`1001355` «المصنع» مايتعملش كارت جديد** — ده نفسه `A5X1` «المصنع السادات» اللي
موجود عندنا وعليه ٦٤ معاينة و٣١٦٬١٠٣ ج رصيد على `A5S-657`. كارت تاني معناه إن
حركة المصنع بتتقسم على اتنين. الصفحة بتحطّه في `ALIAS` بدل ما تعمله.

**«كارم عاشور» و«رياض شعبان» و«احمد ثابت» ليهم كروت سباكين بأسماء قريبة** — بس
كارت السباك مكتوب عليه «فنى فلان» وده صف تاني في نفس ملف العميل بكود تاني. صفّين
في داتا العميل = كارتين، والدمج هنا تخمين مش قراءة.

**المندوب بيتطابق بطيّ الهمزة** — الملف كاتب «مندوب السياره ( ا )» والحساب عندنا
«مندوب السياره ( أ )». الطيّ مسموح هنا لأنها قايمة مقفولة من أسماء المناديب، مش
أسماء ناس (a5 بيفرّق بين الناس بالهمزة).
"""
from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.org import Branch, Governorate, Territory
from src.models.user import User

CODE_PREFIX = "WB-T-"          # كود التاجر عندنا = بادئة + كوده في الملف
BRANCH = "العلياء"

# كود في الملف → كارت موجود عندنا. الحركة بتروح للكارت ده مش لكارت جديد.
ALIAS: dict[str, str] = {
    "1001355": "A5X1",         # «المصنع» = المصنع السادات
}


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def _norm_rep(s: str) -> str:
    """تطبيع أسماء المناديب **بس** — قايمة مقفولة، مش أسماء ناس."""
    s = re.sub(r"[أإآٱ]", "ا", s or "").replace("\xa0", " ")
    return re.sub(r"\s+", "", s).strip()


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "traders.tsv"))

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == BRANCH))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{BRANCH}».")
        terr = db.scalar(select(Territory).where(Territory.branch_id == branch.id)
                         .order_by(Territory.id))
        govs = {g.id for g in db.scalars(select(Governorate)).all()}
        reps = {}
        for u in db.scalars(select(User)).all():
            reps.setdefault(_norm_rep(u.full_name), u)
        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}

        made: list[tuple[str, dict[str, str], User | None]] = []
        upd: list[tuple[Customer, str, object]] = []
        notes: Counter = Counter()
        problems: list[str] = []
        seen: set[str] = set()

        for r in rows:
            rid = r.get("id", "")
            name = (r.get("clean_name") or r.get("name") or "").strip()
            if not rid or not name:
                notes["صف بلا كود أو اسم"] += 1
                continue
            if rid in seen:
                notes["كود مكرر في الملف — اتخطّى"] += 1
                continue
            seen.add(rid)

            if rid in ALIAS:
                c = by_code.get(ALIAS[rid])
                if c is None:
                    problems.append(f"{rid} «{name}»: مربوط بـ{ALIAS[rid]} وهو مش موجود")
                else:
                    notes[f"مربوط بكارت موجود: {ALIAS[rid]}"] += 1
                continue

            rep = reps.get(_norm_rep(r.get("rep_name", "")))
            if r.get("rep_name") and rep is None:
                problems.append(f"{rid} «{name}»: مندوب «{r['rep_name']}» مالوش حساب")

            gov = r.get("gov", "")
            gid = int(gov) if gov.isdigit() and int(gov) in govs else None
            if gov and gid is None:
                problems.append(f"{rid} «{name}»: محافظة «{gov}» مش في الجدول")

            code = CODE_PREFIX + rid
            c = by_code.get(code)
            if c is None:
                made.append((code, r, rep))
                continue
            notes["موجود — بيتحدّث"] += 1
            for field, val in (("rep_id", rep.id if rep else None),
                               ("governorate_id", gid),
                               ("markaz", (r.get("city") or None)),
                               ("phone", (r.get("phone") or None))):
                if val is not None and getattr(c, field) != val:
                    upd.append((c, field, val))

        print(f"صفوف الملف: {len(rows)}   ·   أكواد مميزة: {len(seen)}")
        for k, v in notes.most_common():
            print(f"   {k:<40}{v:>6}")
        print(f"\n   {'تجار هيتعملوا':<40}{len(made):>6}")
        print(f"   {'حقول هتتحدّث':<40}{len(upd):>6}")
        if made:
            print("\n   الجداد:")
            for code, r, rep in made:
                print(f"      {code:<14}{(r.get('clean_name') or r['name'])[:26]:<28}"
                      f"{(r.get('city') or '')[:12]:<14}{rep.full_name if rep else '(بلا مندوب)'}")
        if problems:
            print(f"\n⚠ محتاج مراجعة ({len(problems)}):")
            for p in problems[:20]:
                print("   ", p)
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, field, val in upd:
            setattr(c, field, val)
        for code, r, rep in made:
            gov = r.get("gov", "")
            db.add(Customer(
                code=code, name=(r.get("clean_name") or r["name"])[:160],
                customer_type="trader",
                rep_id=rep.id if rep else None,
                governorate_id=int(gov) if gov.isdigit() else None,
                markaz=(r.get("city") or None),
                phone=(r.get("phone") or None),
                territory_id=terr.id if terr else None,
                branch_id=branch.id, active=True))
        db.commit()

        n = db.scalar(select(func.count()).select_from(Customer)
                      .where(Customer.code.like(f"{CODE_PREFIX}%"))) or 0
        print(f"\n✔ اتعمل {len(made)} تاجر · اتحدّث {len(upd)} حقل")
        print(f"   كروت «اضافه تجار» دلوقتي: {n}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
