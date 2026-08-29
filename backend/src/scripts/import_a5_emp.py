"""المرحلة التالتة من استيراد a5: الموظفون ووظائفهم، وربط كل واحد بمخزنه.

`Emp` في a5 فيه ٤١ صف — بس مش ٤١ موظف. فيه جنبهم دلاء محاسبية اتعملت عشان الترحيل
يلاقي مكان يقعد فيه: «بونص اكتوبر»، «عهدة سيارة الفيوم»، «مندوبية الجيزة2». دي أرصدة
مش ناس، ولو دخلت كشف المرتبات هيبقى فيه سواق اسمه «بونص». فبتتفرز.

    python -m src.scripts.import_a5_emp --dir C:/pgtmp          # يعرض بس
    python -m src.scripts.import_a5_emp --dir C:/pgtmp --yes    # ينفّذ

بيتعاد تشغيله بأمان.

---------------------------------------------------------------------------
تلات قرارات:

* **`Stores.emp_id` مش مستعمل.** موجود في a5 ومفروض يربط المخزن بأمينه، بس مليان في ٣
  مخازن من ١١ — واتنين منهم بيشاوروا على موظف اسمه «@@». المطابقة بالاسم («مخزن كامل
  هلال» ← «كامل هلال») بتطلع أكتر وأصح، فهي المستعملة.

* **المطابقة بتتم على اسم متطبّع.** «عبد الرحمن جمعة» في الموظفين و«مخزن عبد الرحمن
  جمعه» في المخازن — تاء مربوطة مقابل هاء. من غير تطبيع الاتنين مايتقابلوش.

* **الموظف مش لازم يكون مستخدم.** السواق وأمين المخزن بيتحاسبوا وبيظهروا في تقرير
  العمولة من غير ما يكون عندهم باسورد. اللي ليه حساب بالفعل بيتربط بـ`user_id` بدل ما
  يتكرر.
"""
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

# دلاء محاسبية اسمها في خانة الموظف. الرصيد لازم يقعد على حاجة، فاتعملّه «موظف».
BUCKET = re.compile(r"^\s*(بونص|عهدة|مندوبية|ادارة المبيعات|إدارة المبيعات)")


def _norm(s: str) -> str:
    """يشيل الفروق اللي بتخلي نفس الاسم اسمين: ة/ه، أإآ/ا، ى/ي، والمسافات الزيادة."""
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    return re.sub(r"\s+", " ", s).strip()


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "a5_emp.tsv"))
    emps = [r for r in rows if r and r[0] == "EMP"]
    stores = [r for r in rows if r and r[0] == "STORE"]

    people = [r for r in emps
              if _clean(r[2]) and not JUNK.match(_clean(r[2])) and not BUCKET.match(_clean(r[2]))]
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
        branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                            .order_by(Branch.id)).first()

        # ---------- الوظائف ----------
        jobs = {j.name: j for j in db.scalars(select(JobTitle)).all()}
        for r in people:
            job = _clean(r[3])
            if job and job not in jobs:
                j = JobTitle(name=job, active=True)
                db.add(j)
                db.flush()
                jobs[job] = j
                made["وظائف"] += 1

        # ---------- الموظفون ----------
        by_name = {_norm(e.name): e for e in db.scalars(select(Employee)).all()}
        users = {_norm(u.full_name or ""): u for u in db.scalars(select(User)).all()
                 if (u.full_name or "").strip()}
        linked_users = {e.user_id for e in db.scalars(select(Employee)).all() if e.user_id}
        whs = db.scalars(select(Warehouse).where(Warehouse.active.is_(True))).all()
        taken = {e.warehouse_id for e in db.scalars(select(Employee)).all() if e.warehouse_id}
        n = db.scalar(select(func.count()).select_from(Employee)) or 0

        for r in people:
            name = _clean(r[2])
            key = _norm(name)
            emp = by_name.get(key)
            if emp is None:
                n += 1
                code = f"A5E-{r[1]}"
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

            # اللي ليه حساب دخول بالفعل بيتربط، مايتكررش.
            u = users.get(key)
            if u is not None and emp.user_id is None and u.id not in linked_users:
                emp.user_id = u.id
                linked_users.add(u.id)
                made["ربط بحساب"] += 1

            # «مخزن كامل هلال» ← «كامل هلال». الاسم جوّه الاسم، بعد التطبيع.
            if emp.warehouse_id is None:
                match = next((w for w in whs
                              if w.id not in taken and key and key in _norm(w.name)), None)
                if match is not None:
                    emp.warehouse_id = match.id
                    taken.add(match.id)
                    made["ربط بمخزن"] += 1
                    print(f"   {name} ← {match.name}")

        db.commit()
        print(f"\n{'الكيان':<16}{'اتعمل':>8}")
        print("-" * 26)
        for k, v in made.items():
            print(f"{k:<16}{v:>8}")

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
    run(folder, execute="--yes" in args)
