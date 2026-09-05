"""يعمل حسابات دخول لمناديب خدمة ما بعد البيع ويربطهم بموظفيهم ومخازنهم.

    python -m src.scripts.create_service_reps          # يعرض بس
    python -m src.scripts.create_service_reps --yes    # ينفّذ

بيتعاد تشغيله بأمان: اليوزر الموجود بيتحدّث والناقص بيتعمل، والربط الصح مابيتلمسش.

---------------------------------------------------------------------------
**ليه:** النقل القديم عمل الـ١٦ يوزر دول من قاعدة `ERP` مباشرةً. القاعدة دي اتقفلت
نهائياً كمصدر (شوف `CLAUDE.md`)، والـ١٠ اللي مالهمش وجود في a5 اتمسحوا مع إعادة
البناء — بقرار: «يتمسحوا ويتعملوا من جديد مع الملف».

ودلوقتي الملف وصل، وبيشاور عليهم بـ**رقم اليوزر** في ٣ صفحات: `معاينات.SalesRepId`،
`نقاط.SalesRepID`، `كوبونات.كود مندوب تسليم/استلام` — حوالي ٩٥ ألف صف. من غير
الحسابات دي الدمج مالوش أرضية.

**الربط بالكود مش بالرقم اللي في الملف.** الملف بيحمل رقم اليوزر القديم، والأرقام
دي اتغيّرت مع إعادة البناء. وفيه غلطة في الملف نفسه: «محمد ممدوح» متربط بيوزر رقم ٥
وهو `aftersales` — راجل تاني خالص. فالمفتاح هنا **كود الموظف عند a5**
(`AL-A5E-<AccBrnch_id>`) واسم المخزن، والرقم اللي في الملف بيتقرا للمراجعة بس.

**الأسماء اللي في الملف مش أسماء الناس.** المستخدم صحّح اتنين: «اشرف هلول» في الملف
هو **اشرف محى** (`AL-A5E-11`، مخزن اشرف محى)، و«اداره خدمه عملاء» هو **محمد هلال ابو
عمه** (`AL-A5E-4`، مخزن محمد هلال) — دي وظيفة مش اسم. و«انس» في a5 هو انس سعيد،
و«أحمدتركى» (ملزوقة عندهم) هو احمد تركى.

**واحد بس مالوش صف موظف: «محمد تركى»** — مش في `Emp` ولا في كشف الموظفين، بس مخزنه
موجود («مخزن محمد تركى»). بيتعمل له صف موظف بقرار صريح من المستخدم.

**الدور `after_sales_staff` مش `sales_rep`.** دول بيعاينوا وبياخدوا كوبونات، مابيبيعوش —
والفرق ده هو اللي بيخلّي `customer.service_rep_id` غير `customer.rep_id`، وتقرير
المناديب مايجمّعش ناس على شغل مش بتاعهم.

**الباسورد** من `SEED_PASSWORD` في البيئة، وإلا بيتولّد عشوائي ويتطبع مرة واحدة —
مافيش باسورد ثابت مكتوب في الكود.
"""
from __future__ import annotations

import os
import secrets
import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.employee import Employee
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Warehouse

# username → (الاسم الكامل، كود الموظف عند a5 أو None، اسم المخزن)
#
# الكود اتشاف واحد واحد في كشف «ذمم الموظفين» وجدول الموظفين المنقول، والاسم اتأكد
# من المستخدم. اللي كوده None مالوش صف في `Emp` وبيتعمل من مخزنه.
PEOPLE: tuple[tuple[str, str, str | None, str], ...] = (
    ("ashraf",          "اشرف محى",           "AL-A5E-11",  "مخزن اشرف محى"),
    ("ibrahim.khattab", "ابراهيم خطاب",       "AL-A5E-63",  "مخزن ابراهيم خطاب"),
    ("anas",            "انس سعيد",           "AL-A5E-7",   "مخزن انس سعيد"),
    ("mohamed.mamdouh", "محمد ممدوح",         "AL-A5E-76",  "مخزن محمد ممدوح"),
    ("medhat",          "مدحت خضر",           "AL-A5E-65",  "مخزن مدحت خضر"),
    ("ahmed.torky",     "احمد تركى",          "AL-A5E-13",  "مخزن احمد تركى"),
    ("mohamed.torky",   "محمد تركى",          None,         "مخزن محمد تركى"),
    ("bayoumy",         "بيومى جابر",         "AL-A5E-45",  "مخزن بيومى جابر"),
    ("hassan.eid",      "حسن عيد",            "AL-A5E-55",  "مخزن حسن عيد"),
    ("care",            "محمد هلال ابو عمه",  "AL-A5E-4",   "مخزن محمد هلال"),
)

BRANCH = "العلياء"


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        role = db.scalar(select(Role).where(Role.name == RoleName.after_sales_staff))
        if role is None:
            raise SystemExit("مافيش دور «after_sales_staff» — شغّل seed الأدوار الأول.")
        from src.models.org import Branch
        branch = db.scalar(select(Branch).where(Branch.name == BRANCH))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{BRANCH}».")

        # المنطقة إجبارية على اليوزر. مناديب الخدمة مش مربوطين بمنطقة معيّنة —
        # بيتحطوا على أول منطقة في الفرع زي ما `import_a5` بيعمل مع العملاء.
        from src.models.org import Territory
        terr = db.scalar(select(Territory).where(Territory.branch_id == branch.id)
                         .order_by(Territory.id))
        if terr is None:
            raise SystemExit(f"مافيش ولا منطقة في فرع «{BRANCH}».")

        pwd = os.environ.get("SEED_PASSWORD") or secrets.token_urlsafe(9)
        shown = "SEED_PASSWORD" if os.environ.get("SEED_PASSWORD") else pwd

        plan: list[tuple[str, str, User | None, Employee | None, Warehouse | None, str]] = []
        problems: list[str] = []
        for username, person, code, wh_name in PEOPLE:
            user = db.scalar(select(User).where(User.username == username))
            if user is None:
                user = db.scalar(select(User).where(User.full_name == person))
            emp = db.scalar(select(Employee).where(Employee.code == code)) if code else None
            wh = db.scalar(select(Warehouse).where(Warehouse.name == wh_name,
                                                   Warehouse.branch_id == branch.id))
            if code and emp is None:
                problems.append(f"{person}: مالقيتش موظف بكود {code}")
                continue
            if wh is None:
                problems.append(f"{person}: مالقيتش مخزن «{wh_name}»")
            if emp is not None and emp.user_id not in (None, getattr(user, "id", None)):
                other = db.get(User, emp.user_id)
                problems.append(f"{person}: الموظف مربوط خلاص بـ"
                                f"{other.username if other else emp.user_id}")
                continue
            what = "موجود" if user is not None else "هيتعمل"
            plan.append((username, person, user, emp, wh, what))

        print(f"{'الحساب':<18}{'الاسم':<20}{'اليوزر':<10}{'الموظف':<16}المخزن")
        print("-" * 84)
        for username, person, user, emp, wh, what in plan:
            e = emp.code if emp else "هيتعمل"
            print(f"{username:<18}{person[:18]:<20}{what:<10}{e:<16}{wh.name if wh else '✘'}")
        if problems:
            print("\n⚠️ محتاج مراجعة:")
            for p in problems:
                print("   ", p)
        if not execute:
            print(f"\nالباسورد: {shown}")
            print("عرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        made_u = made_e = 0
        for username, person, user, emp, wh, _ in plan:
            if user is None:
                user = User(username=username, password_hash=hash_password(pwd),
                            role_id=role.id, branch_id=branch.id,
                            territory_id=terr.id, full_name=person, active=True)
                db.add(user)
                db.flush()
                made_u += 1
            else:
                user.role_id, user.branch_id, user.active = role.id, branch.id, True
                user.full_name = person
            if emp is None:
                emp = db.scalar(select(Employee).where(Employee.user_id == user.id))
            if emp is None:
                emp = Employee(code=f"SVC-{username}"[:32], name=person,
                               branch_id=branch.id, active=True)
                db.add(emp)
                db.flush()
                made_e += 1
            emp.user_id = user.id
            if wh is not None and emp.warehouse_id is None:
                emp.warehouse_id = wh.id
        db.commit()

        print(f"\n✔ يوزرات اتعملت {made_u} · كروت موظفين اتعملت {made_e}")
        if made_u:
            print(f"   الباسورد للجديد: {shown}")
        print("\nالتحقق:")
        bad = 0
        for username, person, *_ in plan:
            u = db.scalar(select(User).where(User.username == username))
            e = db.scalar(select(Employee).where(Employee.user_id == u.id)) if u else None
            w = db.get(Warehouse, e.warehouse_id) if e and e.warehouse_id else None
            ok = u is not None and u.active and e is not None
            bad += not ok
            uid = str(u.id) if u else "—"
            ec = e.code if e else "—"
            print(f"{'✔' if ok else '✘'} #{uid:<5} {username:<18}«{person[:18]:<18}»"
                  f" موظف={ec:<14} مخزن={w.name if w else '—'}")
        if bad:
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
