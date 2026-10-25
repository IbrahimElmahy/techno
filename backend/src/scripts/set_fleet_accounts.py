from __future__ import annotations

import argparse
import re

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.fleet import Vehicle
from src.models.ledger import Account
from src.services import audit_service

KINDS = {"oil_account_id": ("زيت",), "toll_account_id": ("كارتة", "كارته")}
LEADS = ("سولار", "بنزين", "صيانة", "صيانه", "زيت", "كارتة", "كارته")


def _key(name: str) -> str:
    words = (name or "").split()
    if words and words[0] in LEADS:
        words = words[1:]
    text = "".join(words).translate(str.maketrans("ةأإآ", "هااا"))
    return re.sub(r"[()\s]", "", text)


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        accounts = db.scalars(select(Account).where(Account.is_postable.is_(True))).all()
        plan = []
        for v in db.scalars(select(Vehicle).order_by(Vehicle.id)).all():
            fuel = db.get(Account, v.fuel_account_id) if v.fuel_account_id else None
            if fuel is None:
                continue
            key = _key(fuel.name)
            for field, leads in KINDS.items():
                if getattr(v, field):
                    continue
                hits = [a for a in accounts if a.branch_id == fuel.branch_id
                        and (a.name or "").split()[:1] and a.name.split()[0] in leads
                        and _key(a.name) == key]
                if len(hits) == 1:
                    plan.append((v, field, hits[0]))
                    print(f"{v.code:<8} {field:<16} ← {hits[0].code} {hits[0].name}")
        print(f"حسابات هتتربط: {len(plan)}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for v, field, acc in plan:
            setattr(v, field, acc.id)
            audit_service.record(db, action="fleet.set_account", actor_user_id=None,
                                 entity_type="fleet_vehicle", entity_id=v.id,
                                 after={field: acc.id})
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="ربط حسابات الزيت والكارتة بسياراتها حسب اسم حساب الوقود")
    ap.add_argument("--yes", action="store_true")
    run(execute=ap.parse_args().yes)


if __name__ == "__main__":
    main()
