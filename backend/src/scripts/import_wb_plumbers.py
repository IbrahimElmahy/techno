from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.org import Branch, Territory
from src.models.user import User

PLUMBER, TRADER = "plumber", "trader"
BRANCH = "العلياء"
CODE_PREFIX = "WB-P-"


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def _is_a5(code: str) -> bool:
    return bool(code) and (code.startswith("A5-") or code.startswith("AL-A5-"))


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "plumbers.tsv"))
    _read(os.path.join(folder, "reps.tsv"))

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == BRANCH))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{BRANCH}».")
        terr = db.scalar(select(Territory).where(Territory.branch_id == branch.id)
                         .order_by(Territory.id))

        users = {u.username: u for u in db.scalars(select(User)).all()}
        by_emp_code = {
            "EMP-0053": "ashraf",
            "EMP-0002": "ibrahim.khattab",
            "EMP-0003": "anas",
            "EMP-0008": "bayoumy",
            "EMP-0004": "hassan.eid",
            "EMP-0005": "ahmed.torky",
            "EMP-0054": "care",
            "EMP-0006": "mohamed.mamdouh",
            "EMP-0007": "medhat",
            "EMP-0055": "mohamed.torky",
            "EMP-0040": "sales.dept2",
            "EMP-0045": "car.a",
            "EMP-0043": "car.b",
            "EMP-0046": "car.g",
            "EMP-0044": "car.d",
            "EMP-0047": "car.sharqia",
        }
        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}

        made: list[tuple[str, str, User | None]] = []
        upd: list[tuple[Customer, str, object, str]] = []
        notes: Counter = Counter()
        problems: list[str] = []

        for r in rows:
            code, name, kind = r["code"], r["name"] or r["clean_name"], r["kind"]
            if not code or not name:
                notes["صف بلا كود أو اسم"] += 1
                continue
            emp_code = r.get("emp_code", "")
            uname = by_emp_code.get(emp_code)
            svc = users.get(uname) if uname else None
            if emp_code and uname is None:
                notes[f"كود موظف مش في الخريطة: {emp_code}"] += 1
            elif uname and svc is None:
                notes[f"حساب مش موجود: {uname}"] += 1

            if kind == "تاجر":
                if not _is_a5(code):
                    problems.append(f"«{name}»: نوعه تاجر وكوده «{code}» مش كود a5 — اتخطّى")
                    continue
                c = by_code.get(code)
                if c is None:
                    problems.append(f"{code} «{name}»: تاجر ومالوش كارت عندنا — اتخطّى")
                    continue
                ctype = getattr(c.customer_type, "value", c.customer_type)
                if ctype != TRADER:
                    upd.append((c, "customer_type", TRADER, f"شيت السباك: تاجر ({code})"))
                if svc is not None and c.service_rep_id != svc.id:
                    upd.append((c, "service_rep_id", svc.id, f"مندوب خدمة: {svc.full_name}"))
                notes["تاجر بكود a5"] += 1
                continue

            our = CODE_PREFIX + code
            c = by_code.get(our)
            if c is None:
                made.append((our, name, svc))
                continue
            notes["سباك موجود"] += 1
            ctype = getattr(c.customer_type, "value", c.customer_type)
            if ctype != PLUMBER:
                upd.append((c, "customer_type", PLUMBER, "شيت السباك"))
            if c.rep_id is not None:
                upd.append((c, "rep_id", None, "السباك مالوش مندوب بيع"))
            if svc is not None and c.service_rep_id != svc.id:
                upd.append((c, "service_rep_id", svc.id, f"مندوب خدمة: {svc.full_name}"))

        print(f"صفوف الملف: {len(rows)}")
        for k, v in notes.most_common():
            print(f"   {k:<40}{v:>6}")
        print(f"\n   {'سباكين هيتعملوا':<40}{len(made):>6}")
        for f, n in Counter(f for _, f, _, _ in upd).most_common():
            print(f"   {'تعديل ' + f:<40}{n:>6}")
        svc_counts = Counter((s.full_name if s else "(بلا مندوب خدمة)") for _, _, s in made)
        if svc_counts:
            print("\n   توزيع السباكين الجدد على مناديب الخدمة:")
            for k, v in svc_counts.most_common():
                print(f"      {str(k)[:28]:<30}{v:>6}")
        if problems:
            print(f"\n⚠️ محتاج مراجعة ({len(problems)}):")
            for p in problems[:20]:
                print("   ", p)
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, field, value, _ in upd:
            setattr(c, field, value)
        for code, name, svc in made:
            db.add(Customer(code=code, name=name, customer_type=PLUMBER,
                            rep_id=None, service_rep_id=svc.id if svc else None,
                            territory_id=terr.id if terr else None,
                            branch_id=branch.id, active=True))
        db.commit()
        print(f"\n✔ اتعمل {len(made)} سباك · اتعدّل {len(upd)} حقل")

        n_pl = db.scalar(select(func.count()).select_from(Customer)
                         .where(Customer.code.like(f"{CODE_PREFIX}%"))) or 0
        bad = db.scalar(select(func.count()).select_from(Customer)
                        .where(Customer.code.like(f"{CODE_PREFIX}%"),
                               Customer.rep_id.is_not(None))) or 0
        print(f"   كروت السباكين دلوقتي: {n_pl}   ·   منهم عليه مندوب بيع (لازم صفر): {bad}")
        if bad:
            sys.exit(1)
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
