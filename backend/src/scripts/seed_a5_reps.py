"""يعمل حسابات مستخدمين للمناديب الموجودين في بيانات a5.

عملاء a5 بيشاوروا على مندوبهم **بالاسم** — والاسم مكتوب في خانة التليفون (`ph1`)، لأن
العمود المخصص للمندوب فاضي في الـ٦٥٠ عميل كلهم. فعشان الاستيراد يقدر يوزّع العملاء، لازم
يبقى فيه حساب باسم كل مندوب.

بيقرا الأسماء من ملف العملاء المصدّر — مش من قائمة مكتوبة هنا. القائمة المكتوبة بتقدم:
مندوب جديد بيدخل a5 والسكربت مايعرفوش.

اسم الدخول بيتولّد لاتيني من الاسم العربي (`عمرو رجب` ← `rep.amr.rjb`)، لأن اسم الدخول
بيتكتب على كيبورد وبيتقال في التليفون.

    $env:SEED_PASSWORD = "..."
    python -m src.scripts.seed_a5_reps --dir C:/pgtmp --yes
"""
from __future__ import annotations

import os
import re
import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.org import Branch, Territory
from src.models.role import Role, RoleName
from src.models.user import User
from src.scripts.import_a5 import JUNK, PHONE, _clean, _read

# نقحرة عربي ← لاتيني. تقريبية عن قصد: الغرض اسم دخول يتكتب، مش نقل صوتي دقيق.
AR2LAT = {
    "ا": "a", "أ": "a", "إ": "a", "آ": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "g",
    "ح": "h", "خ": "kh", "د": "d", "ذ": "z", "ر": "r", "ز": "z", "س": "s", "ش": "sh",
    "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q",
    "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a", "و": "w", "ي": "y",
    "ى": "y", "ئ": "y", "ء": "", "ؤ": "w", "٠": "0", "١": "1", "٢": "2", "٣": "3",
    "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
}


def _slug(name: str) -> str:
    parts = []
    for word in name.split():
        lat = "".join(AR2LAT.get(ch, ch if ch.isalnum() and ch.isascii() else "") for ch in word)
        lat = re.sub(r"[^a-z0-9]", "", lat.lower())
        if lat:
            parts.append(lat)
    return ".".join(parts[:3]) or "rep"


def run(folder: str, password: str, *, execute: bool) -> None:
    custs = _read(os.path.join(folder, "a5_cust.tsv"))
    # الأسماء بتتقرا من الداتا نفسها — قائمة مكتوبة هنا بتقدم أول ما مندوب يتضاف هناك.
    names: dict[str, int] = {}
    for r in custs:
        if len(r) < 5 or not r[0].isdigit():
            continue
        raw = _clean(r[4])
        if raw and not PHONE.match(raw) and not JUNK.match(raw):
            names[raw] = names.get(raw, 0) + 1

    print(f"مناديب في بيانات a5: {len(names)}\n")
    for n, c in sorted(names.items(), key=lambda x: -x[1]):
        print(f"   {n:<26}{c:>5} عميل")

    if not execute:
        print("\nعرض فقط — مافيش حساب اتعمل. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    try:
        role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        if role is None:
            raise SystemExit("دور «مندوب مبيعات» مش موجود في جدول الأدوار.")
        branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                            .order_by(Branch.id)).first()
        terr = db.scalars(select(Territory).where(Territory.branch_id == branch.id)
                          .order_by(Territory.id)).first()

        existing_names = {(u.full_name or "").strip(): u for u in db.scalars(select(User)).all()}
        taken = {u.username for u in db.scalars(select(User)).all()}

        made = 0
        print("\nالحسابات:")
        for name in sorted(names, key=lambda x: -names[x]):
            if name in existing_names:
                print(f"  = {name:<26} موجود ({existing_names[name].username})")
                continue
            base = f"rep.{_slug(name)}"
            username, i = base, 2
            while username in taken:
                username = f"{base}{i}"
                i += 1
            db.add(User(username=username, password_hash=hash_password(password),
                        role_id=role.id, branch_id=branch.id,
                        territory_id=terr.id if terr else None,
                        full_name=name, active=True))
            taken.add(username)
            made += 1
            print(f"  + {username:<26} {name}")
        db.commit()
        print(f"\nاتعمل {made} حساب. غيّر الباسوردات من «المستخدمين».")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    pwd = os.environ.get("SEED_PASSWORD", "").strip()
    if "--yes" in args and not pwd:
        raise SystemExit("حدّد SEED_PASSWORD قبل التنفيذ.")
    run(folder, pwd, execute="--yes" in args)
