from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.user import User

RENAMES: dict[int, str] = {
    17: "car.a",
    15: "car.b",
    18: "car.g",
    16: "car.d",
    19: "car.sharqia",
    7: "fayoum",
    8: "herafyeen",
    9: "giza1",
    10: "giza2",
    13: "minya",
    14: "mansoura",
    12: "sales.dept",
    20: "sales.dept2",
    52: "sales.dept3",
    21: "branches",
    54: "care",
    6: "amr.ragab",
    11: "amr.mostafa",
    43: "mohamed.sobhy",
    45: "mohamed.makram",
    55: "mohamed.mamdouh",
    58: "mohamed.torky",
    44: "ibrahim.hassouna",
    48: "ibrahim.khattab",
    46: "ahmed.komy",
    53: "ahmed.torky",
    47: "ashraf",
    49: "anas",
    50: "bayoumy",
    51: "hassan.eid",
    56: "medhat",
    57: "hossam",
}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        taken = {u.username: u.id for u in db.scalars(select(User))}
        rows: list[tuple[User, str, str]] = []
        clashes: list[str] = []

        for uid, new in RENAMES.items():
            u = db.get(User, uid)
            if u is None:
                clashes.append(f"مستخدم #{uid} مش موجود — الأرقام اتغيّرت؟")
                continue
            if u.username == new:
                continue
            owner = taken.get(new)
            if owner is not None and owner != uid:
                clashes.append(f"«{new}» متاخد لـ#{owner} — مش هيتغيّر #{uid}")
                continue
            rows.append((u, u.username, new))

        seen: dict[str, int] = {}
        for u, _old, new in rows:
            if new in seen:
                clashes.append(f"«{new}» مكرر في الخريطة: #{seen[new]} و#{u.id}")
            seen[new] = u.id

        print(f"{'الاسم القديم':<28}{'الجديد':<20}الموظف")
        print("-" * 74)
        for u, old, new in sorted(rows, key=lambda r: r[2]):
            print(f"{old:<28}{new:<20}{u.full_name or ''}")
        print(f"\nهيتغيّر: {len(rows)} اسم")

        if clashes:
            print("\n⚠️ مشاكل:")
            for c in clashes:
                print(f"   {c}")
            print("\n⛔ وقفت — صلّح الخريطة الأول.")
            return

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for u, _old, new in rows:
            u.username = new
        db.commit()
        print(f"\n✔ اتغيّر {len(rows)} اسم. كلمات السر زي ما هي.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
