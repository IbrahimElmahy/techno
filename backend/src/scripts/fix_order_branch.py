from __future__ import annotations

import argparse

from sqlalchemy import select

from src.auth.branch_scope import user_branch
from src.core.db import SessionLocal
from src.models.trade_order import TradeOrder
from src.models.user import User
from src.services import audit_service


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        plan = []
        for o in db.scalars(select(TradeOrder).where(TradeOrder.branch_id.is_(None))
                            .order_by(TradeOrder.id)).all():
            branch = user_branch(db.get(User, o.actor_user_id)) if o.actor_user_id else None
            if branch:
                plan.append((o, branch))
                print(f"{o.document_number:<10} ← فرع {branch}")
        print(f"شيتات هتتصلح: {len(plan)}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for o, branch in plan:
            o.branch_id = branch
            audit_service.record(db, action="order.fix_branch", actor_user_id=None,
                                 entity_type="trade_order", entity_id=o.id,
                                 after={"branch_id": branch})
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تحديد فرع شيتات التسعير القديمة من فرع من عملها")
    ap.add_argument("--yes", action="store_true")
    run(execute=ap.parse_args().yes)


if __name__ == "__main__":
    main()
