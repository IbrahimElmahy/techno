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
from src.scripts.wb_profile import ALIAA, WbProfile, dir_from_argv, profile_from_argv


def _phone(raw: str | None) -> str | None:
    text = str(raw or "").strip()
    if text.endswith(".0"):
        text = text[:-2]
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) == 10 and digits.startswith("1"):
        digits = "0" + digits
    return digits if len(digits) >= 7 else None


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def run(folder: str, *, execute: bool, new_only: bool = False,
        profile: WbProfile = ALIAA) -> None:
    rows = _read(os.path.join(folder, "owners.tsv"))
    reps = _read(os.path.join(folder, "reps.tsv"))
    erp_to_emp = {r["erp_id"]: r["emp_code"] for r in reps if r.get("erp_id")}

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == profile.branch))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{profile.branch}».")
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
            code = profile.owner_prefix + rid
            emp = erp_to_emp.get(r.get("svc_rep_erp", ""))
            uname = profile.emp_to_user.get(emp) if emp else None
            svc = users.get(uname) if uname else None
            if emp and uname is None:
                notes[f"كود موظف مش في الخريطة: {emp}"] += 1
            elif uname and svc is None:
                notes[f"حساب مش موجود: {uname}"] += 1
            svc_dist[svc.full_name if svc else "(بلا مندوب خدمة)"] += 1

            nums = []
            for k in ("phone1", "mobile", "phone2"):
                x = _phone(r.get(k))
                if x and x not in nums:
                    nums.append(x)
            phone = nums[0] if nums else None
            phone2 = nums[1] if len(nums) > 1 else None
            o = have.get(code)
            if o is None:
                made.append((code, name, svc))
                continue
            notes["مالك موجود"] += 1
            if new_only:
                continue
            if svc is not None and o.service_rep_id != svc.id:
                o.service_rep_id = svc.id
                upd += 1
            if phone and not o.phone:
                o.phone = phone[:32]
                upd += 1
            if phone2 and not o.phone2:
                o.phone2 = phone2[:32]
                upd += 1
            floor = (r.get("floor") or "").strip()
            if floor and floor != "0" and not o.floor_number:
                o.floor_number = floor[:16]
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
            code = profile.owner_prefix + rid
            if code in have:
                continue
            emp = erp_to_emp.get(r.get("svc_rep_erp", ""))
            uname = profile.emp_to_user.get(emp) if emp else None
            svc = users.get(uname) if uname else None
            nums = []
            for k in ("phone1", "mobile", "phone2"):
                x = _phone(r.get(k))
                if x and x not in nums:
                    nums.append(x)
            phone = nums[0] if nums else None
            floor = (r.get("floor") or "").strip()
            db.add(Owner(
                code=code, name=name[:160], phone=phone[:32] if phone else None,
                phone2=(nums[1][:32] if len(nums) > 1 else None),
                floor_number=(floor[:16] if floor and floor != "0" else None),
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
    profile = profile_from_argv(args)
    run(dir_from_argv(args, profile), execute="--yes" in args,
        new_only="--new-only" in args, profile=profile)


if __name__ == "__main__":
    main()
