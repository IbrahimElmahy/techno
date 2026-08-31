# -*- coding: utf-8 -*-
"""يرجّع مندوب كل عميل من a5 — الاسم مكتوب في خانة التليفون عندهم.

    python -m src.scripts.fix_customer_reps
    python -m src.scripts.fix_customer_reps --yes

نقل a5 كان بيحط `default_rep` على أي عميل اسم مندوبه مااتطابقش، فـ٢٧٤٣ عميل (٧١٪
من الكشف) قعدوا على راجل واحد — وتقارير المناديب كلها بتقول كلام مش صحيح.

المطابقة بالاسم متطبّع (أ/إ/آ، ى/ي، ة/ه، مسافات مكررة)، **واللي مايتطابقش بيتقال
مايتحطش على مندوب افتراضي** — ده اللي عمل المشكلة من الأول.
"""
from __future__ import annotations

import io, re, sys, unicodedata
from collections import Counter, defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.user import User

AR = str.maketrans({"أ":"ا","إ":"ا","آ":"ا","ٱ":"ا","ى":"ي","ة":"ه","ـ":""})
PHONE = re.compile(r"^[\d\s\-+()]+$")
FILES = [("C:/pgtmp/rep_AL.tsv", "AL-A5"), ("C:/pgtmp/rep_A5.tsv", "A5")]


def norm(s):
    s = unicodedata.normalize("NFKC", str(s or "")).translate(AR)
    s = "".join(c for c in s if not ("\u064b" <= c <= "\u0652"))
    return " ".join(s.split()).casefold()


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        reps = {}
        for u in db.scalars(select(User)).all():
            if u.full_name:
                reps.setdefault(norm(u.full_name), u)
        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}

        changed = same = no_rep = 0
        unmatched: Counter = Counter()
        moves: defaultdict = defaultdict(int)
        plan = []
        for path, prefix in FILES:
            try:
                lines = io.open(path, encoding="utf-16-le").read().splitlines()
            except UnicodeError:
                lines = io.open(path, encoding="utf-8", errors="replace").read().splitlines()
            for ln in lines:
                parts = ln.replace("\ufeff", "").split("~")
                if len(parts) < 3:
                    continue
                cid, _name, raw = parts[0].strip(), parts[1], parts[2].strip()
                if not cid.isdigit():
                    continue
                if not raw or PHONE.match(raw):
                    no_rep += 1
                    continue
                u = reps.get(norm(raw))
                if u is None:
                    unmatched[raw] += 1
                    continue
                c = by_code.get(f"{prefix}-{cid}")
                if c is None:
                    continue
                if c.rep_id == u.id:
                    same += 1
                    continue
                moves[(c.rep_id, u.id)] += 1
                plan.append((c, u.id))
                changed += 1

        names = {u.id: u.full_name for u in db.scalars(select(User)).all()}
        print(f"{'هيتغيّر مندوبهم':<28}{changed:>7}")
        print(f"{'مندوبهم صح خلاص':<28}{same:>7}")
        print(f"{'الخانة تليفون مش مندوب':<28}{no_rep:>7}")
        print(f"{'اسم مندوب مش متطابق':<28}{sum(unmatched.values()):>7}")
        if unmatched:
            print("\nأسماء مش متطابقة:")
            for n, k in unmatched.most_common(12):
                print(f"   {n[:34]:<36}{k:>5} عميل")
        print("\nأكبر التحويلات:")
        for (frm, to), n in sorted(moves.items(), key=lambda x: -x[1])[:10]:
            print(f"   {str(names.get(frm))[:24]:<26} ← {str(names.get(to))[:24]:<26}{n:>6}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return
        for c, rid in plan:
            c.rep_id = rid
        db.commit()
        print(f"\n✔ اتغيّر مندوب {changed} عميل.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
