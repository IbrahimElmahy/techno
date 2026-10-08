from __future__ import annotations

import os
import re
import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.employee import Employee, JobTitle
from src.models.org import Branch
from src.models.user import User
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import JUNK, _clean, _read

BUCKET = re.compile(r"^\s*(بونص|بوانص|عهدة|عهده|مندوبية|فرع\s|ادارة المبيعات|إدارة المبيعات)")

NO_ARABIC = re.compile(r"^[^؀-ۿ]+$")

STORE_PREFIX = re.compile(r"^(مخزن|محزن|مخزم)\s+")

NOISE = {"مندوب", "عهده"}


def _norm(s: str) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    return re.sub(r"\s+", " ", s).strip()


def _words(s: str) -> list[str]:
    s = re.sub(r"[()\[\]{}.,\-_/]+", " ", _norm(s))
    return [w for w in s.split() if w not in NOISE]


def _same_person(emp_name: str, wh_name: str) -> bool:
    w = _words(STORE_PREFIX.sub("", wh_name))
    e = _words(emp_name)
    if not w or not e:
        return False
    if w == e:
        return True
    short, long_ = (w, e) if len(w) < len(e) else (e, w)
    return long_[:len(short)] == short


def run(folder: str, *, execute: bool, branch_name: str = "",
        prefix: str = "") -> None:
    rows = _read(os.path.join(folder, "a5_emp.tsv"))
    emps = [r for r in rows if r and r[0] == "EMP"]
    stores = [r for r in rows if r and r[0] == "STORE"]

    def _is_person(name: str) -> bool:
        return bool(name) and not (JUNK.match(name) or BUCKET.match(name)
                                   or NO_ARABIC.match(name))

    people = [r for r in emps if _is_person(_clean(r[2]))]
    buckets = [r for r in emps if r not in people]

    print("المصدر:")
    print(f"   صفوف الموظفين        {len(emps):>6}")
    print(f"   منهم أشخاص           {len(people):>6}")
    print(f"   دلاء محاسبية         {len(buckets):>6}")
    print(f"   مخازن                {len(stores):>6}")
    if buckets:
        print("\n   مش هيدخلوا كشف الموظفين:")
        for r in buckets:
            print(f"      {_clean(r[2])}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    made = {"وظائف": 0, "موظفين": 0, "ربط بحساب": 0, "ربط بمخزن": 0}
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit("مافيش فرع اسمه " + branch_name)
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        print("الفرع المستهدف: " + (branch.name if branch else "—") + "\n")

        jobs = {j.name: j for j in db.scalars(select(JobTitle)).all()}
        for r in people:
            job = _clean(r[3])
            if job and job not in jobs:
                j = JobTitle(name=job, active=True)
                db.add(j)
                db.flush()
                jobs[job] = j
                made["وظائف"] += 1

        by_name = ({_norm(e.name): e for e in db.scalars(
            select(Employee).where(Employee.branch_id == branch.id)).all()}
            if branch else {})
        users = ({_norm(u.full_name or ""): u for u in db.scalars(
            select(User).where(User.branch_id == branch.id)).all()
            if (u.full_name or "").strip()} if branch else {})
        linked_users = {e.user_id for e in db.scalars(select(Employee)).all() if e.user_id}
        whs = (db.scalars(select(Warehouse).where(Warehouse.active.is_(True),
                                                  Warehouse.branch_id == branch.id)).all()
               if branch else [])
        taken = {e.warehouse_id for e in db.scalars(select(Employee)).all() if e.warehouse_id}
        n = db.scalar(select(func.count()).select_from(Employee)) or 0

        for r in people:
            name = _clean(r[2])
            key = _norm(name)
            emp = by_name.get(key)
            if emp is None:
                n += 1
                code = f"{prefix}A5E-{r[1]}"
                emp = Employee(code=code, name=name, branch_id=branch.id if branch else None,
                               active=True)
                db.add(emp)
                db.flush()
                by_name[key] = emp
                made["موظفين"] += 1

            job = _clean(r[3])
            if job and emp.job_title_id is None:
                emp.job_title_id = jobs[job].id
            sector = _clean(r[4])
            if sector and not emp.department:
                emp.department = sector
            phone = _clean(r[6])
            if phone and not emp.phone:
                emp.phone = phone
            addr = _clean(r[7])
            if addr and not emp.address:
                emp.address = addr

            u = users.get(key)
            if u is not None and emp.user_id is None and u.id not in linked_users:
                emp.user_id = u.id
                linked_users.add(u.id)
                made["ربط بحساب"] += 1

        db.flush()

        stale = [e for e in by_name.values()
                 if e.active and not _is_person(_clean(e.name))]
        for e in stale:
            e.active = False
            made["اتقفل"] = made.get("اتقفل", 0) + 1
            print(f"   اتقفل (مش شخص): {e.name}")

        pool = [e for e in by_name.values() if e.warehouse_id is None and e.active]
        ambiguous: list[str] = []
        for w in whs:
            if w.id in taken:
                continue
            hits = [e for e in pool if _same_person(e.name, w.name)]
            if len(hits) == 1:
                hits[0].warehouse_id = w.id
                taken.add(w.id)
                pool.remove(hits[0])
                made["ربط بمخزن"] += 1
                print(f"   {hits[0].name} ← {w.name}")
            elif len(hits) > 1:
                ambiguous.append(f"{w.name} ← " + " / ".join(e.name for e in hits))

        db.commit()
        print(f"\n{'الكيان':<16}{'اتعمل':>8}")
        print("-" * 26)
        for k, v in made.items():
            print(f"{k:<16}{v:>8}")

        if ambiguous:
            print(f"\nمخازن أكتر من موظف بيطابقها ({len(ambiguous)}) — اتسابت مش مربوطة:")
            for a in ambiguous:
                print("   ", a)

        free = [w.name for w in whs if w.id not in taken]
        if free:
            print(f"\nمخازن من غير أمين ({len(free)}) — تتربط من شاشة الموظفين:")
            for w in free:
                print("   ", w)
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    run(folder, execute="--yes" in args, branch_name=branch, prefix=prefix)
