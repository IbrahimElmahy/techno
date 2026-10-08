from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.inspection import Inspection
from src.models.user import User

PAIRS = {
    "مندوب بيع محمد صبحى": "مندوب السياره ( أ )",
    "مندوب بيع إبراهيم حسونه": "مندوب السياره ( ب )",
    "مندوب بيع محمد مكرم": "مندوب السياره ( ج )",
    "مندوب بيع احمد الكومى": "مندوب السياره (د)",
    "مندوب بيع حسام موسى": "مندوب سياره الشرقيه",
    "مندوب اداره مبيعات": "اداره مبيعات",
}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        by_name = {u.full_name: u for u in db.scalars(select(User)).all() if u.full_name}
        moved_c = moved_i = 0
        print(f"{'النسخة المكررة':<26}{'الهدف':<24}{'عملاء':>7}{'معاينات':>9}")
        print("-" * 68)
        for dupe_name, target_name in PAIRS.items():
            dupe, target = by_name.get(dupe_name), by_name.get(target_name)
            if dupe is None or target is None:
                print(f"⚠ مالقاش: {dupe_name if dupe is None else target_name}")
                continue
            custs = db.scalars(select(Customer)
                               .where(Customer.service_rep_id == dupe.id)).all()
            insps = db.scalars(select(Inspection)
                               .where(Inspection.rep_user_id == dupe.id)).all()
            print(f"{dupe_name:<26}{target_name:<24}{len(custs):>7}{len(insps):>9}")
            if execute:
                for c in custs:
                    c.service_rep_id = target.id
                for i in insps:
                    i.rep_user_id = target.id
                dupe.active = False
            moved_c += len(custs)
            moved_i += len(insps)

        print("-" * 68)
        print(f"{'الإجمالي':<50}{moved_c:>7}{moved_i:>9}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return
        db.commit()
        print("\nتم. النسخ المكررة اتقفلت (active=False) ومااتمسحتش.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
