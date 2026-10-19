from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import ZERO, to_money
from src.lib import stocktake
from src.models.ledger import Direction
from src.models.org import Branch
from src.models.perpetual import InventoryPosting
from src.services import audit_service, ledger_service, perpetual_service
from src.services.ledger_service import LineInput

DOC_TYPE = "perpetual_opening"


def run(*, branch_name: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None or branch.perpetual_from is None:
            raise SystemExit("الفرع غير موجود أو مافيش تاريخ بداية للجرد المستمر")
        as_of = branch.perpetual_from - timedelta(days=1)
        accs = perpetual_service.accounts(db, branch.id)
        data = stocktake.stock_as_of(db, as_of=as_of.isoformat(), warehouse_id=None,
                                     item_id=None, branch_id=branch.id)
        by_role: dict[str, Decimal] = defaultdict(lambda: ZERO)
        zero = 0
        for row in data["rows"]:
            role = perpetual_service.location_role(db, row["location_kind"], row["location_id"])
            value = Decimal(str(row["value"]))
            if Decimal(str(row["unit_cost"])) == 0 and Decimal(str(row["quantity"])) > 0:
                zero += 1
            by_role[role or "finished"] += value
        print(f"قيمة المخزون يوم {as_of}:")
        for role, v in by_role.items():
            print(f"   {role:<9} {to_money(v):>16,.2f}")
        total = to_money(sum(by_role.values(), ZERO))
        print(f"   الإجمالي  {total:>16,.2f}   (أصناف تكلفتها صفر: {zero})")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        posting = db.scalar(select(InventoryPosting).where(
            InventoryPosting.doc_type == DOC_TYPE, InventoryPosting.doc_id == branch.id))
        if posting is not None and posting.ledger_entry_id:
            from src.services.document_edit_service import _drop_entry

            old = posting.ledger_entry_id
            posting.ledger_entry_id = None
            db.flush()
            _drop_entry(db, old)
        lines = [LineInput(accs[role], Direction.debit if v > 0 else Direction.credit,
                           to_money(abs(v)), statement="رصيد مخزون بداية الجرد المستمر")
                 for role, v in by_role.items() if to_money(v) != ZERO]
        lines.append(LineInput(accs["opening"], Direction.credit if total > 0 else Direction.debit,
                               abs(total), statement="رصيد مخزون بداية الجرد المستمر"))
        actor = perpetual_service._system_actor(db)
        entry = ledger_service.post_entry(
            db, entry_type="opening_balance", actor_user_id=actor, lines=lines,
            branch_id=branch.id, entry_date=as_of,
            description=f"رصيد مخزون بداية الجرد المستمر — {branch.name}")
        if posting is None:
            posting = InventoryPosting(doc_type=DOC_TYPE, doc_id=branch.id, branch_id=branch.id)
            db.add(posting)
        posting.ledger_entry_id = entry.id
        audit_service.record(db, action="perpetual.opening", actor_user_id=None,
                             entity_type="branch", entity_id=branch.id,
                             after={"as_of": str(as_of), "total": str(total),
                                    "entry_id": entry.id})
        db.commit()
        print(f"✔ قيد افتتاحي {entry.id}")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="قيد رصيد المخزون في بداية الجرد المستمر")
    ap.add_argument("--branch", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(branch_name=a.branch, execute=a.yes)


if __name__ == "__main__":
    main()
