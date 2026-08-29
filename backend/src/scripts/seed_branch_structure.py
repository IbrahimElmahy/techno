"""يبني التسلسل الطبيعي للفروع: فروع، مناطق، ومستخدم لكل دور في كل فرع.

    المستوى الأول:  admin  ــــ مدير الشركة، بيشوف الفروع كلها
    المستوى التاني: كل فرع، وفيه ٧ أدوار — مدير فرع، مشتريات، مبيعات، محاسب،
                    خدمة ما بعد البيع، مندوب، قارئ

الأدوار دي كلها **محبوسة في فرعها**: كل واحد بيفتح النظام يلاقي شغل فرعه بس، والعزل ده
بيتنفّذ على السيرفر (`branch_scope`) مش في الشاشة. `admin` وحده `branch_id` بتاعه فاضي،
وده اللي بيخلّيه يشوف الكل.

**الباسورد بيتقرا من البيئة، مش مكتوب هنا ولا متولّد.** من غير `SEED_PASSWORD` السكربت
بيقف — حسابات بباسورد معروف مسبقاً هي بالظبط الحاجة اللي مالهاش لازمة في نظام فيه فلوس.

بيتعاد تشغيله بأمان: الفرع أو المستخدم الموجود بيتساب زي ما هو، والناقص بس هو اللي بيتعمل.
باسورد الحساب الموجود مابيتغيّرش.

    # PowerShell
    $env:SEED_PASSWORD = "..."
    .venv/Scripts/python.exe -m src.scripts.seed_branch_structure "فرع القاهرة" "فرع الإسكندرية" "فرع أسيوط"

من غير أسماء بياخد اللي موجود ويكمّل بأسماء مؤقتة تقدر تغيّرها من شاشة «الفروع».
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.org import Branch, Governorate, Territory
from src.models.role import Role, RoleName
from src.models.user import User

# الدور، ولقبه، والحرف اللي بيدخل في اسم الدخول.
ROLES: list[tuple[RoleName, str, str]] = [
    (RoleName.branch_manager, "مدير الفرع", "manager"),
    (RoleName.purchasing_manager, "مدير المشتريات", "purchasing"),
    (RoleName.sales_manager, "مدير المبيعات", "sales"),
    (RoleName.accountant, "المحاسب", "accountant"),
    (RoleName.after_sales_staff, "خدمة ما بعد البيع", "aftersales"),
    (RoleName.sales_rep, "مندوب المبيعات", "rep"),
    (RoleName.viewer, "قارئ", "viewer"),
]


def _branches(db, names: list[str]) -> list[Branch]:
    """يضمن وجود الفروع المطلوبة — الموجود بيتساب، والناقص بيتعمل."""
    gov = db.scalars(select(Governorate)).first()
    if gov is None:
        gov = Governorate(name="القاهرة")
        db.add(gov)
        db.flush()
    out: list[Branch] = []
    for i, name in enumerate(names):
        b = db.scalars(select(Branch).where(Branch.name == name)).first()
        if b is None:
            b = Branch(name=name, governorate_id=gov.id, is_head_office=(i == 0))
            db.add(b)
            db.flush()
            print(f"  + فرع: {name}")
        else:
            print(f"  = فرع موجود: {name}")
        out.append(b)
    return out


def _territory(db, branch: Branch) -> Territory:
    """كل فرع بيحتاج منطقة واحدة على الأقل — المندوب بيتربط بمنطقة مش بفرع."""
    t = db.scalars(select(Territory).where(Territory.branch_id == branch.id)).first()
    if t is None:
        t = Territory(name=f"منطقة {branch.name}", branch_id=branch.id)
        db.add(t)
        db.flush()
        print(f"  + منطقة: {t.name}")
    return t


def run(names: list[str], password: str) -> None:
    db = SessionLocal()
    try:
        roles = {r.name: r.id for r in db.scalars(select(Role)).all()}
        missing = [r.value for r, _, _ in ROLES if r not in roles]
        if missing:
            raise SystemExit(f"أدوار ناقصة في جدول role: {missing}")

        print("الفروع:")
        branches = _branches(db, names)

        print("\nالمستخدمين:")
        made = 0
        for idx, branch in enumerate(branches, start=1):
            terr = _territory(db, branch)
            for role, title, slug in ROLES:
                username = f"{slug}{idx}"
                existing = db.scalars(select(User).where(User.username == username)).first()
                if existing is not None:
                    print(f"  = {username:<14} موجود — الباسورد ماتغيّرش")
                    continue
                db.add(User(
                    username=username,
                    password_hash=hash_password(password),
                    role_id=roles[role],
                    branch_id=branch.id,
                    # المندوب وحده بيتربط بمنطقة: عملاؤه بيوصلوا له عن طريقها.
                    territory_id=terr.id if role == RoleName.sales_rep else None,
                    full_name=f"{title} — {branch.name}",
                    active=True,
                ))
                made += 1
                print(f"  + {username:<14} {title} — {branch.name}")
        db.commit()

        print(f"\nاتعمل {made} مستخدم جديد.")
        print("\nالشكل النهائي:")
        print("  admin — مدير الشركة، كل الفروع")
        for idx, b in enumerate(branches, start=1):
            print(f"  └── {b.name}: " + "، ".join(f"{s}{idx}" for _, _, s in ROLES))
    finally:
        db.close()


if __name__ == "__main__":
    pwd = os.environ.get("SEED_PASSWORD", "").strip()
    if not pwd:
        raise SystemExit(
            "لازم تحدّد الباسورد في متغيّر البيئة SEED_PASSWORD قبل التشغيل.\n"
            '  PowerShell:  $env:SEED_PASSWORD = "..."')
    args = [a for a in sys.argv[1:] if a.strip()]
    if not args:
        db = SessionLocal()
        try:
            have = [b.name for b in db.scalars(select(Branch).order_by(Branch.id)).all()]
        finally:
            db.close()
        args = (have + [f"فرع {i}" for i in range(1, 4)])[:3]
        print(f"مافيش أسماء متبعتة — هستعمل: {args}")
        print("(غيّرها بعدين من شاشة «الفروع»، أو شغّل السكربت بالأسماء اللي انت عايزها)\n")
    run(args[:3], pwd)
