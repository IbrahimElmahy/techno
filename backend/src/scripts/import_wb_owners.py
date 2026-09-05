"""ينقل الملّاك (صفحة «عملاء» في ملف العميل) لجدول `owner`. المصدر الملف وحده.

    python -m src.scripts.import_wb_owners --dir C:/pgtmp/wb2          # يعرض بس
    python -m src.scripts.import_wb_owners --dir C:/pgtmp/wb2 --yes    # ينفّذ

بيتعاد تشغيله بأمان: المطابقة بالكود، والموجود بيتحدّث والناقص بيتعمل.

---------------------------------------------------------------------------
⛔ **قاعدة `ERP` ممنوع لمسها** (شوف `CLAUDE.md`). المصدر الوحيد هو ملف العميل.

**الملّاك مش عملاء، وليهم جدولهم وشاشتهم.** صاحب البيت اللي اشترى سخّان وبيتعمل
له معاينة مش طرف تجاري: مافيش فاتورة عليه ولا حساب ذمم ولا مندوب بيع. حطّه في
`customer` كان بيغرّق كشف العملاء بـ٧٬٨٦٠ اسم — و`api/customers.py` بيستبعد
تصنيف «مالك» صراحةً عشان كده.

**الكود `WB-C-{ID}`** — رقم الصف في الملف. المعاينات بتشاور على المالك بـ
`CustomerID`، فالكود ده هو الطريق اللي الخطوة الجاية بترجع بيه.

**مندوب الخدمة بكود الموظف مش بالاسم ولا برقم اليوزر.** نفس السبب اللي في
`import_wb_plumbers`: الملف بيسمّي الناس بوظايفهم («اداره خدمه عملاء» = محمد هلال
ابو عمه) وأرقام اليوزرات فيه من نقل قديم واتغيّرت. الخريطة مشتركة بين السكربتين.

**التليفون:** `Phone1` وإلا `Mobile`. الاتنين بيتحطوا لو مختلفين — الأول في `phone`
والتاني في الملاحظات، لأن `owner` عنده خانة تليفون واحدة.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.org import Branch, Territory
from src.models.owner import Owner
from src.models.user import User

BRANCH = "العلياء"
CODE_PREFIX = "WB-C-"

# كود الموظف في الملف → حساب الدخول عندنا. نفس خريطة `import_wb_plumbers`.
EMP_TO_USER = {
    "EMP-0053": "ashraf",          # اشرف محى — الملف كاتبه «اشرف هلول»
    "EMP-0002": "ibrahim.khattab",
    "EMP-0003": "anas",
    "EMP-0008": "bayoumy",
    "EMP-0004": "hassan.eid",
    "EMP-0005": "ahmed.torky",
    "EMP-0054": "care",            # محمد هلال ابو عمه — الملف كاتبه «اداره خدمه عملاء»
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


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "owners.tsv"))
    reps = _read(os.path.join(folder, "reps.tsv"))
    # رقم المندوب في ERP → كود موظفه، ومنه لحساب الدخول.
    erp_to_emp = {r["erp_id"]: r["emp_code"] for r in reps if r.get("erp_id")}

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == BRANCH))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{BRANCH}».")
        terr = db.scalar(select(Territory).where(Territory.branch_id == branch.id)
                         .order_by(Territory.id))
        users = {u.username: u for u in db.scalars(select(User)).all()}
        have = {o.code: o for o in db.scalars(select(Owner)).all() if o.code}

        made: list[tuple[str, str, User | None]] = []
        upd = 0
        notes: Counter = Counter()
        svc_dist: Counter = Counter()

        for r in rows:
            rid, name = r.get("id", ""), r.get("name", "")
            if not rid or not name:
                notes["صف بلا رقم أو اسم"] += 1
                continue
            code = CODE_PREFIX + rid
            emp = erp_to_emp.get(r.get("svc_rep_erp", ""))
            uname = EMP_TO_USER.get(emp) if emp else None
            svc = users.get(uname) if uname else None
            if emp and uname is None:
                notes[f"كود موظف مش في الخريطة: {emp}"] += 1
            elif uname and svc is None:
                notes[f"حساب مش موجود: {uname}"] += 1
            svc_dist[svc.full_name if svc else "(بلا مندوب خدمة)"] += 1

            phone = r.get("phone1") or r.get("mobile") or None
            o = have.get(code)
            if o is None:
                made.append((code, name, svc))
                continue
            notes["مالك موجود"] += 1
            if svc is not None and o.service_rep_id != svc.id:
                o.service_rep_id = svc.id
                upd += 1
            if phone and not o.phone:
                o.phone = phone[:32]
                upd += 1

        print(f"صفوف الملف: {len(rows)}")
        for k, v in notes.most_common(10):
            print(f"   {k:<40}{v:>6}")
        print(f"\n   {'ملّاك هيتعملوا':<40}{len(made):>6}")
        print(f"   {'حقول هتتحدّث':<40}{upd:>6}")
        print("\n   التوزيع على مناديب الخدمة:")
        for k, v in svc_dist.most_common():
            print(f"      {str(k)[:28]:<30}{v:>6}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for r in rows:
            rid, name = r.get("id", ""), r.get("name", "")
            if not rid or not name:
                continue
            code = CODE_PREFIX + rid
            if code in have:
                continue
            emp = erp_to_emp.get(r.get("svc_rep_erp", ""))
            uname = EMP_TO_USER.get(emp) if emp else None
            svc = users.get(uname) if uname else None
            phone = r.get("phone1") or r.get("mobile") or None
            db.add(Owner(
                code=code, name=name[:160], phone=phone[:32] if phone else None,
                address=(r.get("address") or r.get("addr3") or None),
                markaz=(r.get("addr3") or None),
                territory_id=terr.id if terr else None, branch_id=branch.id,
                service_rep_id=svc.id if svc else None,
                active=r.get("inactive") != "1"))
        db.commit()

        n = db.scalar(select(func.count()).select_from(Owner)) or 0
        no_svc = db.scalar(select(func.count()).select_from(Owner)
                           .where(Owner.service_rep_id.is_(None))) or 0
        print(f"\n✔ اتعمل {len(made)} مالك · اتحدّث {upd} حقل")
        print(f"   الملّاك دلوقتي: {n}   ·   منهم بلا مندوب خدمة: {no_svc}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
